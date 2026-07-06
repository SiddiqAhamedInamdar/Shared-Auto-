const { db } = require('../config/database');
const wss = require('../services/websocket');
const Razorpay = require('razorpay');
const crypto = require('crypto');

const instance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

exports.createOrder = async (req, res) => {
  try {
    const rideId = req.params.id;
    const ride = db.prepare('SELECT * FROM rides WHERE id = ? AND passenger_id = ?').get(rideId, req.user.id);
    
    if (!ride) return res.status(404).json({ error: 'Ride not found' });
    if (ride.status !== 'completed') return res.status(400).json({ error: 'Ride must be completed to generate order' });

    // Amount is in paise (multiply by 100)
    const options = {
      amount: Math.round((ride.fare_estimate) * 100),
      currency: "INR",
      receipt: `receipt_ride_${ride.id}`
    };

    const order = await instance.orders.create(options);
    if (!order) return res.status(500).json({ error: 'Failed to create order' });

    res.json({ success: true, orderId: order.id, amount: order.amount, key: process.env.RAZORPAY_KEY_ID });
  } catch (error) {
    console.error('Razorpay Create Order Error:', error);
    res.status(500).json({ error: 'Internal server error while creating Razorpay order' });
  }
};

exports.verifyPayment = async (req, res) => {
  try {
    const rideId = req.params.id;
    const { amount, method, razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;

    const ride = db.prepare('SELECT * FROM rides WHERE id = ? AND passenger_id = ?').get(rideId, req.user.id);
    if (!ride) return res.status(404).json({ error: 'Ride not found' });
    if (ride.status !== 'completed') return res.status(400).json({ error: 'Ride must be completed before payment' });

    const paymentMethod = method && method.toLowerCase().includes('cash') ? 'cash' : 'upi';
    let transactionId = 'txn_' + Date.now();

    // Verify Signature if it's an online Razorpay payment
    if (paymentMethod === 'upi' && razorpay_payment_id && razorpay_order_id && razorpay_signature) {
      const generated_signature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(razorpay_order_id + "|" + razorpay_payment_id)
        .digest('hex');

      if (generated_signature !== razorpay_signature) {
        return res.status(400).json({ error: 'Payment verification failed: Invalid Signature' });
      }
      transactionId = razorpay_payment_id;
    }

    db.prepare(`
      INSERT INTO payments (ride_id, user_id, amount, method, status, transaction_id)
      VALUES (?, ?, ?, ?, 'completed', ?)
    `).run(
      ride.id, 
      req.user.id, 
      amount || ride.fare_estimate, 
      paymentMethod,
      transactionId
    );

    // Notify Driver via WebSockets
    if (ride.driver_id) {
      const driver = db.prepare('SELECT user_id FROM drivers WHERE id = ?').get(ride.driver_id);
      if (driver) {
        wss.sendToUser(driver.user_id, {
          type: 'payment_confirmed',
          rideId: ride.id,
          amount: amount || ride.fare_estimate,
          method: paymentMethod === 'cash' ? 'Cash' : 'Razorpay'
        });
      }
    }

    res.json({ success: true, message: 'Payment successfully processed.' });
  } catch (err) {
    console.error('Error verifying payment:', err);
    res.status(500).json({ error: 'Internal server error during verification' });
  }
};
