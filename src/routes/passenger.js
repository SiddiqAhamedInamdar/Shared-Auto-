const express = require('express');
const { db } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { roleGuard } = require('../middleware/roleGuard');
const { calculateFare } = require('../services/fareCalculator');
const { findOrCreateSharedGroup, findNearestDriver } = require('../services/rideMatching');
const { sendToUser, broadcastToRole } = require('../services/websocket');
const { generateOTP, calculateDistance } = require('../utils/helpers');

const router = express.Router();

// All passenger routes require authentication and passenger role
router.use(authMiddleware, roleGuard('passenger'));

// POST /api/passenger/fare-estimate
router.post('/fare-estimate', (req, res) => {
  try {
    const { pickupLat, pickupLng, dropLat, dropLng, rideType } = req.body;

    if (!pickupLat || !pickupLng || !dropLat || !dropLng) {
      return res.status(400).json({ error: 'Pickup and drop locations are required.' });
    }

    const distance = calculateDistance(pickupLat, pickupLng, dropLat, dropLng);
    const fare = calculateFare(distance, rideType || 'private');

    res.json({ fare });
  } catch (err) {
    console.error('Fare estimate error:', err);
    res.status(500).json({ error: 'Failed to estimate fare.' });
  }
});

// POST /api/passenger/book
router.post('/book', (req, res) => {
  try {
    const {
      pickupLat, pickupLng, pickupAddress,
      dropLat, dropLng, dropAddress,
      rideType, genderPref
    } = req.body;

    // Validation
    if (!pickupLat || !pickupLng || !pickupAddress || !dropLat || !dropLng || !dropAddress) {
      return res.status(400).json({ error: 'Pickup and drop locations are required.' });
    }

    // Check for active ride
    const activeRide = db.prepare(`
      SELECT id FROM rides 
      WHERE passenger_id = ? 
      AND status IN ('requested', 'matching', 'matched', 'accepted', 'driver_arriving', 'started')
    `).get(req.user.id);

    if (activeRide) {
      return res.status(400).json({ error: 'You already have an active ride. Complete or cancel it first.' });
    }

    const distance = calculateDistance(pickupLat, pickupLng, dropLat, dropLng);
    const fareEstimate = calculateFare(distance, rideType || 'private');
    const otp = generateOTP();

    const type = rideType || 'private';
    const gender = genderPref || 'no_preference';

    // Create ride
    const result = db.prepare(`
      INSERT INTO rides (
        passenger_id, ride_type, pickup_lat, pickup_lng, pickup_address,
        drop_lat, drop_lng, drop_address, gender_pref, status,
        fare_estimate, distance_km, duration_min, otp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user.id, type, pickupLat, pickupLng, pickupAddress,
      dropLat, dropLng, dropAddress, gender,
      type === 'shared' ? 'matching' : 'requested',
      fareEstimate.total, fareEstimate.distanceKm, fareEstimate.estimatedDuration, otp
    );

    const rideId = result.lastInsertRowid;

    if (type === 'shared') {
      // Try to find or create a shared group
      const groupResult = findOrCreateSharedGroup({
        pickup_lat: pickupLat,
        pickup_lng: pickupLng,
        drop_lat: dropLat,
        drop_lng: dropLng,
        gender_pref: gender
      });

      db.prepare('UPDATE rides SET shared_group_id = ? WHERE id = ?')
        .run(groupResult.groupId, rideId);

      if (groupResult.isFull) {
        // Group is full, try to find a driver
        const driver = findNearestDriver(pickupLat, pickupLng, gender);
        if (driver) {
          db.prepare('UPDATE rides SET status = ?, driver_id = ? WHERE shared_group_id = ? AND status = ?')
            .run('matched', driver.id, groupResult.groupId, 'matching');
          db.prepare('UPDATE shared_ride_groups SET driver_id = ?, status = ? WHERE id = ?')
            .run(driver.id, 'matched', groupResult.groupId);

          // Notify driver
          sendToUser(driver.user_id, {
            type: 'new_ride_request',
            rideId,
            rideType: 'shared',
            pickup: pickupAddress,
            drop: dropAddress
          });
        }
      }
    } else {
      // Private ride — find driver immediately
      const driver = findNearestDriver(pickupLat, pickupLng, gender);
      if (driver) {
        db.prepare('UPDATE rides SET status = ?, driver_id = ? WHERE id = ?')
          .run('matched', driver.id, rideId);

        // Notify driver
        sendToUser(driver.user_id, {
          type: 'new_ride_request',
          rideId,
          rideType: 'private',
          pickup: pickupAddress,
          drop: dropAddress,
          fare: fareEstimate.total
        });
      }
    }

    const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(rideId);

    res.status(201).json({
      message: type === 'shared'
        ? 'Ride requested! Looking for passengers heading your way...'
        : 'Ride requested! Finding you a driver...',
      ride,
      fare: fareEstimate,
      otp
    });
  } catch (err) {
    console.error('Booking error:', err);
    res.status(500).json({ error: 'Failed to book ride. Please try again.' });
  }
});

// GET /api/passenger/rides
router.get('/rides', (req, res) => {
  try {
    const { status, limit = 20, offset = 0 } = req.query;

    let query = `
      SELECT r.*, 
        u.full_name as driver_name, u.phone as driver_phone,
        d.rating_avg as driver_rating
      FROM rides r
      LEFT JOIN drivers d ON r.driver_id = d.id
      LEFT JOIN users u ON d.user_id = u.id
      WHERE r.passenger_id = ?
    `;
    const params = [req.user.id];

    if (status) {
      query += ' AND r.status = ?';
      params.push(status);
    }

    query += ' ORDER BY r.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const rides = db.prepare(query).all(...params);

    res.json({ rides });
  } catch (err) {
    console.error('Get rides error:', err);
    res.status(500).json({ error: 'Failed to fetch rides.' });
  }
});

// GET /api/passenger/rides/active
router.get('/rides/active', (req, res) => {
  try {
    const ride = db.prepare(`
      SELECT r.*, 
        u.full_name as driver_name, u.phone as driver_phone,
        d.rating_avg as driver_rating, d.current_lat as driver_lat, d.current_lng as driver_lng,
        v.registration_number as vehicle_number, v.color as vehicle_color
      FROM rides r
      LEFT JOIN drivers d ON r.driver_id = d.id
      LEFT JOIN users u ON d.user_id = u.id
      LEFT JOIN vehicles v ON d.id = v.driver_id
      WHERE r.passenger_id = ?
      AND (
        r.status IN ('requested', 'matching', 'matched', 'accepted', 'driver_arriving', 'started')
        OR (r.status = 'completed' AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.ride_id = r.id AND p.status = 'completed'))
      )
      ORDER BY r.created_at DESC
      LIMIT 1
    `).get(req.user.id);

    if (!ride) {
      return res.json({ ride: null });
    }

    // If shared, get co-passengers
    let coPassengers = [];
    if (ride.ride_type === 'shared' && ride.shared_group_id) {
      coPassengers = db.prepare(`
        SELECT u.full_name, u.gender 
        FROM rides r JOIN users u ON r.passenger_id = u.id
        WHERE r.shared_group_id = ? AND r.passenger_id != ? AND r.status != 'cancelled'
      `).all(ride.shared_group_id, req.user.id);
    }

    res.json({ ride, coPassengers });
  } catch (err) {
    console.error('Get active ride error:', err);
    res.status(500).json({ error: 'Failed to fetch active ride.' });
  }
});

// POST /api/passenger/rides/:id/pay
router.post('/rides/:id/pay', (req, res) => {
  try {
    const { amount, method } = req.body;
    const ride = db.prepare('SELECT * FROM rides WHERE id = ? AND passenger_id = ?').get(req.params.id, req.user.id);

    if (!ride) return res.status(404).json({ error: 'Ride not found.' });
    if (ride.status !== 'completed') return res.status(400).json({ error: 'Ride is not completed yet.' });

    // Insert payment record
    db.prepare(`
      INSERT INTO payments (ride_id, user_id, amount, method, status)
      VALUES (?, ?, ?, ?, 'completed')
    `).run(ride.id, req.user.id, amount, method || 'cash');

    // Notify driver about payment confirmation
    if (ride.driver_id) {
      const driver = db.prepare('SELECT user_id FROM drivers WHERE id = ?').get(ride.driver_id);
      if (driver) {
        const { sendToUser } = require('../services/websocket');
        sendToUser(driver.user_id, {
          type: 'payment_confirmed',
          rideId: ride.id,
          amount: amount
        });
      }
    }

    res.json({ message: 'Payment successful! Thank you.' });
  } catch (err) {
    console.error('Process payment error:', err);
    res.status(500).json({ error: 'Failed to process payment.' });
  }
});

// GET /api/passenger/rides/:id
router.get('/rides/:id', (req, res) => {
  try {
    const ride = db.prepare(`
      SELECT r.*, 
        u.full_name as driver_name, u.phone as driver_phone,
        d.rating_avg as driver_rating,
        v.registration_number as vehicle_number, v.color as vehicle_color
      FROM rides r
      LEFT JOIN drivers d ON r.driver_id = d.id
      LEFT JOIN users u ON d.user_id = u.id
      LEFT JOIN vehicles v ON d.id = v.driver_id
      WHERE r.id = ? AND r.passenger_id = ?
    `).get(req.params.id, req.user.id);

    if (!ride) {
      return res.status(404).json({ error: 'Ride not found.' });
    }

    // Get review if exists
    const review = db.prepare('SELECT * FROM reviews WHERE ride_id = ? AND reviewer_id = ?')
      .get(ride.id, req.user.id);

    res.json({ ride, review });
  } catch (err) {
    console.error('Get ride error:', err);
    res.status(500).json({ error: 'Failed to fetch ride details.' });
  }
});

// POST /api/passenger/rides/:id/cancel
router.post('/rides/:id/cancel', (req, res) => {
  try {
    const ride = db.prepare(`
      SELECT * FROM rides WHERE id = ? AND passenger_id = ? 
      AND status IN ('requested', 'matching', 'matched', 'accepted', 'driver_arriving')
    `).get(req.params.id, req.user.id);

    if (!ride) {
      return res.status(404).json({ error: 'Ride not found or cannot be cancelled.' });
    }

    db.prepare(`
      UPDATE rides SET status = 'cancelled', cancelled_by = 'passenger', cancel_reason = ?
      WHERE id = ?
    `).run(req.body.reason || 'Cancelled by passenger', ride.id);

    // Handle shared ride group state updates
    if (ride.ride_type === 'shared' && ride.shared_group_id) {
      db.prepare(`
        UPDATE shared_ride_groups 
        SET current_passengers = current_passengers - 1 
        WHERE id = ?
      `).run(ride.shared_group_id);

      // Check if there are any remaining active rides in this group
      const activeGroupRides = db.prepare(`
        SELECT COUNT(*) as active_count 
        FROM rides 
        WHERE shared_group_id = ? 
        AND status NOT IN ('cancelled', 'completed')
      `).get(ride.shared_group_id);

      if (activeGroupRides.active_count === 0) {
        db.prepare(`
          UPDATE shared_ride_groups 
          SET status = 'cancelled' 
          WHERE id = ?
        `).run(ride.shared_group_id);
      }
    }

    // Notify driver if assigned
    if (ride.driver_id) {
      const driver = db.prepare('SELECT user_id FROM drivers WHERE id = ?').get(ride.driver_id);
      if (driver) {
        sendToUser(driver.user_id, {
          type: 'ride_cancelled',
          rideId: ride.id,
          message: 'Passenger cancelled the ride.'
        });
      }
    }

    res.json({ message: 'Ride cancelled successfully.' });
  } catch (err) {
    console.error('Cancel ride error:', err);
    res.status(500).json({ error: 'Failed to cancel ride.' });
  }
});

// POST /api/passenger/rides/:id/rate
router.post('/rides/:id/rate', (req, res) => {
  try {
    const { rating, comment } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
    }

    const ride = db.prepare(`
      SELECT * FROM rides WHERE id = ? AND passenger_id = ? AND status = 'completed'
    `).get(req.params.id, req.user.id);

    if (!ride) {
      return res.status(404).json({ error: 'Completed ride not found.' });
    }

    // Check if already reviewed
    const existing = db.prepare('SELECT id FROM reviews WHERE ride_id = ? AND reviewer_id = ?')
      .get(ride.id, req.user.id);

    if (existing) {
      return res.status(400).json({ error: 'You have already rated this ride.' });
    }

    const driver = db.prepare('SELECT * FROM drivers WHERE id = ?').get(ride.driver_id);
    if (!driver) {
      return res.status(404).json({ error: 'Driver not found.' });
    }

    // Create review
    db.prepare(`
      INSERT INTO reviews (ride_id, reviewer_id, reviewee_id, rating, comment)
      VALUES (?, ?, ?, ?, ?)
    `).run(ride.id, req.user.id, driver.user_id, rating, comment || '');

    // Update driver's average rating
    const avgResult = db.prepare(`
      SELECT AVG(rating) as avg_rating FROM reviews WHERE reviewee_id = ?
    `).get(driver.user_id);

    db.prepare('UPDATE drivers SET rating_avg = ? WHERE id = ?')
      .run(avgResult.avg_rating, driver.id);

    res.json({ message: 'Thank you for your rating!' });
  } catch (err) {
    console.error('Rate ride error:', err);
    res.status(500).json({ error: 'Failed to submit rating.' });
  }
});

// POST /api/passenger/complaints
router.post('/complaints', (req, res) => {
  try {
    const { rideId, subject, description } = req.body;

    if (!subject || !description) {
      return res.status(400).json({ error: 'Subject and description are required.' });
    }

    db.prepare(`
      INSERT INTO complaints (user_id, ride_id, subject, description)
      VALUES (?, ?, ?, ?)
    `).run(req.user.id, rideId || null, subject, description);

    res.status(201).json({ message: 'Complaint submitted. We will investigate shortly.' });
  } catch (err) {
    console.error('Complaint error:', err);
    res.status(500).json({ error: 'Failed to submit complaint.' });
  }
});

// POST /api/passenger/wallet/topup
router.post('/wallet/topup', (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid topup amount.' });
    }
    
    db.prepare('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?')
      .run(amount, req.user.id);
      
    const user = db.prepare('SELECT wallet_balance FROM users WHERE id = ?').get(req.user.id);
    res.json({ message: 'Wallet topped up successfully.', balance: user.wallet_balance });
  } catch (err) {
    console.error('Wallet topup error:', err);
    res.status(500).json({ error: 'Failed to topup wallet.' });
  }
});

module.exports = router;

