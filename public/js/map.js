// ═══════════════════════════════════════════════
// ShareAuto — Map Integration (Leaflet + OSM)
// ═══════════════════════════════════════════════

const MapService = {
  map: null,
  markers: {},
  routeLine: null,
  searchTimeout: null,

  init(containerId, options = {}) {
    const defaults = {
      center: [12.923981, 77.501526], // Bangalore (Pattanagere / RV Univ Road)
      zoom: 14,
      zoomControl: true
    };
    const config = { ...defaults, ...options };

    this.map = L.map(containerId, {
      zoomControl: config.zoomControl,
      attributionControl: false
    }).setView(config.center, config.zoom);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(this.map);

    // Add attribution in corner
    L.control.attribution({ position: 'bottomright' }).addTo(this.map);

    return this.map;
  },

  destroy() {
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
    this.markers = {};
    this.routeLine = null;
  },

  // Create custom icon
  createIcon(color, emoji = '📍') {
    return L.divIcon({
      className: 'custom-marker',
      html: `<div style="
        background: ${color};
        width: 36px;
        height: 36px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        border: 3px solid white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      ">${emoji}</div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });
  },

  setMarker(id, lat, lng, options = {}) {
    if (this.markers[id]) {
      this.markers[id].setLatLng([lat, lng]);
    } else {
      const icon = options.icon || this.createIcon(options.color || '#6366f1', options.emoji || '📍');
      this.markers[id] = L.marker([lat, lng], { icon }).addTo(this.map);
    }

    if (options.popup) {
      this.markers[id].bindPopup(options.popup);
    }

    return this.markers[id];
  },

  removeMarker(id) {
    if (this.markers[id]) {
      this.map.removeLayer(this.markers[id]);
      delete this.markers[id];
    }
  },

  clearMarkers() {
    Object.keys(this.markers).forEach(id => this.removeMarker(id));
  },

  drawRoute(pickup, drop) {
    if (this.routeLine) {
      this.map.removeLayer(this.routeLine);
    }

    // Simple straight-line route (for demo — real app would use routing API)
    this.routeLine = L.polyline([pickup, drop], {
      color: '#6366f1',
      weight: 4,
      opacity: 0.8,
      dashArray: '10, 10',
      smoothFactor: 1
    }).addTo(this.map);

    // Fit bounds to show full route
    const bounds = L.latLngBounds([pickup, drop]);
    this.map.fitBounds(bounds, { padding: [60, 60] });
  },

  clearRoute() {
    if (this.routeLine) {
      this.map.removeLayer(this.routeLine);
      this.routeLine = null;
    }
  },

  // Geocode address to coordinates using Nominatim
  async geocode(query) {
    if (!query || query.length < 3) return [];

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&countrycodes=in`
      );
      const results = await response.json();
      return results.map(r => ({
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lon),
        display: r.display_name,
        short: r.display_name.split(',').slice(0, 3).join(', ')
      }));
    } catch (err) {
      console.error('Geocoding error:', err);
      return [];
    }
  },

  // Reverse geocode coordinates to address
  async reverseGeocode(lat, lng) {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`
      );
      const result = await response.json();
      return {
        display: result.display_name,
        short: result.display_name.split(',').slice(0, 3).join(', ')
      };
    } catch (err) {
      console.error('Reverse geocoding error:', err);
      return { display: `${lat.toFixed(4)}, ${lng.toFixed(4)}`, short: `${lat.toFixed(4)}, ${lng.toFixed(4)}` };
    }
  },

  // Debounced search
  searchLocation(query, callback) {
    clearTimeout(this.searchTimeout);
    this.searchTimeout = setTimeout(async () => {
      const results = await this.geocode(query);
      callback(results);
    }, 400);
  },

  // Get user's current location once
  getCurrentLocation() {
    return new Promise((resolve) => {
      const fallbackToClick = () => {
        if (window.showToast) window.showToast('GPS unavailable. Click map to set location manually.', 'warning');
        this.map.once('click', (e) => {
          resolve({ lat: e.latlng.lat, lng: e.latlng.lng });
        });
      };

      if (!navigator.geolocation) {
        return fallbackToClick();
      }

      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        err => {
          console.warn('Geolocation failed:', err);
          fallbackToClick();
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 }
      );
    });
  },

  // Watch live location
  watchLocation(callback, errorCallback) {
    if (!navigator.geolocation) {
      if (window.showToast) window.showToast('Live GPS unavailable. Click the map anywhere to simulate movement.', 'warning');
      
      // Fallback: Simulate movement by clicking on the map
      this.map.on('click', (e) => {
        callback({ lat: e.latlng.lat, lng: e.latlng.lng });
      });
      return 'simulated_watch_id';
    }

    const watchId = navigator.geolocation.watchPosition(
      pos => callback({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      err => {
        console.warn('Live location failed:', err);
        if (window.showToast) window.showToast('Live GPS failed. Click the map to simulate movement.', 'warning');
        
        // Fallback: Simulate movement by clicking on the map
        this.map.on('click', (e) => {
          callback({ lat: e.latlng.lat, lng: e.latlng.lng });
        });
        
        if (errorCallback) errorCallback(err);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 }
    );
    return watchId;
  },

  stopWatchingLocation(watchId) {
    if (watchId === 'simulated_watch_id') {
      this.map.off('click');
    } else if (navigator.geolocation && watchId) {
      navigator.geolocation.clearWatch(watchId);
    }
  },

  fitToMarkers() {
    const markerPositions = Object.values(this.markers).map(m => m.getLatLng());
    if (markerPositions.length > 0) {
      const bounds = L.latLngBounds(markerPositions);
      this.map.fitBounds(bounds, { padding: [60, 60] });
    }
  }
};
