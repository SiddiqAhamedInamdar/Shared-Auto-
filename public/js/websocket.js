// ═══════════════════════════════════════════════
// ShareAuto — WebSocket Client
// Real-time communication for ride tracking
// ═══════════════════════════════════════════════

const WS = {
  socket: null,
  listeners: new Map(),
  reconnectAttempts: 0,
  maxReconnects: 5,
  reconnectDelay: 3000,

  connect() {
    const token = API.getToken();
    if (!token) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?token=${token}`;

    try {
      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = () => {
        console.log('🔌 WebSocket connected');
        this.reconnectAttempts = 0;
      };

      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.emit(data.type, data);
        } catch (e) { /* ignore */ }
      };

      this.socket.onclose = (event) => {
        console.log('🔌 WebSocket disconnected');
        if (event && event.code === 4001) {
          console.warn('WebSocket connection closed due to authentication failure (4001). Reconnect stopped.');
          return;
        }
        this.tryReconnect();
      };

      this.socket.onerror = () => {
        // Will trigger onclose
      };
    } catch (e) {
      console.error('WebSocket error:', e);
    }
  },

  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.listeners.clear();
  },

  tryReconnect() {
    if (this.reconnectAttempts >= this.maxReconnects) return;
    this.reconnectAttempts++;
    setTimeout(() => this.connect(), this.reconnectDelay);
  },

  send(data) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data));
    }
  },

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
  },

  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  },

  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(cb => cb(data));
    }
  }
};
