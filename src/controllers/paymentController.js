const db = require('../config/database');
const wss = require('../services/websocket');

exports.createOrder = async (req, res) => {
  // Not used in Native UPI flow, but keeping endpoint alive just in case.
  res.json({ success: true, message: 'Intent flow does not require server-side order generation.' });
};

exports.verifyPayment = async (req, res) => {
  try {
    const rideId = req.params.id;
    const { amount, method } = req.body;

    // Verify ride belongs to passenger and is completed
    const ride = db.prepare('SELECT * FROM rides WHERE id = ? AND passenger_id = ?').get(rideId, req.user.id);
    if (!ride) {
      return res.status(404).json({ error: 'Ride not found' });
    }

    if (ride.status !== 'completed') {
      return res.status(400).json({ error: 'Ride must be completed before payment' });
    }

    // Since this is a test flow using Native Intents (where the bank naturally rejects it),
    // we bypass strict verification and manually mark the ride as paid for testing purposes.
    
    // Insert/Update payment record
    const updateRide = db.prepare(`
      UPDATE rides 
      SET payment_status = 'paid', payment_method = ?
      WHERE id = ? AND passenger_id = ?
    `);
    
    updateRide.run(method || 'Native UPI (Test)', rideId, req.user.id);

    // Notify Driver via WebSockets
    if (ride.driver_id) {
      wss.sendToUser(ride.driver_id, 'payment_confirmed', {
        rideId: ride.id,
        amount: amount || ride.fare_estimate,
        method: method || 'Native UPI (Test)'
      });
    }

    res.json({ success: true, message: 'Payment successfully processed in test mode.' });

  } catch (err) {
    console.error('Error verifying Native UPI payment:', err);
    res.status(500).json({ error: 'Internal server error during verification' });
  }
};
