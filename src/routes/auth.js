const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { validateEmail, validatePhone, validatePassword, sanitizeUser } = require('../utils/helpers');

const router = express.Router();

// POST /api/auth/signup
router.post('/signup', (req, res) => {
  try {
    const { email, password, fullName, phone, role, gender } = req.body;

    // Validation
    if (!email || !password || !fullName || !phone || !role) {
      return res.status(400).json({ error: 'All fields are required.' });
    }

    if (!validateEmail(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    if (!validatePhone(phone)) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit phone number.' });
    }

    if (!validatePassword(password)) {
      return res.status(400).json({ error: 'Password must be at least 6 characters with at least one letter and one number.' });
    }

    if (!['passenger', 'driver'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be passenger or driver.' });
    }

    // Check if email already exists
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    // Hash password
    const passwordHash = bcrypt.hashSync(password, 12);

    // Create user
    const result = db.prepare(`
      INSERT INTO users (email, password_hash, full_name, phone, role, gender, status)
      VALUES (?, ?, ?, ?, ?, ?, 'active')
    `).run(email, passwordHash, fullName, phone, role, gender || 'other');

    const userId = result.lastInsertRowid;

    // If driver, create driver record
    if (role === 'driver') {
      db.prepare(`
        INSERT INTO drivers (user_id, license_number, status)
        VALUES (?, '', 'pending')
      `).run(userId);
    }

    // Generate JWT
    const token = jwt.sign(
      { id: userId, email, role, fullName },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRY || '24h' }
    );

    const refreshToken = jwt.sign(
      { id: userId, email, role },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d' }
    );

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

    res.status(201).json({
      message: 'Account created successfully!',
      token,
      refreshToken,
      user: sanitizeUser(user)
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'Your account has been suspended. Contact support.' });
    }

    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Don't allow admin login through regular login
    if (user.role === 'admin') {
      return res.status(403).json({ error: 'Admin login is only available through the admin portal.' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, fullName: user.full_name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRY || '24h' }
    );

    const refreshToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d' }
    );

    // Get driver status if driver
    let driverStatus = null;
    if (user.role === 'driver') {
      const driver = db.prepare('SELECT status FROM drivers WHERE user_id = ?').get(user.id);
      driverStatus = driver ? driver.status : null;
    }

    res.json({
      message: 'Login successful!',
      token,
      refreshToken,
      user: sanitizeUser(user),
      driverStatus
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// POST /api/auth/admin/login
router.post('/admin/login', (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ? AND role = ?').get(email, 'admin');

    if (!user) {
      return res.status(401).json({ error: 'Invalid admin credentials.' });
    }

    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid admin credentials.' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: 'admin', fullName: user.full_name },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({
      message: 'Admin login successful!',
      token,
      user: sanitizeUser(user)
    });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    let driverInfo = null;
    let vehicleInfo = null;

    if (user.role === 'driver') {
      driverInfo = db.prepare('SELECT * FROM drivers WHERE user_id = ?').get(user.id);
      if (driverInfo) {
        vehicleInfo = db.prepare('SELECT * FROM vehicles WHERE driver_id = ?').get(driverInfo.id);
      }
    }

    res.json({
      user: sanitizeUser(user),
      driver: driverInfo || undefined,
      vehicle: vehicleInfo || undefined
    });
  } catch (err) {
    console.error('Get me error:', err);
    res.status(500).json({ error: 'Failed to fetch profile.' });
  }
});

// POST /api/auth/refresh
router.post('/refresh', (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required.' });
    }

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.id);

    if (!user || user.status !== 'active') {
      return res.status(401).json({ error: 'Invalid refresh token.' });
    }

    const newToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role, fullName: user.full_name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRY || '24h' }
    );

    res.json({ token: newToken });
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired refresh token.' });
  }
});

// PUT /api/auth/profile
router.put('/profile', authMiddleware, (req, res) => {
  try {
    const { fullName, phone, gender } = req.body;
    const updates = [];
    const values = [];

    if (fullName) { updates.push('full_name = ?'); values.push(fullName); }
    if (phone) {
      if (!validatePhone(phone)) {
        return res.status(400).json({ error: 'Invalid phone number.' });
      }
      updates.push('phone = ?'); values.push(phone);
    }
    if (gender) { updates.push('gender = ?'); values.push(gender); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update.' });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(req.user.id);

    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({ message: 'Profile updated.', user: sanitizeUser(user) });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Failed to update profile.' });
  }
});

module.exports = router;
