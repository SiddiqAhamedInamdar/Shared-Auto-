require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const { initializeDatabase } = require('./src/config/database');
const { initWebSocket } = require('./src/services/websocket');
const { processExpiredGroups } = require('./src/services/rideMatching');

const app = express();
const server = http.createServer(app);

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  const oldJson = res.json;
  res.json = function(data) {
    console.log(`[Response] ${req.method} ${req.url} -> Status ${res.statusCode}:`, data);
    return oldJson.apply(this, arguments);
  };
  next();
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

// API Routes
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/passenger', require('./src/routes/passenger'));
app.use('/api/driver', require('./src/routes/driver'));
app.use('/api/admin', require('./src/routes/admin'));

// Serve admin portal at /admin
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/admin/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// SPA fallback — serve index.html for all non-API routes
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// Boot sequence (async for sql.js WASM init)
async function boot() {
  // Initialize database (async — loads WASM)
  await initializeDatabase();

  // Initialize WebSocket
  initWebSocket(server);

  // Process expired shared ride groups every 30 seconds
  setInterval(() => {
    try {
      processExpiredGroups();
    } catch (err) {
      console.error('Group processing error:', err);
    }
  }, 30000);

  // Start server
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`
  ╔═══════════════════════════════════════════╗
  ║                                           ║
  ║   🚗  ShareAuto Server Running!           ║
  ║                                           ║
  ║   Main App:  http://localhost:${PORT}         ║
  ║   Admin:     http://localhost:${PORT}/admin    ║
  ║                                           ║
  ║   Admin Login:                            ║
  ║   Email: admin@shareauto.com              ║
  ║   Pass:  Admin@123                        ║
  ║                                           ║
  ╚═══════════════════════════════════════════╝
  `);
  });
}

boot().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
