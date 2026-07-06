const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

let wss = null;
const clients = new Map(); // userId -> Set of WebSocket connections

function initWebSocket(server) {
  wss = new WebSocket.Server({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    // Extract token from query string
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');

    if (!token) {
      ws.close(4001, 'Authentication required');
      return;
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      ws.userId = decoded.id;
      ws.userRole = decoded.role;

      // Add to clients map
      if (!clients.has(decoded.id)) {
        clients.set(decoded.id, new Set());
      }
      clients.get(decoded.id).add(ws);

      ws.send(JSON.stringify({ type: 'connected', message: 'WebSocket connected' }));

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          handleMessage(ws, message);
        } catch (e) {
          // Ignore malformed messages
        }
      });

      ws.on('close', () => {
        if (clients.has(ws.userId)) {
          clients.get(ws.userId).delete(ws);
          if (clients.get(ws.userId).size === 0) {
            clients.delete(ws.userId);
          }
        }
      });

    } catch (err) {
      ws.close(4001, 'Invalid token');
    }
  });

  console.log('✅ WebSocket server initialized');
}

function handleMessage(ws, message) {
  switch (message.type) {
    case 'driver_location_update':
    case 'driver_location':
      // Driver sends their location periodically
      if (ws.userRole === 'driver') {
        // Broadcast to relevant passengers
        broadcastDriverLocation(ws.userId, message.lat, message.lng, message.rideId);
      }
      break;
      
    case 'passenger_location':
      // Passenger sends their location periodically
      if (ws.userRole === 'passenger') {
        const messageStr = JSON.stringify({
          type: 'passenger_location',
          passengerId: ws.userId,
          lat: message.lat,
          lng: message.lng,
          rideId: message.rideId,
          timestamp: Date.now()
        });
        
        // Broadcast to all connected clients except the sender
        clients.forEach((sockets, userId) => {
          sockets.forEach(socket => {
            if (socket.readyState === WebSocket.OPEN && socket.userId !== ws.userId) {
              socket.send(messageStr);
            }
          });
        });
      }
      break;

    case 'ping':
      ws.send(JSON.stringify({ type: 'pong' }));
      break;
  }
}

function broadcastDriverLocation(driverId, lat, lng, rideId) {
  // Update driver location in DB would happen here
  // For now, broadcast to all connected clients who care about this ride
  const message = JSON.stringify({
    type: 'driver_location',
    driverId,
    lat,
    lng,
    rideId,
    timestamp: Date.now()
  });

  // In a real system, we'd only send to passengers of this ride
  clients.forEach((sockets, userId) => {
    sockets.forEach(socket => {
      if (socket.readyState === WebSocket.OPEN && socket.userId !== driverId) {
        socket.send(message);
      }
    });
  });
}

// Send notification to a specific user
function sendToUser(userId, data) {
  const userSockets = clients.get(userId);
  if (userSockets) {
    const message = JSON.stringify(data);
    userSockets.forEach(socket => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(message);
      }
    });
  }
}

// Broadcast to all users with a specific role
function broadcastToRole(role, data) {
  const message = JSON.stringify(data);
  clients.forEach((sockets, userId) => {
    sockets.forEach(socket => {
      if (socket.readyState === WebSocket.OPEN && socket.userRole === role) {
        socket.send(message);
      }
    });
  });
}

module.exports = { initWebSocket, sendToUser, broadcastToRole, broadcastDriverLocation };
