// ═══════════════════════════════════════════════
// ShareAuto — Passenger Dashboard Logic
// ═══════════════════════════════════════════════

const PassengerView = {
  pickupCoords: null,
  dropCoords: null,
  selectedRideType: 'private',
  selectedGenderPref: 'no_preference',
  activeRide: null,
  wsBound: false,

  renderHome(container) {
    container.innerHTML = `
      <div class="grid grid-2" style="grid-template-columns: 1.2fr 1.8fr; gap: 28px;">
        <!-- Left Side Panel (Dynamic: Booking or Tracking) -->
        <div id="passenger-control-panel">
          <div class="loader-container"><div class="spinner"></div><p>Checking active rides...</p></div>
        </div>
        
        <!-- Right Side Map Panel -->
        <div>
          <div class="map-container">
            <div id="booking-map"></div>
            <!-- Floating Map Instructions -->
            <div style="position: absolute; bottom: 12px; left: 12px; z-index: 10; background: rgba(10, 14, 26, 0.85); backdrop-filter: blur(8px); padding: 8px 12px; border-radius: var(--radius-sm); border: 1px solid var(--color-border); font-size: 0.75rem; color: var(--color-text-secondary); pointer-events: none;">
              <i class="fas fa-info-circle" style="color: var(--color-accent); margin-right: 4px;"></i> Click map to pin Pickup/Dropoff
            </div>
          </div>
        </div>
      </div>
      
      <!-- Hidden Rating Modal -->
      <div id="rating-modal-container"></div>
    `;

    // Initialize Map on next tick
    setTimeout(() => {
      MapService.init('booking-map');
      
      // Bind map click to set pins
      MapService.map.on('click', async (e) => {
        const { lat, lng } = e.latlng;
        await this.handleMapClick(lat, lng);
      });
      
      this.checkActiveRide();
    }, 0);
  },

  async handleMapClick(lat, lng) {
    // If active ride, map clicks do nothing
    if (this.activeRide) return;

    const pickupInput = document.getElementById('pickup-input');
    const dropInput = document.getElementById('drop-input');

    if (!this.pickupCoords) {
      this.pickupCoords = { lat, lng };
      MapService.setMarker('pickup', lat, lng, { color: '#10b981', emoji: '🟢', popup: 'Pickup Point' });
      
      if (pickupInput) {
        pickupInput.value = 'Locating...';
        const geo = await MapService.reverseGeocode(lat, lng);
        pickupInput.value = geo.short;
      }
    } else if (!this.dropCoords) {
      this.dropCoords = { lat, lng };
      MapService.setMarker('drop', lat, lng, { color: '#ef4444', emoji: '🔴', popup: 'Dropoff Point' });
      
      if (dropInput) {
        dropInput.value = 'Locating...';
        const geo = await MapService.reverseGeocode(lat, lng);
        dropInput.value = geo.short;
      }
      MapService.drawRoute(this.pickupCoords, this.dropCoords);
      this.updateFareEstimate();
    } else {
      // Reset drop coords on third click
      this.dropCoords = null;
      MapService.clearRoute();
      MapService.removeMarker('drop');
      if (dropInput) dropInput.value = '';
      
      this.pickupCoords = { lat, lng };
      MapService.setMarker('pickup', lat, lng, { color: '#10b981', emoji: '🟢', popup: 'Pickup Point' });
      if (pickupInput) {
        pickupInput.value = 'Locating...';
        const geo = await MapService.reverseGeocode(lat, lng);
        pickupInput.value = geo.short;
      }
    }
  },

  async checkActiveRide() {
    try {
      const res = await API.get('/api/passenger/rides/active');
      if (res.ride) {
        this.activeRide = res.ride;
        this.renderTrackingPanel(res.ride, res.coPassengers);
        this.bindWebSocket();
        this.startLocationTracking();
      } else {
        this.activeRide = null;
        this.stopLocationTracking();
        this.renderBookingPanel();
      }
    } catch (err) {
      app.showToast('Failed to check active rides', 'error');
      this.stopLocationTracking();
      this.renderBookingPanel();
    }
  },

  startLocationTracking() {
    if (this.watchId) return;
    this.watchId = MapService.watchLocation(
      (coords) => {
        MapService.setMarker('passenger', coords.lat, coords.lng, { color: '#3b82f6', emoji: '🧑', popup: 'Your Location' });
        
        if (this.activeRide && this.wsBound && WS.socket && WS.socket.readyState === WebSocket.OPEN) {
          WS.socket.send(JSON.stringify({
            type: 'passenger_location',
            lat: coords.lat,
            lng: coords.lng,
            rideId: this.activeRide.id
          }));
        }
      },
      (err) => console.warn('Passenger tracking error', err)
    );
  },

  stopLocationTracking() {
    if (this.watchId) {
      MapService.stopWatchingLocation(this.watchId);
      this.watchId = null;
    }
  },

  renderBookingPanel() {
    this.pickupCoords = null;
    this.dropCoords = null;
    this.selectedRideType = 'private';
    this.selectedGenderPref = 'no_preference';
    MapService.clearMarkers();
    MapService.clearRoute();

    const panel = document.getElementById('passenger-control-panel');
    panel.innerHTML = `
      <div class="booking-panel" style="margin-top: 0;">
        <h3 style="margin-bottom: 20px;"><i class="fas fa-search-location" style="color: var(--color-accent); margin-right: 8px;"></i>Book Auto Ride</h3>
        
        <!-- Pickup Address Form -->
        <div class="form-group" style="position: relative;">
          <label class="form-label" style="display: flex; justify-content: space-between;">
            <span>Pickup Location</span>
            <span style="font-size: 0.75rem; color: var(--color-accent); cursor: pointer;" onclick="PassengerView.useGPSLocation()"><i class="fas fa-gps"></i> Use GPS</span>
          </label>
          <input type="text" id="pickup-input" class="form-control" placeholder="Search pickup point..." autocomplete="off">
          <div id="pickup-suggestions" class="location-suggestions" style="display: none;"></div>
        </div>

        <!-- Dropoff Address Form -->
        <div class="form-group" style="position: relative;">
          <label class="form-label">Dropoff Location</label>
          <input type="text" id="drop-input" class="form-control" placeholder="Search dropoff point..." autocomplete="off">
          <div id="drop-suggestions" class="location-suggestions" style="display: none;"></div>
        </div>

        <!-- Ride Type Selection -->
        <div class="booking-section">
          <div class="booking-section-title">Select Ride Option</div>
          <div class="ride-type-selector">
            <div class="ride-type-card selected" id="type-private" onclick="PassengerView.setRideType('private')">
              <div class="ride-type-icon">🛺</div>
              <div class="ride-type-name">Private Auto</div>
              <div class="ride-type-desc">Direct, private travel</div>
              <div class="ride-type-price" id="private-estimate">—</div>
            </div>
            <div class="ride-type-card" id="type-shared" onclick="PassengerView.setRideType('shared')">
              <div class="ride-type-icon">👥</div>
              <div class="ride-type-name">Shared Auto</div>
              <div class="ride-type-desc">Split fare with others</div>
              <div class="ride-type-price" id="shared-estimate">—</div>
            </div>
          </div>
        </div>

        <!-- Gender Pref (Shared only) -->
        <div class="booking-section" id="gender-pref-section" style="display: none;">
          <div class="booking-section-title">Gender Preference</div>
          <div class="gender-pref-selector">
            <div class="gender-pref-option selected" onclick="PassengerView.setGenderPref('no_preference', this)">
              <div class="gender-pref-icon">🌍</div>
              <div class="gender-pref-label">No Preference</div>
            </div>
            <div class="gender-pref-option" onclick="PassengerView.setGenderPref('female_only', this)">
              <div class="gender-pref-icon">👩</div>
              <div class="gender-pref-label">Female Only</div>
            </div>
            <div class="gender-pref-option" onclick="PassengerView.setGenderPref('male_only', this)">
              <div class="gender-pref-icon">👨</div>
              <div class="gender-pref-label">Male Only</div>
            </div>
          </div>
        </div>

        <button class="btn btn-primary btn-block" style="width: 100%; margin-top: 16px;" id="book-btn" onclick="PassengerView.bookRide()" disabled>
          Book Ride <i class="fas fa-chevron-right"></i>
        </button>
      </div>
    `;

    this.setupGeocoding();
  },

  async useGPSLocation() {
    try {
      const pickupInput = document.getElementById('pickup-input');
      if (pickupInput) pickupInput.value = 'Locating current location...';
      const pos = await MapService.getCurrentLocation();
      this.pickupCoords = pos;
      MapService.setMarker('pickup', pos.lat, pos.lng, { color: '#10b981', emoji: '🟢', popup: 'Current Location' });
      MapService.map.setView([pos.lat, pos.lng], 15);
      
      const geo = await MapService.reverseGeocode(pos.lat, pos.lng);
      if (pickupInput) pickupInput.value = geo.short;
      
      if (this.dropCoords) {
        MapService.drawRoute(this.pickupCoords, this.dropCoords);
        this.updateFareEstimate();
      }
    } catch (err) {
      app.showToast('Could not access device GPS', 'warning');
      const pickupInput = document.getElementById('pickup-input');
      if (pickupInput) pickupInput.value = '';
    }
  },

  setupGeocoding() {
    const pickupInput = document.getElementById('pickup-input');
    const pickupSugg = document.getElementById('pickup-suggestions');
    const dropInput = document.getElementById('drop-input');
    const dropSugg = document.getElementById('drop-suggestions');

    const handleSearch = (input, container, type) => {
      input.oninput = (e) => {
        const val = e.target.value;
        if (val.length < 3) {
          container.style.display = 'none';
          return;
        }

        MapService.searchLocation(val, (results) => {
          if (results.length === 0) {
            container.style.display = 'none';
            return;
          }
          container.innerHTML = results.map(r => `
            <div class="suggestion-item" onclick="PassengerView.selectSuggestion('${type}', ${r.lat}, ${r.lng}, '${r.short.replace(/'/g, "\\'")}')">
              <i class="suggestion-icon fas fa-map-marker-alt"></i>
              <span class="suggestion-text">${r.short}</span>
            </div>
          `).join('');
          container.style.display = 'block';
        });
      };

      // Hide suggestions on click outside
      document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !container.contains(e.target)) {
          container.style.display = 'none';
        }
      });
    };

    handleSearch(pickupInput, pickupSugg, 'pickup');
    handleSearch(dropInput, dropSugg, 'drop');
  },

  selectSuggestion(type, lat, lng, address) {
    if (type === 'pickup') {
      this.pickupCoords = { lat, lng };
      document.getElementById('pickup-input').value = address;
      document.getElementById('pickup-suggestions').style.display = 'none';
      MapService.setMarker('pickup', lat, lng, { color: '#10b981', emoji: '🟢', popup: 'Pickup' });
    } else {
      this.dropCoords = { lat, lng };
      document.getElementById('drop-input').value = address;
      document.getElementById('drop-suggestions').style.display = 'none';
      MapService.setMarker('drop', lat, lng, { color: '#ef4444', emoji: '🔴', popup: 'Dropoff' });
    }

    MapService.map.setView([lat, lng], 14);

    if (this.pickupCoords && this.dropCoords) {
      MapService.drawRoute(this.pickupCoords, this.dropCoords);
      this.updateFareEstimate();
    }
  },

  setRideType(type) {
    this.selectedRideType = type;
    document.getElementById('type-private').classList.toggle('selected', type === 'private');
    document.getElementById('type-shared').classList.toggle('selected', type === 'shared');
    
    document.getElementById('gender-pref-section').style.display = type === 'shared' ? 'block' : 'none';
  },

  setGenderPref(pref, element) {
    this.selectedGenderPref = pref;
    const opts = element.parentNode.querySelectorAll('.gender-pref-option');
    opts.forEach(opt => opt.classList.remove('selected'));
    element.classList.add('selected');
  },

  async updateFareEstimate() {
    if (!this.pickupCoords || !this.dropCoords) return;

    try {
      const privateRes = await API.post('/api/passenger/fare-estimate', {
        pickupLat: this.pickupCoords.lat,
        pickupLng: this.pickupCoords.lng,
        dropLat: this.dropCoords.lat,
        dropLng: this.dropCoords.lng,
        rideType: 'private'
      });

      const sharedRes = await API.post('/api/passenger/fare-estimate', {
        pickupLat: this.pickupCoords.lat,
        pickupLng: this.pickupCoords.lng,
        dropLat: this.dropCoords.lat,
        dropLng: this.dropCoords.lng,
        rideType: 'shared'
      });

      document.getElementById('private-estimate').textContent = `₹${privateRes.fare.total.toFixed(0)}`;
      document.getElementById('shared-estimate').textContent = `₹${sharedRes.fare.total.toFixed(0)}`;
      document.getElementById('book-btn').disabled = false;
    } catch (err) {
      console.error(err);
    }
  },

  async bookRide() {
    if (!this.pickupCoords || !this.dropCoords) return;

    const pickupAddress = document.getElementById('pickup-input').value;
    const dropAddress = document.getElementById('drop-input').value;

    const bookBtn = document.getElementById('book-btn');
    bookBtn.disabled = true;
    bookBtn.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i> Requesting Ride...`;

    try {
      const res = await API.post('/api/passenger/book', {
        pickupLat: this.pickupCoords.lat,
        pickupLng: this.pickupCoords.lng,
        pickupAddress,
        dropLat: this.dropCoords.lat,
        dropLng: this.dropCoords.lng,
        dropAddress,
        rideType: this.selectedRideType,
        genderPref: this.selectedGenderPref
      });

      app.showToast(res.message, 'success');
      this.checkActiveRide();
    } catch (err) {
      app.showToast(err.error || 'Failed to book ride', 'error');
      bookBtn.disabled = false;
      bookBtn.innerHTML = `Book Ride <i class="fas fa-chevron-right"></i>`;
    }
  },

  renderTrackingPanel(ride, coPassengers = []) {
    const panel = document.getElementById('passenger-control-panel');
    
    // Clear booking markers, set live tracking markers
    MapService.clearMarkers();
    MapService.setMarker('pickup', ride.pickup_lat, ride.pickup_lng, { color: '#10b981', emoji: '🟢', popup: 'Pickup' });
    MapService.setMarker('drop', ride.drop_lat, ride.drop_lng, { color: '#ef4444', emoji: '🔴', popup: 'Dropoff' });
    MapService.drawRoute([ride.pickup_lat, ride.pickup_lng], [ride.drop_lat, ride.drop_lng]);

    if (ride.driver_lat && ride.driver_lng) {
      MapService.setMarker('driver', ride.driver_lat, ride.driver_lng, { color: '#f59e0b', emoji: '🛺', popup: `Driver: ${ride.driver_name}` });
      MapService.fitToMarkers();
    }

    const initials = ride.driver_name ? ride.driver_name.split(' ').map(n => n[0]).join('').substring(0,2).toUpperCase() : 'DR';
    
    let statusText = 'Finding Driver';
    let statusDesc = 'Connecting matching auto rickshaws...';
    let stepClass1 = '', stepClass2 = '', stepClass3 = '';
    
    if (ride.status === 'matching') {
      statusText = 'Forming Group';
      statusDesc = 'Matching shared co-passengers...';
    } else if (ride.status === 'matched') {
      statusText = 'Driver Assigned';
      statusDesc = 'Rickshaw partner has been found!';
      stepClass1 = 'active';
    } else if (ride.status === 'accepted' || ride.status === 'driver_arriving') {
      statusText = 'Driver En Route';
      statusDesc = 'Rickshaw partner is arriving at pickup location';
      stepClass1 = 'active';
    } else if (ride.status === 'started') {
      statusText = 'Ride Started';
      statusDesc = 'Safe travels! En route to dropoff destination';
      stepClass1 = 'active';
      stepClass2 = 'active';
    }

    let coPassengerHtml = '';
    if (ride.ride_type === 'shared') {
      const companions = coPassengers.map(c => `
        <div style="display: flex; align-items: center; gap: 8px; font-size: 0.8rem; background: var(--color-bg-glass); padding: 6px 12px; border-radius: var(--radius-sm); border: 1px solid var(--color-border);">
          <i class="fas ${c.gender === 'female' ? 'fa-female' : 'fa-male'}" style="color: var(--color-text-accent)"></i>
          <span>${c.full_name}</span>
        </div>
      `).join('');
      
      coPassengerHtml = companions.length > 0 ? `
        <div class="booking-section" style="margin-top: 16px;">
          <div class="booking-section-title">Co-Passengers</div>
          <div style="display: flex; flex-wrap: wrap; gap: 8px;">
            ${companions}
          </div>
        </div>
      ` : `
        <div class="booking-section" style="margin-top: 16px;">
          <div class="booking-section-title">Co-Passengers</div>
          <p style="font-size: 0.75rem; color: var(--color-text-muted);"><i class="fas fa-spinner fa-spin"></i> Waiting for passengers matching your direction...</p>
        </div>
      `;
    }

    panel.innerHTML = `
      <div class="booking-panel" style="margin-top: 0;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
          <div>
            <h3>${statusText}</h3>
            <p style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 2px;">${statusDesc}</p>
          </div>
          <span class="badge ${ride.ride_type === 'shared' ? 'badge-primary' : 'badge-success'}">${ride.ride_type.toUpperCase()}</span>
        </div>

        <!-- Progress Steps -->
        <div class="status-flow">
          <div class="status-step">
            <div class="status-dot ${stepClass1 || 'active'}"></div>
            <span style="font-size: 0.7rem; color: var(--color-text-muted); margin-top: 4px;">Assigned</span>
          </div>
          <div class="status-step">
            <div class="status-dot ${stepClass2}"></div>
            <span style="font-size: 0.7rem; color: var(--color-text-muted); margin-top: 4px;">Started</span>
          </div>
          <div class="status-step">
            <div class="status-dot ${stepClass3}"></div>
            <span style="font-size: 0.7rem; color: var(--color-text-muted); margin-top: 4px;">Completed</span>
          </div>
        </div>

        <!-- Driver Info (if assigned) -->
        ${ride.driver_id ? `
          <div class="tracking-driver" style="margin-top: 20px;">
            <div class="tracking-driver-avatar">${initials}</div>
            <div class="tracking-driver-info">
              <div class="tracking-driver-name">${ride.driver_name}</div>
              <div class="tracking-driver-vehicle"><i class="fas fa-shuttle-van"></i> ${ride.vehicle_color || 'Yellow'} Auto (${ride.vehicle_number || 'N/A'})</div>
              <div class="tracking-driver-rating"><i class="fas fa-star"></i> ${ride.driver_rating.toFixed(1)}</div>
            </div>
            <div class="tracking-actions">
              <a href="tel:${ride.driver_phone}" class="tracking-action-btn"><i class="fas fa-phone"></i></a>
            </div>
          </div>
        ` : `
          <div class="loader-container" style="padding: 20px 0;"><div class="spinner spinner-sm"></div><p style="font-size:0.8rem;">Searching nearest driver...</p></div>
        `}

        <!-- Co-Passengers (shared) -->
        ${coPassengerHtml}

        <!-- OTP Section -->
        ${(ride.status !== 'started' && ride.driver_id) ? `
          <div class="tracking-otp">
            <div class="tracking-otp-label">Share OTP with Driver to Start</div>
            <div class="tracking-otp-code">${ride.otp}</div>
          </div>
        ` : ''}

        <!-- Fare details -->
        <div class="fare-summary" style="margin-top: 20px;">
          <div class="fare-row">
            <span>Estimated Fare</span>
            <span style="font-weight: 600; color: var(--color-text-primary)">₹${ride.fare_estimate.toFixed(0)}</span>
          </div>
          <div class="fare-row">
            <span>Route Distance</span>
            <span>${ride.distance_km.toFixed(1)} km</span>
          </div>
        </div>

        ${ride.status !== 'started' && ride.status !== 'completed' ? `
          <button class="btn btn-danger btn-block" style="width: 100%; margin-top: 20px;" onclick="PassengerView.cancelRide(${ride.id})">
            Cancel Booking
          </button>
        ` : ''}
      </div>
      
      ${ride.status === 'completed' ? `
        <div class="modal-overlay active" style="display: flex; align-items: center; justify-content: center; position: fixed; top:0; left:0; right:0; bottom:0; background:rgba(10, 14, 26, 0.95); z-index:9999;" id="payment-modal">
          <div class="ride-request-card" style="width: 100%; max-width: 400px; padding: 32px 24px; text-align: left; background: var(--color-bg-secondary); border-radius: var(--radius-xl); box-shadow: 0 10px 40px rgba(0,0,0,0.6); border: 1px solid var(--color-border);">
            
            <div style="text-align: center; margin-bottom: 24px;">
              <div style="width: 64px; height: 64px; background: var(--color-success-bg); color: var(--color-success); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 28px; margin: 0 auto 16px;">
                <i class="fas fa-check-circle"></i>
              </div>
              <h2 style="font-size: 1.5rem; margin-bottom: 4px; color: var(--color-text-primary);">Ride Completed!</h2>
              <p style="color: var(--color-text-muted); font-size: 0.9rem;">Please settle your fare with the driver.</p>
            </div>
            
            <div class="fare-summary" style="margin-bottom: 28px; background: var(--color-bg-tertiary); padding: 20px; border-radius: var(--radius-lg); text-align: center; border: 1px solid var(--color-border-hover);">
              <div style="font-size: 0.85rem; color: var(--color-text-secondary); margin-bottom: 8px;">Total Amount Due</div>
              <div style="font-size: 2.5rem; font-weight: 800; color: white; display: flex; align-items: center; justify-content: center; gap: 4px;">
                <span style="font-size: 1.5rem; color: var(--color-text-muted);">₹</span>${ride.fare_estimate.toFixed(0)}
              </div>
            </div>

            <div style="font-size: 0.8rem; font-weight: 600; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px;">Pay Online</div>
            <div style="margin-bottom: 24px;">
              <button class="btn btn-secondary" style="width: 100%; padding: 14px 16px; font-size: 1rem; display: flex; align-items: center; justify-content: center; gap: 12px; background: #0c213c; color: #fff; border-color: #0c213c;" onclick="PassengerView.initiateRazorpayPayment(${ride.id})">
                <img src="https://razorpay.com/assets/favicon.png" height="20" style="border-radius:4px" /> Pay via Razorpay (Cards, UPI, Netbanking)
              </button>
            </div>

            <div style="display: flex; align-items: center; margin-bottom: 24px;">
              <div style="flex: 1; height: 1px; background: var(--color-border);"></div>
              <div style="padding: 0 12px; font-size: 0.8rem; color: var(--color-text-muted);">OR</div>
              <div style="flex: 1; height: 1px; background: var(--color-border);"></div>
            </div>

            <button class="btn btn-primary btn-block" style="width: 100%; padding: 14px 16px; font-size: 1rem;" onclick="PassengerView.processPayment(${ride.id}, ${ride.fare_estimate})">
              <i class="fas fa-money-bill-wave" style="margin-right: 8px;"></i> Pay Cash to Driver
            </button>
          </div>
        </div>
      ` : ''}
    `;
  },

  async cancelRide(id) {
    if (!confirm('Are you sure you want to cancel this ride request?')) return;

    try {
      const res = await API.post(`/api/passenger/rides/${id}/cancel`, { reason: 'Passenger cancelled' });
      app.showToast(res.message, 'success');
      this.checkActiveRide();
    } catch (err) {
      app.showToast(err.error || 'Failed to cancel ride', 'error');
    }
  },

  async initiateRazorpayPayment(id) {
    try {
      const btn = event.currentTarget;
      const originalHTML = btn.innerHTML;
      btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Initializing Gateway...';
      btn.disabled = true;

      // 1. Create Order on Backend
      const orderRes = await API.post(`/api/passenger/rides/${id}/create-order`);
      if (!orderRes.success) throw new Error(orderRes.error);

      // 2. Initialize Razorpay
      const options = {
        key: orderRes.key, // from .env RAZORPAY_KEY_ID via backend
        amount: orderRes.amount, 
        currency: "INR",
        name: "ShareAuto",
        description: "Ride Fare Payment",
        image: "https://razorpay.com/assets/favicon.png", // optionally use our own logo
        order_id: orderRes.orderId,
        handler: async function (response) {
          app.showToast('Verifying payment...', 'info');
          try {
            // 3. Verify on backend
            const verifyRes = await API.post(`/api/passenger/rides/${id}/verify-payment`, {
              method: 'UPI', // or razorpay, backend will treat as online
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_signature: response.razorpay_signature
            });

            if (verifyRes.success) {
              app.showToast(`Payment successful!`, 'success');
              
              // Hide modal and show rating
              const modal = document.getElementById('payment-modal');
              if (modal) modal.style.display = 'none';
              
              PassengerView.activeRide = null;
              PassengerView.showRatingModal(id);
            }
          } catch (err) {
            app.showToast('Payment verification failed.', 'error');
            btn.innerHTML = originalHTML;
            btn.disabled = false;
          }
        },
        prefill: {
          name: app.userInfo ? app.userInfo.full_name : "",
          email: app.userInfo ? app.userInfo.email : "",
          contact: app.userInfo ? app.userInfo.phone : ""
        },
        theme: {
          color: "#4f46e5" // Our primary brand color
        },
        modal: {
          ondismiss: function() {
            btn.innerHTML = originalHTML;
            btn.disabled = false;
          }
        }
      };

      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', function (response) {
        app.showToast(response.error.description || 'Payment Failed', 'error');
      });
      rzp.open();
      
    } catch (err) {
      console.error(err);
      app.showToast('Failed to initialize payment gateway.', 'error');
      if (event && event.currentTarget) {
        event.currentTarget.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Try Again';
        event.currentTarget.disabled = false;
      }
    }
  },

  async processPayment(id, amount) {
    try {
      const btn = event.currentTarget;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
      btn.disabled = true;

      const res = await API.post(`/api/passenger/rides/${id}/verify-payment`, { amount, method: 'Cash' });
      app.showToast('Payment successful!', 'success');
      
      // Hide modal and show rating
      const modal = document.getElementById('payment-modal');
      if (modal) modal.style.display = 'none';
      
      this.activeRide = null;
      this.showRatingModal(id);
    } catch (err) {
      app.showToast(err.error || 'Payment failed.', 'error');
      if (event && event.currentTarget) {
        event.currentTarget.disabled = false;
        event.currentTarget.innerHTML = '<i class="fas fa-money-bill-wave" style="margin-right: 8px;"></i> Pay Cash to Driver';
      }
    }
  },



  bindWebSocket() {
    if (this.wsBound) return;
    this.wsBound = true;

    WS.on('ride_status', (data) => {
      if (this.activeRide && data.rideId === this.activeRide.id) {
        app.showToast(`Ride status updated: ${data.status.replace('_', ' ')}`, 'info');
        this.checkActiveRide();
      }
    });

    WS.on('ride_accepted', (data) => {
      if (this.activeRide && data.rideId === this.activeRide.id) {
        app.showToast(data.message || `Ride accepted by driver: ${data.driverName}`, 'success');
        this.checkActiveRide();
      }
    });

    WS.on('driver_location', (data) => {
      if (this.activeRide && data.driverId === this.activeRide.driver_id) {
        MapService.setMarker('driver', data.lat, data.lng, { color: '#f59e0b', emoji: '🛺', popup: `Driver: ${this.activeRide.driver_name}` });
      }
    });

    WS.on('ride_started', (data) => {
      if (this.activeRide && data.rideId === this.activeRide.id) {
        app.showToast(data.message || 'Your ride has started!', 'success');
        this.checkActiveRide();
      }
    });

    WS.on('ride_completed', (data) => {
      if (this.activeRide && data.rideId === this.activeRide.id) {
        app.showToast('Ride completed! Please complete your payment.', 'success');
        this.checkActiveRide(); // This will fetch the completed ride and show Payment Modal
      }
    });

    WS.on('ride_cancelled', (data) => {
      if (this.activeRide && data.rideId === this.activeRide.id) {
        app.showToast(data.message || 'Ride cancelled by driver.', 'warning');
        this.activeRide = null;
        this.renderBookingPanel();
      }
    });
  },

  showRatingModal(rideId) {
    const modalContainer = document.getElementById('rating-modal-container');
    if (!modalContainer) return;

    let selectedRating = 5;

    modalContainer.innerHTML = `
      <div class="modal-overlay" style="display: flex; align-items: center; justify-content: center; position: fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.75); z-index:9999;">
        <div class="card" style="width: 100%; max-width: 400px; padding: 28px;">
          <h3 style="text-align: center;">Rate Your Ride</h3>
          <p style="font-size: 0.85rem; color: var(--color-text-muted); text-align: center; margin-top: 4px;">How was your auto journey?</p>
          
          <div class="rating-modal-stars">
            <span class="star" data-star="1" style="cursor: pointer; color: var(--color-warning);"><i class="fas fa-star"></i></span>
            <span class="star" data-star="2" style="cursor: pointer; color: var(--color-warning);"><i class="fas fa-star"></i></span>
            <span class="star" data-star="3" style="cursor: pointer; color: var(--color-warning);"><i class="fas fa-star"></i></span>
            <span class="star" data-star="4" style="cursor: pointer; color: var(--color-warning);"><i class="fas fa-star"></i></span>
            <span class="star" data-star="5" style="cursor: pointer; color: var(--color-warning);"><i class="fas fa-star"></i></span>
          </div>

          <div class="form-group">
            <label class="form-label">Review / Feedback</label>
            <textarea id="rating-comment" class="form-control" placeholder="Write feedback here..." rows="3"></textarea>
          </div>

          <button class="btn btn-primary btn-block" style="width: 100%;" onclick="PassengerView.submitRating(${rideId})">
            Submit Rating
          </button>
        </div>
      </div>
    `;

    // Interactivity
    const stars = modalContainer.querySelectorAll('.rating-modal-stars .star');
    stars.forEach(star => {
      star.onclick = () => {
        selectedRating = parseInt(star.getAttribute('data-star'));
        stars.forEach(s => {
          const val = parseInt(s.getAttribute('data-star'));
          if (val <= selectedRating) {
            s.innerHTML = '<i class="fas fa-star"></i>';
          } else {
            s.innerHTML = '<i class="far fa-star"></i>';
          }
        });
      };
    });

    // Attach to instance so onclick call works
    this.submitRating = async (id) => {
      const comment = document.getElementById('rating-comment').value;
      try {
        const res = await API.post(`/api/passenger/rides/${id}/rate`, { rating: selectedRating, comment });
        app.showToast(res.message, 'success');
        modalContainer.innerHTML = '';
        this.checkActiveRide();
      } catch (err) {
        app.showToast(err.error || 'Failed to submit rating', 'error');
      }
    };
  },

  async renderRides(container) {
    container.innerHTML = `
      <div style="max-width: 800px; margin: 0 auto;">
        <div class="loader-container" id="rides-loader"><div class="spinner"></div><p>Fetching ride logs...</p></div>
        <div id="rides-list" style="display: none;"></div>
      </div>
      
      <!-- Complaint Modal Mount -->
      <div id="complaint-modal-container"></div>
    `;

    try {
      const res = await API.get('/api/passenger/rides');
      document.getElementById('rides-loader').style.removeProperty('display');
      document.getElementById('rides-loader').style.display = 'none';
      const list = document.getElementById('rides-list');
      list.style.display = 'block';

      if (res.rides.length === 0) {
        list.innerHTML = `
          <div class="card" style="text-align: center; padding: 40px;">
            <i class="fas fa-history" style="font-size: 2.5rem; color: var(--color-text-muted); margin-bottom: 16px;"></i>
            <p>You have not booked any auto rides yet!</p>
          </div>
        `;
        return;
      }

      list.innerHTML = res.rides.map(r => {
        const date = new Date(r.created_at).toLocaleDateString('en-IN', {
          day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        
        let statusBadge = `<span class="badge badge-success">${r.status.toUpperCase()}</span>`;
        if (r.status === 'cancelled') statusBadge = `<span class="badge badge-danger">CANCELLED</span>`;
        
        return `
          <div class="ride-history-card">
            <div class="ride-history-header">
              <div>
                <span class="ride-history-date">${date}</span>
                <div style="margin-top: 4px;">
                  <span class="badge ${r.ride_type === 'shared' ? 'badge-primary' : 'badge-success'}" style="margin-right:6px;">${r.ride_type.toUpperCase()}</span>
                  ${statusBadge}
                </div>
              </div>
              <div class="ride-history-fare">₹${(r.fare_final || r.fare_estimate).toFixed(0)}</div>
            </div>

            <div class="ride-history-route">
              <div class="ride-route-dots">
                <div class="dot-sm green"></div>
                <div class="line"></div>
                <div class="dot-sm red"></div>
              </div>
              <div class="ride-route-addresses">
                <div class="ride-route-address">
                  <div class="ride-route-label">Pickup</div>
                  <div>${r.pickup_address}</div>
                </div>
                <div class="ride-route-address">
                  <div class="ride-route-label">Dropoff</div>
                  <div>${r.drop_address}</div>
                </div>
              </div>
            </div>

            <div class="ride-history-footer">
              <div style="font-size: 0.8rem; color: var(--color-text-secondary);">
                ${r.driver_name ? `<i class="fas fa-shuttle-van"></i> Driver: <strong>${r.driver_name}</strong>` : 'Driver: N/A'}
              </div>
              <div>
                <button class="btn btn-secondary btn-sm" onclick="PassengerView.showComplaintModal(${r.id})">
                  <i class="fas fa-exclamation-triangle"></i> Report Issue
                </button>
              </div>
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      app.showToast('Could not load ride logs', 'error');
    }
  },

  showComplaintModal(rideId) {
    const modalContainer = document.getElementById('complaint-modal-container');
    if (!modalContainer) return;

    modalContainer.innerHTML = `
      <div class="modal-overlay" style="display: flex; align-items: center; justify-content: center; position: fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.75); z-index:9999;">
        <div class="card" style="width: 100%; max-width: 450px; padding: 28px;">
          <h3 style="margin-bottom: 4px;">File Complaint</h3>
          <p style="font-size: 0.8rem; color: var(--color-text-muted); margin-bottom: 20px;">Report an issue regarding ride #${rideId}</p>

          <form id="complaint-form">
            <div class="form-group">
              <label class="form-label" for="complaint-subject">Subject</label>
              <input type="text" id="complaint-subject" class="form-control" placeholder="e.g. Overcharged, Driver behavior..." required>
            </div>
            
            <div class="form-group">
              <label class="form-label" for="complaint-description">Details</label>
              <textarea id="complaint-description" class="form-control" rows="4" placeholder="Explain the issue in detail..." required></textarea>
            </div>

            <div style="display: flex; gap: 12px; margin-top: 24px;">
              <button type="button" class="btn btn-secondary" style="flex:1;" onclick="document.getElementById('complaint-modal-container').innerHTML = ''">Cancel</button>
              <button type="submit" class="btn btn-danger" style="flex:2;">Submit Report</button>
            </div>
          </form>
        </div>
      </div>
    `;

    const form = document.getElementById('complaint-form');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const subject = document.getElementById('complaint-subject').value;
      const description = document.getElementById('complaint-description').value;

      try {
        const res = await API.post('/api/passenger/complaints', { rideId, subject, description });
        app.showToast(res.message, 'success');
        modalContainer.innerHTML = '';
      } catch (err) {
        app.showToast(err.error || 'Failed to submit report', 'error');
      }
    };
  },

  async renderProfile(container) {
    container.innerHTML = `
      <div class="grid grid-2" style="max-width: 900px; margin: 0 auto; gap: 28px;">
        <!-- Left: Edit Profile -->
        <div class="card" style="padding: 28px;">
          <h3 style="margin-bottom: 20px;"><i class="fas fa-user-edit" style="color: var(--color-accent); margin-right: 8px;"></i>Edit Profile</h3>
          
          <form id="profile-form">
            <div class="form-group">
              <label class="form-label" for="profile-name">Full Name</label>
              <input type="text" id="profile-name" class="form-control" value="${app.currentUser.full_name}" required>
            </div>

            <div class="form-group">
              <label class="form-label" for="profile-phone">Phone Number</label>
              <input type="tel" id="profile-phone" class="form-control" value="${app.currentUser.phone}" pattern="[6-9][0-9]{9}" required>
            </div>

            <div class="form-group">
              <label class="form-label">Gender</label>
              <div class="gender-selector">
                <div class="gender-option ${app.currentUser.gender === 'male' ? 'selected' : ''}" data-gender="male">Male</div>
                <div class="gender-option ${app.currentUser.gender === 'female' ? 'selected' : ''}" data-gender="female">Female</div>
                <div class="gender-option ${app.currentUser.gender === 'other' ? 'selected' : ''}" data-gender="other">Other</div>
              </div>
            </div>

            <button type="submit" class="btn btn-primary" style="margin-top: 12px; width: 100%;">
              Save Changes
            </button>
          </form>
        </div>

        <!-- Right: Wallet -->
        <div class="card" style="padding: 28px; display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <h3 style="margin-bottom: 16px;"><i class="fas fa-wallet" style="color: var(--color-success); margin-right: 8px;"></i>Wallet & Payments</h3>
            
            <div style="background: var(--color-success-bg); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: var(--radius-lg); padding: 24px; text-align: center; margin-bottom: 24px;">
              <span style="font-size: 0.85rem; color: var(--color-text-muted); text-transform: uppercase;">Available Balance</span>
              <h2 style="font-size: 3rem; font-weight: 800; color: var(--color-success); margin-top: 4px;" id="wallet-balance">₹${app.currentUser.wallet_balance.toFixed(2)}</h2>
            </div>
            
            <form id="topup-form">
              <div class="form-group">
                <label class="form-label">Topup Wallet (Simulated)</label>
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px;">
                  <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('topup-amount').value = 100">₹100</button>
                  <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('topup-amount').value = 200">₹200</button>
                  <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('topup-amount').value = 500">₹500</button>
                  <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('topup-amount').value = 1000">₹1000</button>
                </div>
                <input type="number" id="topup-amount" class="form-control" placeholder="Enter custom amount (₹)" min="10" max="10000" required>
              </div>

              <button type="submit" class="btn btn-success" style="width: 100%;">
                Add Balance <i class="fas fa-plus"></i>
              </button>
            </form>
          </div>
        </div>
      </div>
    `;

    // Interactivity gender
    let selectedGender = app.currentUser.gender;
    const genderOpts = container.querySelectorAll('.gender-option');
    genderOpts.forEach(opt => {
      opt.onclick = () => {
        genderOpts.forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        selectedGender = opt.getAttribute('data-gender');
      };
    });

    // Profile form submission
    const profileForm = document.getElementById('profile-form');
    profileForm.onsubmit = async (e) => {
      e.preventDefault();
      const fullName = document.getElementById('profile-name').value;
      const phone = document.getElementById('profile-phone').value;

      try {
        const res = await API.put('/api/auth/profile', { fullName, phone, gender: selectedGender });
        app.showToast(res.message, 'success');
        app.currentUser = res.user;
        app.fetchUserProfile(); // Reload header state
      } catch (err) {
        app.showToast(err.error || 'Failed to update profile', 'error');
      }
    };

    // Topup form submission
    const topupForm = document.getElementById('topup-form');
    topupForm.onsubmit = async (e) => {
      e.preventDefault();
      const amount = parseFloat(document.getElementById('topup-amount').value);

      try {
        const res = await API.post('/api/passenger/wallet/topup', { amount });
        app.showToast(res.message, 'success');
        app.currentUser.wallet_balance = res.balance;
        document.getElementById('wallet-balance').textContent = `₹${res.balance.toFixed(2)}`;
        document.getElementById('topup-amount').value = '';
      } catch (err) {
        app.showToast(err.error || 'Failed to add money', 'error');
      }
    };
  }
};
