// ═══════════════════════════════════════════════
// ShareAuto — SPA Orchestrator & Router
// ═══════════════════════════════════════════════

const app = {
  currentUser: null,
  driverInfo: null,
  vehicleInfo: null,
  activeRoute: '',

  async init() {
    window.showToast = (msg, type) => this.showToast(msg, type);

    // Set up routing events
    window.addEventListener('hashchange', () => this.handleRouting());
    
    // Listen for storage changes to sync multiple tabs
    window.addEventListener('storage', (event) => {
      if (event.key === 'shareauto_token' || event.key === 'shareauto_user') {
        if (!API.isAuthenticated()) {
          this.logout();
        } else {
          this.handleRouting();
        }
      }
    });
    
    // Check initial authentication
    if (API.isAuthenticated()) {
      try {
        await this.fetchUserProfile();
        WS.connect();
      } catch (err) {
        console.error('Failed to restore session:', err);
        API.clearAuth();
      }
    }

    // Run router
    this.handleRouting();
  },

  async fetchUserProfile() {
    try {
      const res = await API.get('/api/auth/me');
      this.currentUser = res.user;
      this.driverInfo = res.driver;
      this.vehicleInfo = res.vehicle;
      API.setUser(res.user);
    } catch (err) {
      throw err;
    }
  },

  async handleRouting() {
    const hash = window.location.hash || '#/login';
    this.activeRoute = hash;

    const isAuthed = API.isAuthenticated();

    // Guard login/signup
    if (!isAuthed) {
      if (typeof DriverView !== 'undefined' && DriverView.stopLocationTracking) {
        DriverView.stopLocationTracking();
      }
      if (hash !== '#/login' && hash !== '#/signup') {
        this.navigate('#/login');
        return;
      }
      this.renderGuestLayout(hash);
      return;
    }

    // Sync currentUser from localStorage to handle multi-tab synchronization
    const localUser = API.getUser();
    if (localUser) {
      this.currentUser = localUser;
    }

    if (!this.currentUser) {
      try {
        await this.fetchUserProfile();
      } catch (err) {
        console.error('Failed to fetch user profile:', err);
        this.logout();
        return;
      }
    }

    // User is authenticated
    if (hash === '#/login' || hash === '#/signup') {
      this.redirectHomeByRole();
      return;
    }

    // Role checks
    const role = this.currentUser.role;
    
    if (role === 'passenger') {
      if (typeof DriverView !== 'undefined' && DriverView.stopLocationTracking) {
        DriverView.stopLocationTracking();
      }
      if (!hash.startsWith('#/passenger')) {
        this.navigate('#/passenger/home');
        return;
      }
      this.renderAppLayout();
      this.routePassenger(hash);
    } else if (role === 'driver') {
      // If driver is onboarding or pending documentation
      const isPendingOnboarding = !this.driverInfo || !this.driverInfo.license_number || !this.vehicleInfo;
      
      if (isPendingOnboarding && hash !== '#/driver/onboarding') {
        this.navigate('#/driver/onboarding');
        return;
      }
      
      if (!isPendingOnboarding && hash === '#/driver/onboarding') {
        this.navigate('#/driver/dashboard');
        return;
      }

      if (!hash.startsWith('#/driver')) {
        this.navigate('#/driver/dashboard');
        return;
      }
      this.renderAppLayout();
      this.routeDriver(hash);
    } else if (role === 'admin') {
      if (typeof DriverView !== 'undefined' && DriverView.stopLocationTracking) {
        DriverView.stopLocationTracking();
      }
      // Admin role is not supported on passenger/driver app. Clear stale user-space auth and show login.
      API.clearAuth();
      this.navigate('#/login');
      return;
    }
  },

  redirectHomeByRole() {
    if (this.currentUser.role === 'passenger') {
      this.navigate('#/passenger/home');
    } else if (this.currentUser.role === 'driver') {
      const isPendingOnboarding = !this.driverInfo || !this.driverInfo.license_number || !this.vehicleInfo;
      if (isPendingOnboarding) {
        this.navigate('#/driver/onboarding');
      } else {
        this.navigate('#/driver/dashboard');
      }
    } else if (this.currentUser.role === 'admin') {
      API.clearAuth();
      this.navigate('#/login');
    }
  },

  navigate(hash) {
    window.location.hash = hash;
  },

  logout() {
    if (typeof DriverView !== 'undefined' && DriverView.stopLocationTracking) {
      DriverView.stopLocationTracking();
    }
    API.clearAuth();
    WS.disconnect();
    this.currentUser = null;
    this.driverInfo = null;
    this.vehicleInfo = null;
    this.renderedRole = null;
    this.navigate('#/login');
    this.showToast('Logged out successfully', 'success');
  },

  renderGuestLayout(hash) {
    const container = document.getElementById('app');
    container.innerHTML = `<div id="auth-container"></div>`;
    
    if (hash === '#/login') {
      AuthView.renderLogin(document.getElementById('auth-container'));
    } else if (hash === '#/signup') {
      AuthView.renderSignup(document.getElementById('auth-container'));
    }
  },

  renderAppLayout() {
    const container = document.getElementById('app');
    
    // Only render full layout if it doesn't exist or if role changed
    const layout = container.querySelector('.dashboard-layout');
    if (layout && this.renderedRole === this.currentUser.role) {
      this.updateSidebarActiveState();
      return;
    }
    this.renderedRole = this.currentUser.role;

    const roleLabel = this.currentUser.role === 'passenger' ? 'Passenger' : 'Driver Partner';
    const initials = this.currentUser.full_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

    let navItemsHtml = '';
    if (this.currentUser.role === 'passenger') {
      navItemsHtml = `
        <div class="nav-section-label">Ride Booking</div>
        <div class="nav-item" data-hash="#/passenger/home" onclick="app.navigate('#/passenger/home')">
          <i class="nav-icon fas fa-map-marked-alt"></i> Book Ride
        </div>
        <div class="nav-item" data-hash="#/passenger/rides" onclick="app.navigate('#/passenger/rides')">
          <i class="nav-icon fas fa-history"></i> Ride History
        </div>
        <div class="nav-section-label">Account</div>
        <div class="nav-item" data-hash="#/passenger/profile" onclick="app.navigate('#/passenger/profile')">
          <i class="nav-icon fas fa-user"></i> My Profile
        </div>
      `;
    } else if (this.currentUser.role === 'driver') {
      // Show full menu only if onboarded
      const isPendingOnboarding = !this.driverInfo || !this.driverInfo.license_number || !this.vehicleInfo;
      if (isPendingOnboarding) {
        navItemsHtml = `
          <div class="nav-section-label">Onboarding</div>
          <div class="nav-item active" data-hash="#/driver/onboarding">
            <i class="nav-icon fas fa-id-card"></i> Driver Onboarding
          </div>
        `;
      } else {
        navItemsHtml = `
          <div class="nav-section-label">Operations</div>
          <div class="nav-item" data-hash="#/driver/dashboard" onclick="app.navigate('#/driver/dashboard')">
            <i class="nav-icon fas fa-tachometer-alt"></i> Driver Dashboard
          </div>
          <div class="nav-item" data-hash="#/driver/history" onclick="app.navigate('#/driver/history')">
            <i class="nav-icon fas fa-wallet"></i> Earnings & History
          </div>
        `;
      }
    }

    container.innerHTML = `
      <div class="dashboard-layout">
        <aside class="sidebar">
          <div class="sidebar-header">
            <span class="sidebar-logo"><i class="fas fa-route text-gradient" style="margin-right: 6px;"></i>ShareAuto</span>
          </div>
          <nav class="sidebar-nav">
            ${navItemsHtml}
          </nav>
          <div class="sidebar-footer">
            <div class="sidebar-user">
              <div class="sidebar-avatar">${initials}</div>
              <div class="sidebar-user-info">
                <div class="sidebar-user-name">${this.currentUser.full_name}</div>
                <div class="sidebar-user-role">${roleLabel}</div>
              </div>
            </div>
            <button class="btn btn-secondary btn-block" style="margin-top: 12px; width: 100%;" onclick="app.logout()">
              <i class="fas fa-sign-out-alt"></i> Logout
            </button>
          </div>
        </aside>
        <main class="main-content">
          <div class="page-header">
            <h2 class="page-title" id="page-title">Home</h2>
            <p class="page-subtitle" id="page-subtitle">Welcome to ShareAuto</p>
          </div>
          <div class="page-body" id="page-body-content"></div>
        </main>
      </div>
    `;

    this.updateSidebarActiveState();
  },

  updateSidebarActiveState() {
    const items = document.querySelectorAll('.sidebar-nav .nav-item');
    items.forEach(item => {
      const matchHash = item.getAttribute('data-hash');
      if (this.activeRoute === matchHash) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  },

  updatePageHeader(title, subtitle) {
    document.getElementById('page-title').textContent = title;
    document.getElementById('page-subtitle').textContent = subtitle;
  },

  routePassenger(hash) {
    const pageBody = document.getElementById('page-body-content');
    if (hash === '#/passenger/home') {
      this.updatePageHeader('Request Ride', 'Enter locations to search or book share auto rickshaws');
      PassengerView.renderHome(pageBody);
    } else if (hash === '#/passenger/rides') {
      this.updatePageHeader('Ride History', 'View your past auto bookings and transactions');
      PassengerView.renderRides(pageBody);
    } else if (hash === '#/passenger/profile') {
      this.updatePageHeader('Profile & Wallet', 'Manage credentials, preferences and add money to wallet');
      PassengerView.renderProfile(pageBody);
    }
  },

  routeDriver(hash) {
    const pageBody = document.getElementById('page-body-content');
    if (hash === '#/driver/onboarding') {
      this.updatePageHeader('Driver Verification', 'Complete document submission to activate driver profile');
      DriverView.renderOnboarding(pageBody);
    } else if (hash === '#/driver/dashboard') {
      this.updatePageHeader('Partner Dashboard', 'Manage availability, accept incoming bookings, and track ride progress');
      DriverView.renderDashboard(pageBody);
    } else if (hash === '#/driver/history') {
      this.updatePageHeader('Earnings & History', 'Review detailed earnings breakdown and historic rides');
      DriverView.renderHistory(pageBody);
    }
  },

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let iconClass = 'fa-info-circle';
    if (type === 'success') iconClass = 'fa-check-circle';
    if (type === 'error') iconClass = 'fa-exclamation-circle';
    if (type === 'warning') iconClass = 'fa-exclamation-triangle';

    toast.innerHTML = `
      <i class="toast-icon fas ${iconClass}"></i>
      <div class="toast-message">${message}</div>
      <button class="toast-close">&times;</button>
    `;

    container.appendChild(toast);

    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.onclick = () => {
      toast.classList.add('removing');
      toast.addEventListener('animationend', () => toast.remove());
    };

    setTimeout(() => {
      if (toast.parentNode) {
        toast.classList.add('removing');
        toast.addEventListener('animationend', () => toast.remove());
      }
    }, 4000);
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => app.init());
} else {
  app.init();
}

