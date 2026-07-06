const express = require('express');
const { db } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { roleGuard } = require('../middleware/roleGuard');

const router = express.Router();

// All admin routes require admin role
router.use(authMiddleware, roleGuard('admin'));

// GET /api/admin/dashboard
router.get('/dashboard', (req, res) => {
  try {
    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?').get('passenger');
    const totalDrivers = db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?').get('driver');
    const pendingDrivers = db.prepare('SELECT COUNT(*) as count FROM drivers WHERE status = ?').get('pending');
    const activeRides = db.prepare(`
      SELECT COUNT(*) as count FROM rides WHERE status IN ('requested', 'matching', 'matched', 'accepted', 'driver_arriving', 'started')
    `).get();
    const completedRides = db.prepare('SELECT COUNT(*) as count FROM rides WHERE status = ?').get('completed');
    const totalRevenue = db.prepare('SELECT COALESCE(SUM(fare_final), 0) as total FROM rides WHERE status = ?').get('completed');
    const todayRevenue = db.prepare(`
      SELECT COALESCE(SUM(fare_final), 0) as total FROM rides 
      WHERE status = 'completed' AND date(completed_at) = date('now')
    `).get();
    const openComplaints = db.prepare('SELECT COUNT(*) as count FROM complaints WHERE status IN (?, ?)').get('open', 'investigating');
    const onlineDrivers = db.prepare('SELECT COUNT(*) as count FROM drivers WHERE is_online = 1 AND status = ?').get('approved');

    // Rides today
    const todayRides = db.prepare(`
      SELECT COUNT(*) as count FROM rides WHERE date(created_at) = date('now')
    `).get();

    // Shared vs Private rides
    const sharedRides = db.prepare(`SELECT COUNT(*) as count FROM rides WHERE ride_type = 'shared' AND status = 'completed'`).get();
    const privateRides = db.prepare(`SELECT COUNT(*) as count FROM rides WHERE ride_type = 'private' AND status = 'completed'`).get();

    res.json({
      totalUsers: totalUsers.count,
      totalDrivers: totalDrivers.count,
      pendingDrivers: pendingDrivers.count,
      activeRides: activeRides.count,
      completedRides: completedRides.count,
      totalRevenue: totalRevenue.total,
      todayRevenue: todayRevenue.total,
      openComplaints: openComplaints.count,
      onlineDrivers: onlineDrivers.count,
      todayRides: todayRides.count,
      sharedRides: sharedRides.count,
      privateRides: privateRides.count
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Failed to fetch dashboard data.' });
  }
});

// GET /api/admin/drivers/pending
router.get('/drivers/pending', (req, res) => {
  try {
    const drivers = db.prepare(`
      SELECT d.*, u.full_name, u.email, u.phone, u.gender, u.created_at as user_created_at,
        v.registration_number, v.model as vehicle_model, v.color as vehicle_color, v.photo as vehicle_photo
      FROM drivers d
      JOIN users u ON d.user_id = u.id
      LEFT JOIN vehicles v ON d.id = v.driver_id
      WHERE d.status = 'pending'
      ORDER BY d.created_at ASC
    `).all();

    res.json({ drivers });
  } catch (err) {
    console.error('Pending drivers error:', err);
    res.status(500).json({ error: 'Failed to fetch pending drivers.' });
  }
});

// GET /api/admin/drivers
router.get('/drivers', (req, res) => {
  try {
    const { status } = req.query;
    let query = `
      SELECT d.*, u.full_name, u.email, u.phone, u.gender, u.status as user_status,
        v.registration_number, v.model as vehicle_model, v.color as vehicle_color
      FROM drivers d
      JOIN users u ON d.user_id = u.id
      LEFT JOIN vehicles v ON d.id = v.driver_id
    `;
    const params = [];

    if (status) {
      query += ' WHERE d.status = ?';
      params.push(status);
    }

    query += ' ORDER BY d.created_at DESC';

    const drivers = db.prepare(query).all(...params);
    res.json({ drivers });
  } catch (err) {
    console.error('Get drivers error:', err);
    res.status(500).json({ error: 'Failed to fetch drivers.' });
  }
});

// POST /api/admin/drivers/:id/verify
router.post('/drivers/:id/verify', (req, res) => {
  try {
    const { action, reason } = req.body; // action: 'approve' or 'reject'

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Action must be approve or reject.' });
    }

    const driver = db.prepare('SELECT * FROM drivers WHERE id = ?').get(req.params.id);
    if (!driver) {
      return res.status(404).json({ error: 'Driver not found.' });
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';

    db.prepare(`
      UPDATE drivers SET status = ?, verified_at = CURRENT_TIMESTAMP, verified_by = ?
      WHERE id = ?
    `).run(newStatus, req.user.id, driver.id);

    // Create notification for driver
    db.prepare(`
      INSERT INTO notifications (user_id, type, title, message)
      VALUES (?, ?, ?, ?)
    `).run(
      driver.user_id,
      action === 'approve' ? 'driver_approved' : 'driver_rejected',
      action === 'approve' ? 'Application Approved! 🎉' : 'Application Update',
      action === 'approve'
        ? 'Your driver application has been approved. You can now go online and start accepting rides!'
        : `Your application was not approved. Reason: ${reason || 'Documents need review. Please resubmit.'}`
    );

    res.json({ message: `Driver ${action}d successfully.` });
  } catch (err) {
    console.error('Verify driver error:', err);
    res.status(500).json({ error: 'Failed to verify driver.' });
  }
});

// GET /api/admin/users
router.get('/users', (req, res) => {
  try {
    const { role, status, search, limit = 50, offset = 0 } = req.query;
    let query = 'SELECT id, email, full_name, phone, role, gender, status, wallet_balance, created_at FROM users WHERE 1=1';
    const params = [];

    if (role) { query += ' AND role = ?'; params.push(role); }
    if (status) { query += ' AND status = ?'; params.push(status); }
    if (search) {
      query += ' AND (full_name LIKE ? OR email LIKE ? OR phone LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const users = db.prepare(query).all(...params);
    const total = db.prepare('SELECT COUNT(*) as count FROM users').get();

    res.json({ users, total: total.count });
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ error: 'Failed to fetch users.' });
  }
});

// POST /api/admin/users/:id/suspend
router.post('/users/:id/suspend', (req, res) => {
  try {
    const { action } = req.body; // 'suspend' or 'activate'
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (user.role === 'admin') {
      return res.status(403).json({ error: 'Cannot modify admin accounts.' });
    }

    const newStatus = action === 'suspend' ? 'suspended' : 'active';
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run(newStatus, user.id);

    if (user.role === 'driver') {
      db.prepare('UPDATE drivers SET is_online = 0 WHERE user_id = ?').run(user.id);
      if (action === 'suspend') {
        db.prepare('UPDATE drivers SET status = ? WHERE user_id = ?').run('suspended', user.id);
      }
    }

    res.json({ message: `User ${action === 'suspend' ? 'suspended' : 'activated'} successfully.` });
  } catch (err) {
    console.error('Suspend user error:', err);
    res.status(500).json({ error: 'Failed to update user status.' });
  }
});

// GET /api/admin/rides
router.get('/rides', (req, res) => {
  try {
    const { status, rideType, limit = 50, offset = 0 } = req.query;
    let query = `
      SELECT r.*, 
        p.full_name as passenger_name, p.phone as passenger_phone,
        du.full_name as driver_name, du.phone as driver_phone
      FROM rides r
      JOIN users p ON r.passenger_id = p.id
      LEFT JOIN drivers d ON r.driver_id = d.id
      LEFT JOIN users du ON d.user_id = du.id
      WHERE 1=1
    `;
    const params = [];

    if (status) { query += ' AND r.status = ?'; params.push(status); }
    if (rideType) { query += ' AND r.ride_type = ?'; params.push(rideType); }

    query += ' ORDER BY r.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const rides = db.prepare(query).all(...params);
    res.json({ rides });
  } catch (err) {
    console.error('Get rides error:', err);
    res.status(500).json({ error: 'Failed to fetch rides.' });
  }
});

// GET /api/admin/complaints
router.get('/complaints', (req, res) => {
  try {
    const { status } = req.query;
    let query = `
      SELECT c.*, u.full_name as user_name, u.email as user_email,
        r.pickup_address, r.drop_address, r.ride_type
      FROM complaints c
      JOIN users u ON c.user_id = u.id
      LEFT JOIN rides r ON c.ride_id = r.id
    `;
    const params = [];

    if (status) {
      query += ' WHERE c.status = ?';
      params.push(status);
    }

    query += ' ORDER BY c.created_at DESC';

    const complaints = db.prepare(query).all(...params);
    res.json({ complaints });
  } catch (err) {
    console.error('Get complaints error:', err);
    res.status(500).json({ error: 'Failed to fetch complaints.' });
  }
});

// POST /api/admin/complaints/:id/resolve
router.post('/complaints/:id/resolve', (req, res) => {
  try {
    const { response, status } = req.body;

    db.prepare(`
      UPDATE complaints SET 
        status = ?, admin_response = ?, resolved_by = ?, resolved_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status || 'resolved', response, req.user.id, req.params.id);

    const complaint = db.prepare('SELECT user_id FROM complaints WHERE id = ?').get(req.params.id);
    if (complaint) {
      db.prepare(`
        INSERT INTO notifications (user_id, type, title, message)
        VALUES (?, 'complaint_resolved', 'Complaint Update', ?)
      `).run(complaint.user_id, `Your complaint has been addressed: ${response}`);
    }

    res.json({ message: 'Complaint resolved.' });
  } catch (err) {
    console.error('Resolve complaint error:', err);
    res.status(500).json({ error: 'Failed to resolve complaint.' });
  }
});

// GET /api/admin/analytics
router.get('/analytics', (req, res) => {
  try {
    // Revenue by day (last 30 days)
    const revenueByDay = db.prepare(`
      SELECT date(completed_at) as date, SUM(fare_final) as revenue, COUNT(*) as rides
      FROM rides WHERE status = 'completed' AND completed_at >= datetime('now', '-30 days')
      GROUP BY date(completed_at) ORDER BY date ASC
    `).all();

    // Rides by hour (peak hours analysis)
    const ridesByHour = db.prepare(`
      SELECT strftime('%H', created_at) as hour, COUNT(*) as count
      FROM rides WHERE created_at >= datetime('now', '-30 days')
      GROUP BY hour ORDER BY hour ASC
    `).all();

    // Top drivers by earnings
    const topDrivers = db.prepare(`
      SELECT d.id, u.full_name, d.total_rides, d.total_earnings, d.rating_avg
      FROM drivers d JOIN users u ON d.user_id = u.id
      WHERE d.status = 'approved'
      ORDER BY d.total_earnings DESC LIMIT 10
    `).all();

    // Ride type distribution
    const rideTypeStats = db.prepare(`
      SELECT ride_type, COUNT(*) as count, SUM(fare_final) as revenue
      FROM rides WHERE status = 'completed'
      GROUP BY ride_type
    `).all();

    // Gender preference stats
    const genderPrefStats = db.prepare(`
      SELECT gender_pref, COUNT(*) as count
      FROM rides WHERE status = 'completed'
      GROUP BY gender_pref
    `).all();

    // Cancellation rate
    const totalRides = db.prepare('SELECT COUNT(*) as count FROM rides').get();
    const cancelledRides = db.prepare(`SELECT COUNT(*) as count FROM rides WHERE status = 'cancelled'`).get();

    res.json({
      revenueByDay,
      ridesByHour,
      topDrivers,
      rideTypeStats,
      genderPrefStats,
      cancellationRate: totalRides.count > 0 ? ((cancelledRides.count / totalRides.count) * 100).toFixed(1) : 0
    });
  } catch (err) {
    console.error('Analytics error:', err);
    res.status(500).json({ error: 'Failed to fetch analytics.' });
  }
});

module.exports = router;
