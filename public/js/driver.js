// ═══════════════════════════════════════════════
// ShareAuto — Driver Dashboard Logic
// ═══════════════════════════════════════════════

const DriverView = {
  watchId: null,
  activeRide: null,
  wsBound: false,
  lat: null,
  lng: null,
  incomingRequestTimeout: null,

  renderOnboarding(container) {
    container.innerHTML = `
      <div class="onboarding-container card" style="padding: 32px; margin-top: 20px;">
        <h3 style="text-align: center; margin-bottom: 8px;">Partner Registration</h3>
        <p style="color: var(--color-text-muted); text-align: center; font-size: 0.85rem; margin-bottom: 32px;">Submit details to activate your auto-rickshaw partner profile</p>

        <form id="onboarding-form" enctype="multipart/form-data">
          <div class="grid grid-2" style="gap: 16px; margin-bottom: 0;">
            <div class="form-group">
              <label class="form-label" for="driver-license">Driving License Number</label>
              <input type="text" id="driver-license" name="licenseNumber" class="form-control" placeholder="DL-1420230000000" required>
            </div>
            <div class="form-group">
              <label class="form-label" for="driver-experience">Experience (Years)</label>
              <input type="number" id="driver-experience" name="experienceYears" class="form-control" min="0" max="50" placeholder="e.g. 5" required>
            </div>
          </div>

          <h4 style="margin-top: 16px; margin-bottom: 12px; font-size: 1rem; border-bottom: 1px solid var(--color-border); padding-bottom: 6px;">Vehicle Specifications</h4>
          
          <div class="grid grid-3" style="gap: 12px; margin-bottom: 0;">
            <div class="form-group">
              <label class="form-label" for="vehicle-reg">Reg. Number</label>
              <input type="text" id="vehicle-reg" name="registrationNumber" class="form-control" placeholder="KA-01-A-1234" required>
            </div>
            <div class="form-group">
              <label class="form-label" for="vehicle-model">Model / Make</label>
              <input type="text" id="vehicle-model" name="vehicleModel" class="form-control" placeholder="Bajaj RE / Ape" required>
            </div>
            <div class="form-group">
              <label class="form-label" for="vehicle-color">Auto Color</label>
              <input type="text" id="vehicle-color" name="vehicleColor" class="form-control" placeholder="Yellow-Green" required>
            </div>
          </div>

          <h4 style="margin-top: 16px; margin-bottom: 12px; font-size: 1rem; border-bottom: 1px solid var(--color-border); padding-bottom: 6px;">Document Verification</h4>

          <div class="grid grid-3" style="gap: 12px; margin-bottom: 24px;">
            <div class="form-group">
              <label class="form-label">Profile Photo</label>
              <label class="file-upload" id="upload-profile">
                <i class="file-upload-icon fas fa-user-circle"></i>
                <div class="file-upload-text">Upload Photo</div>
                <input type="file" name="profilePhoto" accept="image/*" onchange="DriverView.handleFileChange('upload-profile', this)" required>
              </label>
            </div>

            <div class="form-group">
              <label class="form-label">License Copy</label>
              <label class="file-upload" id="upload-license">
                <i class="file-upload-icon fas fa-id-card"></i>
                <div class="file-upload-text">Upload License</div>
                <input type="file" name="licensePhoto" accept="image/*" onchange="DriverView.handleFileChange('upload-license', this)" required>
              </label>
            </div>

            <div class="form-group">
              <label class="form-label">Vehicle Photo</label>
              <label class="file-upload" id="upload-vehicle">
                <i class="file-upload-icon fas fa-taxi"></i>
                <div class="file-upload-text">Upload Vehicle</div>
                <input type="file" name="vehiclePhoto" accept="image/*" onchange="DriverView.handleFileChange('upload-vehicle', this)" required>
              </label>
            </div>
          </div>

          <button type="submit" class="btn btn-primary btn-block" style="width: 100%;">
            Submit Documentation
          </button>
        </form>
      </div>
    `;

    // Handle form submit
    const form = document.getElementById('onboarding-form');
    form.onsubmit = async (e) => {
      e.preventDefault();
      
      const formData = new FormData(form);
      
      try {
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i> Uploading details...`;

        const res = await API.upload('/api/driver/onboarding', formData);
        
        app.showToast(res.message, 'success');
        
        // Refresh details & reroute
        await app.fetchUserProfile();
        app.handleRouting();
      } catch (err) {
        app.showToast(err.error || 'Failed to upload documents', 'error');
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = false;
        btn.innerHTML = `Submit Documentation`;
      }
    };
  },

  handleFileChange(labelId, input) {
    const label = document.getElementById(labelId);
    if (input.files && input.files.length > 0) {
      label.classList.add('has-file');
      label.querySelector('.file-upload-icon').className = 'file-upload-icon fas fa-check-circle';
      label.querySelector('.file-upload-text').textContent = input.files[0].name.substring(0, 12) + '...';
    } else {
      label.classList.remove('has-file');
      label.querySelector('.file-upload-icon').className = labelId === 'upload-profile' ? 'file-upload-icon fas fa-user-circle' : (labelId === 'upload-license' ? 'file-upload-icon fas fa-id-card' : 'file-upload-icon fas fa-taxi');
      label.querySelector('.file-upload-text').textContent = 'Upload File';
    }
  },

  renderDashboard(container) {
    const status = app.driverInfo ? app.driverInfo.status : 'pending';

    if (status === 'pending' || status === 'rejected') {
      this.stopLocationTracking();
      const isRejected = status === 'rejected';
      container.innerHTML = `
        <div class="card pending-overlay" style="margin-top: 20px;">
          <div class="pending-overlay-icon text-gradient" style="font-size: 5rem;">
            <i class="fas ${isRejected ? 'fa-times-circle' : 'fa-hourglass-half'}"></i>
          </div>
          <h2 class="pending-overlay-title">${isRejected ? 'Application Rejected' : 'Verification Pending'}</h2>
          <p class="pending-overlay-text">
            ${isRejected 
              ? 'Unfortunately, your driver partner documents did not meet our guidelines. Please update your details and submit again.' 
              : 'Our admins are reviewing your driving credentials and vehicle registration. This process typically takes up to 24 hours.'}
          </p>
          ${isRejected ? `
            <button class="btn btn-primary" style="margin-top: 24px;" onclick="DriverView.allowReSubmit()">
              Update Documents
            </button>
          ` : `
            <span class="badge badge-warning">Awaiting Approval</span>
          `}
        </div>
      `;
      return;
    }

    // Approved status -> Render real dashboard
    container.innerHTML = `
      <div class="driver-status-bar">
        <div class="driver-status-info">
          <div class="driver-status-dot ${app.driverInfo.is_online ? 'online' : 'offline'}" id="status-dot"></div>
          <div>
            <div class="driver-status-text" id="status-text">${app.driverInfo.is_online ? 'You are Online' : 'You are Offline'}</div>
            <div class="driver-status-sub" id="status-sub">${app.driverInfo.is_online ? 'Receiving local ride requests' : 'Toggle online to receive bookings'}</div>
          </div>
        </div>
        
        <div class="toggle-wrapper">
          <input type="checkbox" id="online-toggle" class="toggle" ${app.driverInfo.is_online ? 'checked' : ''} onchange="DriverView.toggleOnline(this)">
        </div>
      </div>

      <div class="grid grid-2" style="grid-template-columns: 1.2fr 1.8fr; gap: 28px;">
        <!-- Left Side Controller Panel -->
        <div id="driver-control-panel">
          <div class="card" style="padding: 24px; text-align: center; color: var(--color-text-secondary);">
            <i class="fas fa-satellite-dish" style="font-size: 2.5rem; color: var(--color-text-muted); margin-bottom: 12px;"></i>
            <p>Go online to begin receiving passenger booking requests</p>
          </div>
        </div>

        <!-- Right Side Map Panel -->
        <div>
          <div class="form-group" style="position: relative; margin-bottom: 12px;">
            <label class="form-label" style="display: flex; justify-content: space-between; align-items: center;">
              <span>Simulate Driver Location (Search City/Area)</span>
              <span style="font-size: 0.75rem; color: var(--color-accent); cursor: pointer;" onclick="DriverView.useGPSLocation()"><i class="fas fa-gps"></i> Use GPS</span>
            </label>
            <input type="text" id="driver-search-input" class="form-control" placeholder="Search and select city (e.g. Vijayapura)..." autocomplete="off">
            <div id="driver-suggestions" class="location-suggestions" style="display: none; position: absolute; width: 100%; z-index: 1000; background: var(--color-bg-secondary); border: 1px solid var(--color-border); border-radius: var(--radius-md); max-height: 200px; overflow-y: auto;"></div>
          </div>
          <div class="map-container" style="height: 480px;">
            <div id="driver-map"></div>
          </div>
        </div>
      </div>

      <!-- Hidden Ride Request Overlay -->
      <div id="request-overlay-container"></div>
    `;

    setTimeout(() => {
      MapService.init('driver-map');
      
      // Allow manual location pinning by clicking on the map
      MapService.map.on('click', async (e) => {
        if (!app.driverInfo || !app.driverInfo.is_online) {
          app.showToast('Please go online first to set your location.', 'warning');
          return;
        }
        const { lat, lng } = e.latlng;
        this.lat = lat;
        this.lng = lng;
        
        // Update marker
        MapService.setMarker('driver', lat, lng, { color: '#f59e0b', emoji: '🛺', popup: 'Your Position' });
        
        // Send to API
        try {
          await API.put('/api/driver/location', { lat, lng });
          app.showToast('Simulated location updated!', 'info');
        } catch (err) {}

        // Send to websocket for active ride passenger tracking
        WS.send({
          type: 'driver_location',
          lat: lat,
          lng: lng
        });
      });

      this.checkActiveRide();
      this.bindWebSocket();
      this.setupGeocoding();
      
      // Auto-start watchPosition if online
      if (app.driverInfo.is_online) {
        this.startLocationTracking();
      }
    }, 0);
  },

  setupGeocoding() {
    const searchInput = document.getElementById('driver-search-input');
    const suggestions = document.getElementById('driver-suggestions');
    if (!searchInput || !suggestions) return;

    searchInput.oninput = (e) => {
      const val = e.target.value;
      if (!val || val.length < 3) {
        suggestions.innerHTML = '';
        suggestions.style.display = 'none';
        return;
      }

      MapService.searchLocation(val, (results) => {
        if (results.length === 0) {
          suggestions.innerHTML = '<div class="suggestion-item">No results found</div>';
          suggestions.style.display = 'block';
          return;
        }

        suggestions.innerHTML = results.map(r => `
          <div class="suggestion-item" onclick="DriverView.selectSimulatedLocation(${r.lat}, ${r.lng}, '${r.short.replace(/'/g, "\\'")}')" style="padding: 8px 12px; cursor: pointer; border-bottom: 1px solid var(--color-border); font-size: 0.8rem; display: flex; flex-direction: column;">
            <strong>${r.short}</strong>
            <div style="font-size: 0.7rem; color: var(--color-text-muted);">${r.display}</div>
          </div>
        `).join('');
        suggestions.style.display = 'block';
      });
    };

    // Close suggestions on outside click
    document.addEventListener('click', (e) => {
      if (e.target !== searchInput) {
        suggestions.style.display = 'none';
      }
    });
  },

  async selectSimulatedLocation(lat, lng, name) {
    const searchInput = document.getElementById('driver-search-input');
    if (searchInput) searchInput.value = name;
    
    if (!app.driverInfo || !app.driverInfo.is_online) {
      app.showToast('Please go online first to set your location.', 'warning');
      return;
    }

    this.lat = lat;
    this.lng = lng;

    MapService.map.setView([lat, lng], 15);
    MapService.setMarker('driver', lat, lng, { color: '#f59e0b', emoji: '🛺', popup: 'Your Position' });

    try {
      await API.put('/api/driver/location', { lat, lng });
      app.showToast(`Location updated to ${name}`, 'success');
    } catch (e) {}

    WS.send({
      type: 'driver_location',
      lat: lat,
      lng: lng
    });
  },

  async useGPSLocation() {
    try {
      app.showToast('Accessing GPS coordinates...', 'info');
      const pos = await MapService.getCurrentLocation();
      this.lat = pos.lat;
      this.lng = pos.lng;

      const searchInput = document.getElementById('driver-search-input');
      if (searchInput) searchInput.value = 'My GPS Location';

      MapService.map.setView([pos.lat, pos.lng], 15);
      MapService.setMarker('driver', pos.lat, pos.lng, { color: '#f59e0b', emoji: '🛺', popup: 'Your Position' });

      await API.put('/api/driver/location', { lat: pos.lat, lng: pos.lng });
      app.showToast('Location updated from GPS.', 'success');

      WS.send({
        type: 'driver_location',
        lat: pos.lat,
        lng: pos.lng
      });
    } catch (err) {
      app.showToast('Could not retrieve GPS coordinates.', 'error');
    }
  },

  allowReSubmit() {
    app.driverInfo = null;
    app.vehicleInfo = null;
    app.navigate('#/driver/onboarding');
  },

  async toggleOnline(checkbox) {
    const isOnline = checkbox.checked;
    
    if (isOnline) {
      try {
        app.showToast('Accessing GPS coordinates...', 'info');
        const pos = await MapService.getCurrentLocation();
        this.lat = pos.lat;
        this.lng = pos.lng;
        
        const res = await API.put('/api/driver/status', { isOnline: true, lat: pos.lat, lng: pos.lng });
        app.driverInfo.is_online = 1;
        
        document.getElementById('status-dot').className = 'driver-status-dot online';
        document.getElementById('status-text').textContent = 'You are Online';
        document.getElementById('status-sub').textContent = 'Receiving local ride requests';
        
        MapService.map.setView([pos.lat, pos.lng], 15);
        MapService.setMarker('driver', pos.lat, pos.lng, { color: '#f59e0b', emoji: '🛺', popup: 'Your Position' });
        
        this.startLocationTracking();
        app.showToast(res.message, 'success');
        this.checkActiveRide();
      } catch (err) {
        app.showToast('Could not retrieve location. Online toggle aborted.', 'error');
        checkbox.checked = false;
      }
    } else {
      try {
        const res = await API.put('/api/driver/status', { isOnline: false });
        app.driverInfo.is_online = 0;
        
        document.getElementById('status-dot').className = 'driver-status-dot offline';
        document.getElementById('status-text').textContent = 'You are Offline';
        document.getElementById('status-sub').textContent = 'Toggle online to receive bookings';
        
        this.stopLocationTracking();
        MapService.clearMarkers();
        MapService.clearRoute();
        
        app.showToast(res.message, 'info');
        this.checkActiveRide();
      } catch (err) {
        console.error('Offline toggle error:', err);
        app.showToast(err.error || 'Failed to toggle offline', 'error');
        checkbox.checked = true;
      }
    }
  },
  startLocationTracking() {
    this.stopLocationTracking();
    
    this.watchId = MapService.watchLocation(
      async (coords) => {
        const latitude = coords.lat;
        const longitude = coords.lng;

        MapService.setMarker('driver', latitude, longitude, { color: '#f59e0b', emoji: '🛺', popup: 'Your Position' });
        
        // Send to API
        try {
          await API.put('/api/driver/location', { lat: latitude, lng: longitude });
        } catch (e) {}

        // Send to websocket for active ride passenger tracking
        WS.send({
          type: 'driver_location',
          lat: latitude,
          lng: longitude
        });
      },
      (err) => console.warn('Driver tracking error:', err)
    );
  },
  stopLocationTracking() {
    if (this.watchId) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  },

  async checkActiveRide() {
    if (!app.driverInfo || !app.driverInfo.is_online) {
      const panel = document.getElementById('driver-control-panel');
      if (panel) {
        panel.innerHTML = `
          <div class="card" style="padding: 24px; text-align: center; color: var(--color-text-secondary);">
            <i class="fas fa-pause-circle" style="font-size: 2.5rem; color: var(--color-text-muted); margin-bottom: 12px;"></i>
            <p>Go online to begin receiving passenger booking requests</p>
          </div>
        `;
      }
      return;
    }

    try {
      const res = await API.get('/api/driver/rides/active');
      if (res.ride) {
        this.activeRide = res.ride;
        this.renderActiveRidePanel(res.ride, res.allPassengers);
      } else {
        this.activeRide = null;
        
        // Fetch any pending matched requests
        const reqRes = await API.get('/api/driver/requests');
        if (reqRes.rides && reqRes.rides.length > 0) {
          const matchedRequest = {
            rideId: reqRes.rides[0].id,
            rideType: reqRes.rides[0].ride_type,
            pickup: reqRes.rides[0].pickup_address,
            drop: reqRes.rides[0].drop_address,
            fare: reqRes.rides[0].fare_estimate
          };
          this.showIncomingRequest(matchedRequest);
        } else {
          this.renderWaitingPanel();
        }
      }
    } catch (err) {
      console.error(err);
    }
  },

  renderWaitingPanel() {
    const panel = document.getElementById('driver-control-panel');
    panel.innerHTML = `
      <div class="card" style="padding: 32px; text-align: center;">
        <div style="font-size: 2.5rem; color: var(--color-accent); margin-bottom: 16px; animation: pulse 2s infinite;">
          <i class="fas fa-radar"></i> <i class="fas fa-spinner fa-spin"></i>
        </div>
        <h4>Online & Scanning</h4>
        <p style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 4px;">Waiting for incoming customer bookings in your locality...</p>
      </div>
    `;
  },

  renderActiveRidePanel(ride, allPassengers = []) {
    const panel = document.getElementById('driver-control-panel');
    
    // Set up map route
    MapService.clearMarkers();
    MapService.setMarker('pickup', ride.pickup_lat, ride.pickup_lng, { color: '#10b981', emoji: '🟢', popup: 'Pickup' });
    MapService.setMarker('drop', ride.drop_lat, ride.drop_lng, { color: '#ef4444', emoji: '🔴', popup: 'Dropoff' });
    
    if (this.lat && this.lng) {
      MapService.setMarker('driver', this.lat, this.lng, { color: '#f59e0b', emoji: '🛺', popup: 'Your Location' });
    }

    let actionButton = '';
    let navTitle = '';
    let navRoute = [];

    if (ride.status === 'accepted') {
      navTitle = 'Route to Pickup';
      if (this.lat && this.lng) {
        navRoute = [[this.lat, this.lng], [ride.pickup_lat, ride.pickup_lng]];
      } else {
        navRoute = [[ride.pickup_lat, ride.pickup_lng], [ride.pickup_lat, ride.pickup_lng]];
      }
      actionButton = `
        <button class="btn btn-primary btn-block" style="width: 100%; margin-top: 16px;" onclick="DriverView.arriveAtPickup(${ride.id})">
          I Have Arrived at Pickup
        </button>
      `;
    } else if (ride.status === 'driver_arriving') {
      navTitle = 'Arrived at Pickup';
      actionButton = `
        <div class="form-group" style="margin-top: 16px; margin-bottom: 12px;">
          <label class="form-label" style="font-size: 0.8rem; color: var(--color-text-muted);">Enter Passenger Ride OTP</label>
          <input type="text" id="ride-otp-input" class="form-control" placeholder="Enter 4-digit OTP" pattern="[0-9]{4}" style="text-align: center; font-size: 1.3rem; letter-spacing: 0.2em; font-weight: 700;">
        </div>
        <button class="btn btn-success btn-block" style="width: 100%;" onclick="DriverView.startRide(${ride.id})">
          Verify & Start Ride
        </button>
      `;
    } else if (ride.status === 'started') {
      navTitle = 'En Route to Destination';
      navRoute = [[ride.pickup_lat, ride.pickup_lng], [ride.drop_lat, ride.drop_lng]];
      actionButton = `
        <button class="btn btn-danger btn-block" style="width: 100%; margin-top: 16px;" onclick="DriverView.completeRide(${ride.id})">
          Complete Ride
        </button>
      `;
    } else if (ride.status === 'completed') {
      navTitle = 'Ride Completed';
      navRoute = [];
      const totalEstimatedFare = allPassengers.reduce((sum, p) => sum + p.fare_estimate, 0);
      actionButton = `
        <div style="margin-top: 16px; padding: 16px; background: var(--color-bg-tertiary); border-radius: var(--radius-md); text-align: center;">
          <div class="spinner spinner-sm" style="display: inline-block; margin-bottom: 8px;"></div>
          <p style="font-weight: 600; color: var(--color-text-primary);">Waiting for payment...</p>
          <p style="font-size: 0.8rem; color: var(--color-text-muted);">The passenger is completing the payment of ₹${totalEstimatedFare.toFixed(0)}.</p>
        </div>
      `;
    }

    if (navRoute.length > 0) {
      MapService.drawRoute(navRoute[0], navRoute[1]);
    }

    const totalEstimatedFare = allPassengers.reduce((sum, p) => sum + p.fare_estimate, 0);

    const passengerDetails = allPassengers.map(p => `
      <div class="active-ride-passenger-item">
        <div class="ride-request-passenger-avatar">${p.passenger_name[0].toUpperCase()}</div>
        <div style="flex:1;">
          <div style="font-weight: 600; font-size: 0.85rem;">${p.passenger_name} (${p.passenger_gender})</div>
          <div style="font-size: 0.75rem; color: var(--color-text-secondary); margin-top: 2px;">Drop: ${p.drop_address}</div>
        </div>
        <a href="tel:${p.passenger_phone}" class="tracking-action-btn" style="width:32px; height:32px; font-size:0.8rem; border-radius:50%; border:1px solid var(--color-border); display:flex; align-items:center; justify-content:center;"><i class="fas fa-phone"></i></a>
      </div>
    `).join('');

    panel.innerHTML = `
      <div class="active-ride-panel">
        <div class="active-ride-header">
          <div class="active-ride-status">
            <span class="driver-status-dot online"></span>
            <span>Active Ride — ${navTitle}</span>
          </div>
          <span class="badge ${ride.ride_type === 'shared' ? 'badge-primary' : 'badge-success'}">${ride.ride_type.toUpperCase()}</span>
        </div>

        <div class="booking-section-title">Passengers</div>
        <div class="active-ride-passengers">
          ${passengerDetails}
        </div>

        <div class="fare-summary" style="margin-top: 16px;">
          <div class="fare-row">
            <span>Total Ride Fare</span>
            <span style="font-size: 1.2rem; font-weight: 800; color: var(--color-success);">₹${totalEstimatedFare.toFixed(0)}</span>
          </div>
          <div class="fare-row">
            <span>Pickup Address</span>
            <span style="font-size:0.8rem; text-align:right;">${ride.pickup_address}</span>
          </div>
        </div>

        ${actionButton}
      </div>
    `;
  },

  async arriveAtPickup(id) {
    try {
      const res = await API.post(`/api/driver/rides/${id}/arrive`);
      app.showToast(res.message, 'success');
      this.checkActiveRide();
    } catch (err) {
      app.showToast(err.error || 'Failed to update status', 'error');
    }
  },

  async startRide(id) {
    const otp = document.getElementById('ride-otp-input').value;
    if (!otp || otp.length !== 4) {
      app.showToast('Please enter a 4-digit numeric OTP', 'warning');
      return;
    }

    try {
      const res = await API.post(`/api/driver/rides/${id}/start`, { otp });
      app.showToast(res.message, 'success');
      this.checkActiveRide();
    } catch (err) {
      app.showToast(err.error || 'Verification failed. Try again.', 'error');
    }
  },

  async completeRide(id) {
    try {
      const res = await API.post(`/api/driver/rides/${id}/complete`);
      app.showToast(res.message, 'success');
      
      // Clear route
      MapService.clearRoute();
      MapService.clearMarkers();
      
      // Update local driver details
      await app.fetchUserProfile();
      
      this.checkActiveRide();
    } catch (err) {
      app.showToast(err.error || 'Failed to complete ride', 'error');
    }
  },

  bindWebSocket() {
    if (this.wsBound) return;
    this.wsBound = true;

    WS.on('new_ride_request', (data) => {
      this.showIncomingRequest(data);
    });

    WS.on('ride_cancelled', (data) => {
      if (this.activeRide && data.rideId === this.activeRide.id) {
        app.showToast('The passenger cancelled this booking request.', 'warning');
        
        MapService.clearRoute();
        MapService.clearMarkers();
        this.activeRide = null;
        
        this.checkActiveRide();
      }
    });

    WS.on('payment_confirmed', (data) => {
      app.showToast(`Payment of ₹${data.amount} received for Ride #${data.rideId}!`, 'success');
      this.checkActiveRide();
    });

    WS.on('passenger_location', (data) => {
      if (this.activeRide && data.rideId === this.activeRide.id) {
        MapService.setMarker('passenger', data.lat, data.lng, { color: '#3b82f6', emoji: '🧑', popup: 'Passenger Location' });
      }
    });
  },

  showIncomingRequest(request) {
    // Play notification alert if available
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
      gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.3);
    } catch (e) {}

    const container = document.getElementById('request-overlay-container');
    if (!container) return;

    let countdown = 30;

    container.innerHTML = `
      <div class="modal-overlay active" style="display: flex; align-items: center; justify-content: center; position: fixed; top:0; left:0; right:0; bottom:0; background:rgba(10, 14, 26, 0.9); z-index:9999;">
        <div class="ride-request-card" style="width: 100%; max-width: 440px; padding: 28px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 12px;">
            <div class="ride-request-type text-gradient">
              <i class="fas ${request.rideType === 'shared' ? 'fa-user-friends' : 'fa-user'}"></i>
              <span>Incoming ${request.rideType.toUpperCase()} Request</span>
            </div>
            <div id="countdown-timer" style="font-weight: 800; font-size:1.1rem; color:var(--color-danger); background:var(--color-danger-bg); border-radius:50%; width:36px; height:36px; display:flex; align-items:center; justify-content:center; border:1px solid var(--color-danger);">${countdown}</div>
          </div>

          <div class="ride-request-route">
            <div style="font-size:0.75rem; color:var(--color-text-muted); text-transform:uppercase;">Pickup Point</div>
            <div style="font-weight:600; font-size:0.9rem; margin-top:2px; margin-bottom:12px;">${request.pickup}</div>
            
            <div style="font-size:0.75rem; color:var(--color-text-muted); text-transform:uppercase;">Dropoff Point</div>
            <div style="font-weight:600; font-size:0.9rem; margin-top:2px;">${request.drop}</div>
          </div>

          <div class="ride-request-fare">
            <div>
              <span class="ride-request-distance">Approx. Fare Payout</span>
              <div class="ride-request-fare-amount">₹${request.fare ? request.fare.toFixed(0) : '35'}</div>
            </div>
          </div>

          <div class="ride-request-actions">
            <button class="btn btn-secondary" onclick="DriverView.rejectRequest(${request.rideId})">Decline</button>
            <button class="btn btn-primary" onclick="DriverView.acceptRequest(${request.rideId})">Accept Ride</button>
          </div>
        </div>
      </div>
    `;

    // Timer
    clearInterval(this.incomingRequestTimeout);
    this.incomingRequestTimeout = setInterval(() => {
      countdown--;
      const timerEl = document.getElementById('countdown-timer');
      if (timerEl) timerEl.textContent = countdown;
      
      if (countdown <= 0) {
        clearInterval(this.incomingRequestTimeout);
        container.innerHTML = '';
        app.showToast('Ride request timed out.', 'warning');
      }
    }, 1000);

    // Accept / Reject instances
    this.acceptRequest = async (id) => {
      clearInterval(this.incomingRequestTimeout);
      container.innerHTML = '';
      try {
        const res = await API.post(`/api/driver/rides/${id}/accept`);
        app.showToast(res.message, 'success');
        this.checkActiveRide();
      } catch (err) {
        app.showToast(err.error || 'Failed to accept request', 'error');
        this.checkActiveRide();
      }
    };

    this.rejectRequest = async (id) => {
      clearInterval(this.incomingRequestTimeout);
      container.innerHTML = '';
      try {
        await API.post(`/api/driver/rides/${id}/reject`);
        app.showToast('Ride declined.', 'info');
        this.checkActiveRide();
      } catch (err) {
        console.error(err);
      }
    };
  },

  async renderHistory(container) {
    container.innerHTML = `
      <div class="loader-container" id="earnings-loader"><div class="spinner"></div><p>Calculating earnings...</p></div>
      <div id="earnings-content" style="display: none;">
        <!-- Stats Grid -->
        <div class="earnings-summary">
          <div class="earnings-card">
            <div class="earnings-card-value" id="stats-total-earnings">₹0.00</div>
            <div class="earnings-card-label">Total Earnings</div>
            <div class="earnings-card-period">Partner Lifetime</div>
          </div>
          <div class="earnings-card">
            <div class="earnings-card-value" id="stats-today-earnings">₹0.00</div>
            <div class="earnings-card-label">Today's Payout</div>
            <div class="earnings-card-period">June 23, 2026</div>
          </div>
          <div class="earnings-card">
            <div class="earnings-card-value" style="color:var(--color-warning);" id="stats-rating">5.0 ★</div>
            <div class="earnings-card-label">Avg. Rating</div>
            <div class="earnings-card-period">From customer rides</div>
          </div>
        </div>

        <div class="grid grid-3" style="gap:24px; margin-bottom: 28px;">
          <div class="earnings-card">
            <div class="earnings-card-value" style="color:var(--color-info);" id="stats-total-rides">0</div>
            <div class="earnings-card-label">Total Rides Completed</div>
          </div>
          <div class="earnings-card">
            <div class="earnings-card-value" id="stats-week-earnings">₹0.00</div>
            <div class="earnings-card-label">Weekly Earnings</div>
            <div class="earnings-card-period">Last 7 days</div>
          </div>
          <div class="earnings-card">
            <div class="earnings-card-value" id="stats-month-earnings">₹0.00</div>
            <div class="earnings-card-label">Monthly Earnings</div>
            <div class="earnings-card-period">This Calendar Month</div>
          </div>
        </div>

        <!-- CSS Bar Chart (Relative breakdown) -->
        <div class="card" style="padding: 24px; margin-bottom: 28px;">
          <h4 style="margin-bottom: 12px;">Earnings Distribution Breakdown</h4>
          <div style="display: flex; gap: 8px; align-items: flex-end; height: 120px; padding: 12px 0;">
            <div style="flex:1; display:flex; flex-direction:column; align-items:center; gap: 8px; height:100%; justify-content:flex-end;">
              <div id="chart-bar-today" style="width:30px; background:var(--gradient-success); border-radius:4px 4px 0 0; transition: height 0.5s;" style="height:0%;"></div>
              <span style="font-size:0.75rem; color:var(--color-text-muted)">Today</span>
            </div>
            <div style="flex:1; display:flex; flex-direction:column; align-items:center; gap: 8px; height:100%; justify-content:flex-end;">
              <div id="chart-bar-week" style="width:30px; background:var(--gradient-primary); border-radius:4px 4px 0 0; transition: height 0.5s;" style="height:0%;"></div>
              <span style="font-size:0.75rem; color:var(--color-text-muted)">Weekly</span>
            </div>
            <div style="flex:1; display:flex; flex-direction:column; align-items:center; gap: 8px; height:100%; justify-content:flex-end;">
              <div id="chart-bar-month" style="width:30px; background:var(--color-info); border-radius:4px 4px 0 0; transition: height 0.5s;" style="height:0%;"></div>
              <span style="font-size:0.75rem; color:var(--color-text-muted)">Monthly</span>
            </div>
          </div>
        </div>

        <div class="card" style="padding: 28px;">
          <h3 style="margin-bottom: 16px;">Recent Completed Journeys</h3>
          <div id="recent-rides-list"></div>
        </div>
      </div>
    `;

    try {
      const res = await API.get('/api/driver/earnings');
      document.getElementById('earnings-loader').style.display = 'none';
      const content = document.getElementById('earnings-content');
      content.style.display = 'block';

      // Update values
      document.getElementById('stats-total-earnings').textContent = `₹${res.totalEarnings.toFixed(2)}`;
      document.getElementById('stats-today-earnings').textContent = `₹${res.todayEarnings.toFixed(2)}`;
      document.getElementById('stats-rating').textContent = `${res.rating.toFixed(1)} ★`;
      document.getElementById('stats-total-rides').textContent = res.totalRides;
      document.getElementById('stats-week-earnings').textContent = `₹${res.weekEarnings.toFixed(2)}`;
      document.getElementById('stats-month-earnings').textContent = `₹${res.monthEarnings.toFixed(2)}`;

      // Update charts
      const maxVal = Math.max(res.todayEarnings, res.weekEarnings, res.monthEarnings, 1);
      document.getElementById('chart-bar-today').style.height = `${(res.todayEarnings / maxVal) * 100}%`;
      document.getElementById('chart-bar-week').style.height = `${(res.weekEarnings / maxVal) * 100}%`;
      document.getElementById('chart-bar-month').style.height = `${(res.monthEarnings / maxVal) * 100}%`;

      const list = document.getElementById('recent-rides-list');
      if (res.recentRides.length === 0) {
        list.innerHTML = `<p style="text-align:center; color:var(--color-text-muted); font-size:0.9rem; padding: 20px 0;">No completed passenger rides registered yet.</p>`;
        return;
      }

      list.innerHTML = res.recentRides.map(r => {
        const date = new Date(r.completed_at).toLocaleDateString('en-IN', {
          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
        });
        return `
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--color-border); padding: 12px 0;">
            <div>
              <div style="font-weight:600; font-size:0.9rem;">Passenger: ${r.passenger_name}</div>
              <div style="font-size:0.75rem; color:var(--color-text-muted); margin-top:2px;">
                <span class="badge ${r.ride_type === 'shared' ? 'badge-primary' : 'badge-success'}" style="padding:1px 5px; font-size:0.65rem;">${r.ride_type.toUpperCase()}</span>
                <span style="margin-left: 6px;">Pickup: ${r.pickup_address}</span>
              </div>
            </div>
            <div style="text-align: right;">
              <div style="font-weight: 700; color:var(--color-success);">+₹${r.fare_final.toFixed(0)}</div>
              <div style="font-size: 0.75rem; color: var(--color-text-muted);">${date}</div>
            </div>
          </div>
        `;
      }).join('');

    } catch (err) {
      app.showToast('Could not fetch earnings records', 'error');
    }
  }
};
