const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'shareauto.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// ─── Wrapper that mimics better-sqlite3 API ───
// sql.js uses a different API than better-sqlite3.
// This wrapper provides .prepare().run/get/all() to match existing code.

class DatabaseWrapper {
  constructor(sqliteDb) {
    this._db = sqliteDb;
  }

  prepare(sql) {
    const db = this._db;
    return {
      run(...params) {
        db.run(sql, params);
        return {
          changes: db.getRowsModified(),
          lastInsertRowid: getLastInsertRowid(db)
        };
      },
      get(...params) {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        if (stmt.step()) {
          const row = stmt.getAsObject();
          stmt.free();
          return row;
        }
        stmt.free();
        return undefined;
      },
      all(...params) {
        const results = [];
        const stmt = db.prepare(sql);
        stmt.bind(params);
        while (stmt.step()) {
          results.push(stmt.getAsObject());
        }
        stmt.free();
        return results;
      }
    };
  }

  exec(sql) {
    this._db.run(sql);
  }

  pragma(pragmaStr) {
    try {
      this._db.run(`PRAGMA ${pragmaStr}`);
    } catch (e) {
      // Some pragmas may not be supported in WASM, ignore silently
    }
  }

  close() {
    this._db.close();
  }
}

function getLastInsertRowid(sqliteDb) {
  const stmt = sqliteDb.prepare('SELECT last_insert_rowid() as id');
  stmt.step();
  const row = stmt.getAsObject();
  stmt.free();
  return row.id;
}

// ─── Persistence helpers ───
function saveDatabase() {
  if (!dbInstance) return;
  try {
    const data = dbInstance._db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  } catch (e) {
    console.error('Failed to save database:', e);
  }
}

// Auto-save every 5 seconds
let saveInterval = null;

// ─── Global db instance ───
let dbInstance = null;

// Synchronous initialization (called once at startup after async init)
let dbReady = false;

async function initializeDatabase() {
  const SQL = await initSqlJs();

  let sqliteDb;
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    sqliteDb = new SQL.Database(fileBuffer);
  } else {
    sqliteDb = new SQL.Database();
  }

  dbInstance = new DatabaseWrapper(sqliteDb);

  // Enable foreign keys
  dbInstance.pragma('foreign_keys = ON');

  // Create tables
  dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('passenger', 'driver', 'admin')),
      gender TEXT DEFAULT 'other' CHECK(gender IN ('male', 'female', 'other')),
      avatar TEXT,
      wallet_balance REAL DEFAULT 0,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'deleted')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS drivers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      license_number TEXT NOT NULL,
      license_photo TEXT,
      profile_photo TEXT,
      experience_years INTEGER DEFAULT 0,
      is_online INTEGER DEFAULT 0,
      current_lat REAL,
      current_lng REAL,
      rating_avg REAL DEFAULT 5.0,
      total_rides INTEGER DEFAULT 0,
      total_earnings REAL DEFAULT 0,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'suspended')),
      verified_at DATETIME,
      verified_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (verified_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_id INTEGER NOT NULL,
      registration_number TEXT NOT NULL,
      vehicle_type TEXT DEFAULT 'auto' CHECK(vehicle_type IN ('auto', 'e-auto')),
      model TEXT,
      color TEXT,
      photo TEXT,
      capacity INTEGER DEFAULT 3,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'maintenance')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (driver_id) REFERENCES drivers(id)
    );

    CREATE TABLE IF NOT EXISTS shared_ride_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_id INTEGER,
      status TEXT DEFAULT 'forming' CHECK(status IN ('forming', 'matched', 'in_progress', 'completed', 'cancelled')),
      max_passengers INTEGER DEFAULT 3,
      current_passengers INTEGER DEFAULT 0,
      route_direction REAL,
      center_pickup_lat REAL,
      center_pickup_lng REAL,
      center_drop_lat REAL,
      center_drop_lng REAL,
      gender_pref TEXT DEFAULT 'no_preference',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME,
      FOREIGN KEY (driver_id) REFERENCES drivers(id)
    );

    CREATE TABLE IF NOT EXISTS rides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      passenger_id INTEGER NOT NULL,
      driver_id INTEGER,
      ride_type TEXT NOT NULL CHECK(ride_type IN ('private', 'shared')),
      pickup_lat REAL NOT NULL,
      pickup_lng REAL NOT NULL,
      pickup_address TEXT NOT NULL,
      drop_lat REAL NOT NULL,
      drop_lng REAL NOT NULL,
      drop_address TEXT NOT NULL,
      gender_pref TEXT DEFAULT 'no_preference' CHECK(gender_pref IN ('female_only', 'male_only', 'no_preference')),
      status TEXT DEFAULT 'requested' CHECK(status IN ('requested', 'matching', 'matched', 'accepted', 'driver_arriving', 'started', 'completed', 'cancelled')),
      fare_estimate REAL,
      fare_final REAL,
      distance_km REAL,
      duration_min REAL,
      shared_group_id INTEGER,
      otp TEXT,
      cancelled_by TEXT,
      cancel_reason TEXT,
      started_at DATETIME,
      completed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (passenger_id) REFERENCES users(id),
      FOREIGN KEY (driver_id) REFERENCES drivers(id),
      FOREIGN KEY (shared_group_id) REFERENCES shared_ride_groups(id)
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ride_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      method TEXT DEFAULT 'cash' CHECK(method IN ('cash', 'wallet', 'upi')),
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'refunded', 'failed')),
      transaction_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ride_id) REFERENCES rides(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ride_id INTEGER NOT NULL,
      reviewer_id INTEGER NOT NULL,
      reviewee_id INTEGER NOT NULL,
      rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
      comment TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ride_id) REFERENCES rides(id),
      FOREIGN KEY (reviewer_id) REFERENCES users(id),
      FOREIGN KEY (reviewee_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      data TEXT,
      read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS complaints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      ride_id INTEGER,
      subject TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT DEFAULT 'open' CHECK(status IN ('open', 'investigating', 'resolved', 'closed')),
      admin_response TEXT,
      resolved_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (ride_id) REFERENCES rides(id),
      FOREIGN KEY (resolved_by) REFERENCES users(id)
    );
  `);

  // Create indexes (one at a time for sql.js compatibility)
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)',
    'CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)',
    'CREATE INDEX IF NOT EXISTS idx_drivers_user_id ON drivers(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_drivers_status ON drivers(status)',
    'CREATE INDEX IF NOT EXISTS idx_rides_passenger ON rides(passenger_id)',
    'CREATE INDEX IF NOT EXISTS idx_rides_driver ON rides(driver_id)',
    'CREATE INDEX IF NOT EXISTS idx_rides_status ON rides(status)',
    'CREATE INDEX IF NOT EXISTS idx_rides_shared_group ON rides(shared_group_id)',
    'CREATE INDEX IF NOT EXISTS idx_payments_ride ON payments(ride_id)',
    'CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status)'
  ];
  indexes.forEach(idx => dbInstance.exec(idx));

  // Seed admin account
  const adminExists = dbInstance.prepare('SELECT id FROM users WHERE email = ?')
    .get(process.env.ADMIN_EMAIL || 'admin@shareauto.com');
  
  if (!adminExists) {
    const hashedPassword = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'Admin@123', 12);
    dbInstance.prepare(`
      INSERT INTO users (email, password_hash, full_name, phone, role, gender, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      process.env.ADMIN_EMAIL || 'admin@shareauto.com',
      hashedPassword,
      'System Admin',
      '0000000000',
      'admin',
      'other',
      'active'
    );
    console.log('✅ Admin account seeded');
  }

  // Save to disk
  saveDatabase();

  // Auto-save periodically
  saveInterval = setInterval(saveDatabase, 5000);

  dbReady = true;
  console.log('✅ Database initialized (sql.js WASM)');
}

// Proxy that allows `const { db } = require(...)` to work even before async init
const dbProxy = new Proxy({}, {
  get(target, prop) {
    if (!dbInstance) {
      throw new Error('Database not initialized yet. Call initializeDatabase() first.');
    }
    const val = dbInstance[prop];
    if (typeof val === 'function') {
      return val.bind(dbInstance);
    }
    return val;
  }
});

// Graceful shutdown: save on exit
process.on('SIGINT', () => { saveDatabase(); process.exit(0); });
process.on('SIGTERM', () => { saveDatabase(); process.exit(0); });
process.on('exit', () => { saveDatabase(); });

module.exports = { db: dbProxy, initializeDatabase, saveDatabase };
