const express = require('express');
const multer = require('multer');
const path = require('path');
const { db } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { roleGuard } = require('../middleware/roleGuard');
const { sendToUser } = require('../services/websocket');
const { calculateFare } = require('../services/fareCalculator');
const { calculateDistance } = require('../utils/helpers');

const router = express.Router();

// File upload config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', '..', 'uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext && mime) cb(null, true);
    else cb(new Error('Only image files are allowed.'));
  }
});

// All driver routes require authentication and driver role
router.use(authMiddleware, roleGuard('driver'));

// POST /api/driver/onboarding
router.post('/onboarding', upload.fields([
  { name: 'licensePhoto', maxCount: 1 },
  { name: 'profilePhoto', maxCount: 1 },
  { name: 'vehiclePhoto', maxCount: 1 }
]), (req, res) => {
  try {
    const { licenseNumber, registrationNumber, vehicleModel, vehicleColor, experienceYears } = req.body;

    if (!licenseNumber || !registrationNumber) {
      return res.status(400).json({ error: 'License number and vehicle registration are required.' });
    }

    const driver = db.prepare('SELECT * FROM drivers WHERE user_id = ?').get(req.user.id);
    if (!driver) {
      return res.status(404).json({ error: 'Driver record not found.' });
    }

    // Update driver details
    const licensePhoto = req.files?.licensePhoto?.[0]?.filename || driver.license_photo;
    const profilePhoto = req.files?.profilePhoto?.[0]?.filename || driver.profile_photo;
    const vehiclePhoto = req.files?.vehiclePhoto?.[0]?.filename || null;

    db.prepare(`
      UPDATE drivers SET 
        license_number = ?,
        license_photo = ?,
        profile_photo = ?,
        experience_years = ?,
        status = 'approved',
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(licenseNumber, licensePhoto, profilePhoto, experienceYears || 0, req.user.id);

    // Create or update vehicle
    const existingVehicle = db.prepare('SELECT id FROM vehicles WHERE driver_id = ?').get(driver.id);

    if (existingVehicle) {
      db.prepare(`
        UPDATE vehicles SET 
          registration_number = ?, model = ?, color = ?, photo = ?
        WHERE driver_id = ?
      `).run(registrationNumber, vehicleModel || '', vehicleColor || '', vehiclePhoto, driver.id);
    } else {
      db.prepare(`
        INSERT INTO vehicles (driver_id, registration_number, model, color, photo)
        VALUES (?, ?, ?, ?, ?)
      `).run(driver.id, registrationNumber, vehicleModel || '', vehicleColor || '', vehiclePhoto);
    }

    res.json({ message: 'Onboarding details submitted. Awaiting admin verification.' });
  } catch (err) {
    console.error('Onboarding error:', err);
    res.status(500).json({ error: 'Failed to submit onboarding details.' });
  }
});

// GET /api/driver/profile
router.get('/profile', (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const driver = db.prepare('SELECT * FROM drivers WHERE user_id = ?').get(req.user.id);
    const vehicle = driver ? db.prepare('SELECT * FROM vehicles WHERE driver_id = ?').get(driver.id) : null;

    const { password_hash, ...safeUser } = user;

    res.json({ user: safeUser, driver, vehicle });
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ error: 'Failed to fetch profile.' });
  }
});

// PUT /api/driver/status
router.put('/status', (req, res) => {
  try {
    const { isOnline, lat, lng } = req.body;
    
    const driver = db.prepare('SELECT * FROM drivers WHERE user_id = ?').get(req.user.id);
    if (!driver) {
      return res.status(404).json({ error: 'Driver record not found.' });
    }

    if (driver.status !== 'approved') {
      return res.status(403).json({ error: 'Your account is not approved yet.' });
    }

    db.prepare(`
      UPDATE drivers SET is_online = ?, current_lat = ?, current_lng = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(isOnline ? 1 : 0, lat || null, lng || null, req.user.id);

    res.json({ message: isOnline ? 'You are now online!' : 'You are now offline.', isOnline });
  } catch (err) {
    console.error('Status update error:', err);
    res.status(500).json({ error: 'Failed to update status.' });
  }
});

// PUT /api/driver/location
router.put('/location', (req, res) => {
  try {
    const { lat, lng } = req.body;
    db.prepare('UPDATE drivers SET current_lat = ?, current_lng = ? WHERE user_id = ?')
      .run(lat, lng, req.user.id);
    res.json({ message: 'Location updated.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update location.' });
  }
});

// GET /api/driver/requests
router.get('/requests', (req, res) => {
  try {
    const driver = db.prepare('SELECT * FROM drivers WHERE user_id = ?').get(req.user.id);
    if (!driver) {
      return res.status(404).json({ error: 'Driver record not found.' });
    }

    const rides = db.prepare(`
      SELECT r.*, u.full_name as passenger_name, u.phone as passenger_phone, u.gender as passenger_gender
      FROM rides r
      JOIN users u ON r.passenger_id = u.id
      WHERE r.driver_id = ? AND r.status IN ('matched')
      ORDER BY r.created_at DESC
    `).all(driver.id);

    res.json({ rides });
  } catch (err) {
    console.error('Get requests error:', err);
    res.status(500).json({ error: 'Failed to fetch ride requests.' });
  }
});

// GET /api/driver/rides/active
router.get('/rides/active', (req, res) => {
  try {
    const driver = db.prepare('SELECT * FROM drivers WHERE user_id = ?').get(req.user.id);
    if (!driver) return res.json({ ride: null });

    const ride = db.prepare(`
      SELECT r.*, u.full_name as passenger_name, u.phone as passenger_phone, u.gender as passenger_gender
      FROM rides r
      JOIN users u ON r.passenger_id = u.id
      WHERE r.driver_id = ? 
      AND (
        r.status IN ('accepted', 'driver_arriving', 'started')
        OR (r.status = 'completed' AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.ride_id = r.id AND p.status = 'completed'))
      )
      ORDER BY r.created_at DESC
      LIMIT 1
    `).get(driver.id);

    if (!ride) return res.json({ ride: null });

    // If shared ride, get all passengers
    let allPassengers = [ride];
    if (ride.ride_type === 'shared' && ride.shared_group_id) {
      allPassengers = db.prepare(`
        SELECT r.*, u.full_name as passenger_name, u.phone as passenger_phone, u.gender as passenger_gender
        FROM rides r
        JOIN users u ON r.passenger_id = u.id
        WHERE r.shared_group_id = ? 
        AND (
          r.status IN ('accepted', 'driver_arriving', 'started')
          OR (r.status = 'completed' AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.ride_id = r.id AND p.status = 'completed'))
        )
      `).all(ride.shared_group_id);
    }

    res.json({ ride, allPassengers });
  } catch (err) {
    console.error('Get active ride error:', err);
    res.status(500).json({ error: 'Failed to fetch active ride.' });
  }
});

// POST /api/driver/rides/:id/accept
router.post('/rides/:id/accept', (req, res) => {
  try {
    const driver = db.prepare('SELECT * FROM drivers WHERE user_id = ?').get(req.user.id);
    const ride = db.prepare(`
      SELECT * FROM rides WHERE id = ? AND driver_id = ? AND status = 'matched'
    `).get(req.params.id, driver.id);

    if (!ride) {
      return res.status(404).json({ error: 'Ride not found or already accepted.' });
    }

    db.prepare('UPDATE rides SET status = ? WHERE id = ?').run('accepted', ride.id);

    // If shared ride, accept all rides in the group
    if (ride.shared_group_id) {
      db.prepare(`
        UPDATE rides SET status = 'accepted', driver_id = ? 
        WHERE shared_group_id = ? AND status IN ('matched', 'matching')
      `).run(driver.id, ride.shared_group_id);

      db.prepare('UPDATE shared_ride_groups SET status = ? WHERE id = ?')
        .run('in_progress', ride.shared_group_id);
    }

    // Notify passenger
    sendToUser(ride.passenger_id, {
      type: 'ride_accepted',
      rideId: ride.id,
      driverName: req.user.fullName,
      message: 'Your driver is on the way!'
    });

    res.json({ message: 'Ride accepted!' });
  } catch (err) {
    console.error('Accept ride error:', err);
    res.status(500).json({ error: 'Failed to accept ride.' });
  }
});

// POST /api/driver/rides/:id/reject
router.post('/rides/:id/reject', (req, res) => {
  try {
    const driver = db.prepare('SELECT * FROM drivers WHERE user_id = ?').get(req.user.id);
    const ride = db.prepare(`
      SELECT * FROM rides WHERE id = ? AND driver_id = ? AND status = 'matched'
    `).get(req.params.id, driver.id);

    if (!ride) {
      return res.status(404).json({ error: 'Ride not found.' });
    }

    // Remove driver from ride/group
    if (ride.ride_type === 'shared' && ride.shared_group_id) {
      db.prepare(`
        UPDATE rides 
        SET status = 'matching', driver_id = NULL 
        WHERE shared_group_id = ? AND status = 'matched'
      `).run(ride.shared_group_id);

      db.prepare(`
        UPDATE shared_ride_groups 
        SET status = 'forming', driver_id = NULL 
        WHERE id = ?
      `).run(ride.shared_group_id);
    } else {
      db.prepare('UPDATE rides SET status = ?, driver_id = NULL WHERE id = ?')
        .run('requested', ride.id);
    }

    res.json({ message: 'Ride rejected.' });
  } catch (err) {
    console.error('Reject ride error:', err);
    res.status(500).json({ error: 'Failed to reject ride.' });
  }
});

// POST /api/driver/rides/:id/arrive
router.post('/rides/:id/arrive', (req, res) => {
  try {
    const driver = db.prepare('SELECT * FROM drivers WHERE user_id = ?').get(req.user.id);
    const ride = db.prepare(`
      SELECT * FROM rides WHERE id = ? AND driver_id = ? AND status = 'accepted'
    `).get(req.params.id, driver.id);

    if (!ride) {
      return res.status(404).json({ error: 'Ride not found or not accepted.' });
    }

    db.prepare("UPDATE rides SET status = 'driver_arriving' WHERE id = ?").run(ride.id);

    // If shared, update all accepted in group
    if (ride.shared_group_id) {
      db.prepare(`
        UPDATE rides SET status = 'driver_arriving' 
        WHERE shared_group_id = ? AND status = 'accepted'
      `).run(ride.shared_group_id);
    }

    sendToUser(ride.passenger_id, {
      type: 'ride_status',
      rideId: ride.id,
      status: 'driver_arriving',
      message: 'Your driver has arrived at the pickup location!'
    });

    res.json({ message: 'Status updated to driver_arriving.' });
  } catch (err) {
    console.error('Arrive ride error:', err);
    res.status(500).json({ error: 'Failed to update status.' });
  }
});

// POST /api/driver/rides/:id/start

router.post('/rides/:id/start', (req, res) => {
  try {
    const { otp } = req.body;
    const driver = db.prepare('SELECT * FROM drivers WHERE user_id = ?').get(req.user.id);
    const ride = db.prepare(`
      SELECT * FROM rides WHERE id = ? AND driver_id = ? AND status IN ('accepted', 'driver_arriving')
    `).get(req.params.id, driver.id);

    if (!ride) {
      return res.status(404).json({ error: 'Ride not found or not accepted.' });
    }

    // Verify OTP
    if (ride.otp && otp !== ride.otp) {
      return res.status(400).json({ error: 'Invalid OTP. Please ask the passenger for the correct OTP.' });
    }

    db.prepare('UPDATE rides SET status = ?, started_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('started', ride.id);

    // If shared, start all rides in group
    if (ride.shared_group_id) {
      db.prepare(`
        UPDATE rides SET status = 'started', started_at = CURRENT_TIMESTAMP 
        WHERE shared_group_id = ? AND status IN ('accepted', 'driver_arriving')
      `).run(ride.shared_group_id);
    }

    sendToUser(ride.passenger_id, {
      type: 'ride_started',
      rideId: ride.id,
      message: 'Your ride has started!'
    });

    res.json({ message: 'Ride started!' });
  } catch (err) {
    console.error('Start ride error:', err);
    res.status(500).json({ error: 'Failed to start ride.' });
  }
});

// POST /api/driver/rides/:id/complete
router.post('/rides/:id/complete', (req, res) => {
  try {
    const driver = db.prepare('SELECT * FROM drivers WHERE user_id = ?').get(req.user.id);
    const ride = db.prepare(`
      SELECT * FROM rides WHERE id = ? AND driver_id = ? AND status = 'started'
    `).get(req.params.id, driver.id);

    if (!ride) {
      return res.status(404).json({ error: 'Ride not found or not started.' });
    }

    const fareFinal = ride.fare_estimate; // In real app, recalculate based on actual route

    db.prepare(`
      UPDATE rides SET status = 'completed', fare_final = ?, completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(fareFinal, ride.id);

    // Removed automatic payment creation since passenger will pay


    // Update driver stats
    db.prepare(`
      UPDATE drivers SET 
        total_rides = total_rides + 1,
        total_earnings = total_earnings + ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(fareFinal, driver.id);

    sendToUser(ride.passenger_id, {
      type: 'ride_completed',
      rideId: ride.id,
      fare: fareFinal,
      message: 'Your ride is complete! Please rate your experience.'
    });

    res.json({ message: 'Ride completed!', fare: fareFinal });
  } catch (err) {
    console.error('Complete ride error:', err);
    res.status(500).json({ error: 'Failed to complete ride.' });
  }
});

// GET /api/driver/earnings
router.get('/earnings', (req, res) => {
  try {
    const driver = db.prepare('SELECT * FROM drivers WHERE user_id = ?').get(req.user.id);
    if (!driver) {
      return res.status(404).json({ error: 'Driver not found.' });
    }

    // Today's earnings
    const todayEarnings = db.prepare(`
      SELECT COALESCE(SUM(fare_final), 0) as total
      FROM rides WHERE driver_id = ? AND status = 'completed'
      AND date(completed_at) = date('now')
    `).get(driver.id);

    // This week's earnings
    const weekEarnings = db.prepare(`
      SELECT COALESCE(SUM(fare_final), 0) as total
      FROM rides WHERE driver_id = ? AND status = 'completed'
      AND completed_at >= datetime('now', '-7 days')
    `).get(driver.id);

    // This month's earnings
    const monthEarnings = db.prepare(`
      SELECT COALESCE(SUM(fare_final), 0) as total
      FROM rides WHERE driver_id = ? AND status = 'completed'
      AND strftime('%Y-%m', completed_at) = strftime('%Y-%m', 'now')
    `).get(driver.id);

    // Recent completed rides
    const recentRides = db.prepare(`
      SELECT r.*, u.full_name as passenger_name
      FROM rides r
      JOIN users u ON r.passenger_id = u.id
      WHERE r.driver_id = ? AND r.status = 'completed'
      ORDER BY r.completed_at DESC
      LIMIT 10
    `).all(driver.id);

    res.json({
      totalEarnings: driver.total_earnings,
      totalRides: driver.total_rides,
      todayEarnings: todayEarnings.total,
      weekEarnings: weekEarnings.total,
      monthEarnings: monthEarnings.total,
      rating: driver.rating_avg,
      recentRides
    });
  } catch (err) {
    console.error('Get earnings error:', err);
    res.status(500).json({ error: 'Failed to fetch earnings.' });
  }
});

// GET /api/driver/rides
router.get('/rides', (req, res) => {
  try {
    const driver = db.prepare('SELECT * FROM drivers WHERE user_id = ?').get(req.user.id);
    if (!driver) return res.json({ rides: [] });

    const rides = db.prepare(`
      SELECT r.*, u.full_name as passenger_name
      FROM rides r
      JOIN users u ON r.passenger_id = u.id
      WHERE r.driver_id = ?
      ORDER BY r.created_at DESC
      LIMIT 50
    `).all(driver.id);

    res.json({ rides });
  } catch (err) {
    console.error('Get rides error:', err);
    res.status(500).json({ error: 'Failed to fetch rides.' });
  }
});

module.exports = router;
