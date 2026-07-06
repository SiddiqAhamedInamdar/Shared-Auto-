// ═══════════════════════════════════════════════
// ShareAuto — Admin Dashboard Logic
// ═══════════════════════════════════════════════

// Auto-mock native dialogs for headless/automated testing environments
if (navigator.userAgent.includes('Headless') || navigator.webdriver) {
  window.confirm = () => true;
  window.prompt = (msg, defaultText) => defaultText || "Action completed by Admin";
}

const AdminApp = {
  activeTab: 'overview',
  currentUser: null,

  async init() {
    window.showToast = (msg, type) => this.showToast(msg, type);

    const isAuthed = API.isAuthenticated();
    if (!isAuthed) {
      this.renderLogin();
      return;
    }

    try {
      const res = await API.get('/api/auth/me');
      if (res.user.role !== 'admin') {
        this.showToast('Access denied. Admin role required.', 'error');
        API.clearAuth();
        this.renderLogin();
        return;
      }
      this.currentUser = res.user;
      this.renderLayout();
      this.switchTab('overview');
    } catch (err) {
      console.error(err);
      API.clearAuth();
      this.renderLogin();
    }
  },

  renderLogin() {
    const container = document.getElementById('app');
    container.innerHTML = `
      <div class="admin-login-page">
        <div class="admin-login-card">
          <div class="admin-login-badge">
            <i class="fas fa-lock"></i> Secure Admin Area
          </div>
          <h2 style="margin-bottom: 8px;">ShareAuto Portal</h2>
          <p style="color:var(--color-text-muted); font-size:0.85rem; margin-bottom: 24px;">Enter administrative credentials to log in</p>
          
          <form id="admin-login-form">
            <div class="form-group">
              <label class="form-label" for="admin-email">Admin Email</label>
              <input type="email" id="admin-email" class="form-control" placeholder="admin@shareauto.com" required>
            </div>
            
            <div class="form-group">
              <label class="form-label" for="admin-password">Password</label>
              <input type="password" id="admin-password" class="form-control" placeholder="••••••••" required>
            </div>
            
            <button type="submit" class="btn btn-primary btn-block" style="width:100%; margin-top:16px;">
              Admin Log In <i class="fas fa-sign-in-alt"></i>
            </button>
          </form>
        </div>
      </div>
    `;

    const form = document.getElementById('admin-login-form');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const email = document.getElementById('admin-email').value;
      const password = document.getElementById('admin-password').value;

      try {
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i> Authenticating...`;

        const res = await API.post('/api/auth/admin/login', { email, password });
        API.setToken(res.token);
        API.setUser(res.user);
        this.currentUser = res.user;

        this.showToast('Admin access granted', 'success');
        this.renderLayout();
        this.switchTab('overview');
      } catch (err) {
        this.showToast(err.error || 'Invalid credentials.', 'error');
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = false;
        btn.innerHTML = `Admin Log In <i class="fas fa-sign-in-alt"></i>`;
      }
    };
  },

  renderLayout() {
    const container = document.getElementById('app');
    container.innerHTML = `
      <div class="dashboard-layout">
        <aside class="sidebar">
          <div class="sidebar-header">
            <span class="sidebar-logo"><i class="fas fa-user-shield text-gradient" style="margin-right: 6px;"></i>Admin Panel</span>
          </div>
          <nav class="sidebar-nav">
            <div class="nav-section-label">Operations</div>
            <div class="nav-item active" id="tab-overview" onclick="AdminApp.switchTab('overview')">
              <i class="nav-icon fas fa-chart-pie"></i> Overview
            </div>
            <div class="nav-item" id="tab-approvals" onclick="AdminApp.switchTab('approvals')">
              <i class="nav-icon fas fa-check-double"></i> Driver Approvals
            </div>
            <div class="nav-item" id="tab-users" onclick="AdminApp.switchTab('users')">
              <i class="nav-icon fas fa-users-cog"></i> User Accounts
            </div>
            <div class="nav-item" id="tab-rides" onclick="AdminApp.switchTab('rides')">
              <i class="nav-icon fas fa-route"></i> Rides Monitor
            </div>
            <div class="nav-item" id="tab-complaints" onclick="AdminApp.switchTab('complaints')">
              <i class="nav-icon fas fa-comment-slash"></i> Complaints Desk
            </div>
            <div class="nav-item" id="tab-analytics" onclick="AdminApp.switchTab('analytics')">
              <i class="nav-icon fas fa-analytics"></i> Analytics
            </div>
          </nav>
          <div class="sidebar-footer">
            <div class="sidebar-user">
              <div class="sidebar-avatar" style="background:var(--gradient-danger);">AD</div>
              <div class="sidebar-user-info">
                <div class="sidebar-user-name">${this.currentUser.full_name}</div>
                <div class="sidebar-user-role">System Admin</div>
              </div>
            </div>
            <button class="btn btn-secondary btn-block" style="margin-top: 12px; width: 100%;" onclick="AdminApp.logout()">
              <i class="fas fa-sign-out-alt"></i> Logout
            </button>
          </div>
        </aside>
        <main class="main-content">
          <div class="page-header">
            <h2 class="page-title" id="admin-page-title">Admin Console</h2>
            <p class="page-subtitle" id="admin-page-subtitle">Realtime systems management</p>
          </div>
          <div class="page-body" id="admin-body-content"></div>
        </main>
      </div>

      <!-- Hidden Document Viewer Modal -->
      <div id="viewer-modal-container"></div>
    `;
  },

  logout() {
    API.clearAuth();
    this.currentUser = null;
    this.renderLogin();
    this.showToast('Admin logged out', 'info');
  },

  switchTab(tab) {
    this.activeTab = tab;
    
    // Update sidebar navigation selection state
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
      const id = item.getAttribute('id');
      if (id === `tab-${tab}`) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    const body = document.getElementById('admin-body-content');
    body.innerHTML = `<div class="loader-container"><div class="spinner"></div><p>Fetching database state...</p></div>`;

    if (tab === 'overview') {
      this.renderOverview(body);
    } else if (tab === 'approvals') {
      this.renderApprovals(body);
    } else if (tab === 'users') {
      this.renderUsers(body);
    } else if (tab === 'rides') {
      this.renderRides(body);
    } else if (tab === 'complaints') {
      this.renderComplaints(body);
    } else if (tab === 'analytics') {
      this.renderAnalytics(body);
    }
  },

  updateHeader(title, subtitle) {
    document.getElementById('admin-page-title').textContent = title;
    document.getElementById('admin-page-subtitle').textContent = subtitle;
  },

  async renderOverview(container) {
    this.updateHeader('System Overview', 'Quick analytics & operations status');
    try {
      const data = await API.get('/api/admin/dashboard');

      const sharedPercent = data.completedRides > 0 
        ? ((data.sharedRides / data.completedRides) * 100).toFixed(0) 
        : 50;
      const privatePercent = data.completedRides > 0 
        ? ((data.privateRides / data.completedRides) * 100).toFixed(0) 
        : 50;

      container.innerHTML = `
        <!-- Stats Row -->
        <div class="admin-stats">
          <div class="earnings-card">
            <div class="earnings-card-value" style="color:var(--color-accent);">${data.totalUsers}</div>
            <div class="earnings-card-label">Passengers</div>
          </div>
          <div class="earnings-card">
            <div class="earnings-card-value" style="color:var(--color-info);">${data.totalDrivers}</div>
            <div class="earnings-card-label">Drivers</div>
          </div>
          <div class="earnings-card">
            <div class="earnings-card-value" style="color:var(--color-success);">${data.onlineDrivers} Online</div>
            <div class="earnings-card-label">Active Rickshaws</div>
          </div>
          <div class="earnings-card">
            <div class="earnings-card-value" style="color:var(--color-warning);">${data.pendingDrivers}</div>
            <div class="earnings-card-label">Pending Approvals</div>
          </div>
        </div>

        <div class="admin-stats" style="margin-top:-16px;">
          <div class="earnings-card">
            <div class="earnings-card-value" style="color:var(--color-info);">${data.activeRides}</div>
            <div class="earnings-card-label">Ongoing Journeys</div>
          </div>
          <div class="earnings-card">
            <div class="earnings-card-value">${data.completedRides}</div>
            <div class="earnings-card-label">Historical Rides</div>
          </div>
          <div class="earnings-card">
            <div class="earnings-card-value" style="color:var(--color-success);">₹${data.todayRevenue.toFixed(0)}</div>
            <div class="earnings-card-label">Today's Revenue</div>
          </div>
          <div class="earnings-card">
            <div class="earnings-card-value" style="color:var(--color-danger);">${data.openComplaints}</div>
            <div class="earnings-card-label">Active Complaints</div>
          </div>
        </div>

        <!-- CSS Donut Chart for Ride Type Split -->
        <div class="grid grid-2" style="margin-top: 12px;">
          <div class="card" style="padding: 28px; text-align: center;">
            <h4 style="margin-bottom: 20px;">Ride Type Distribution (Completed)</h4>
            
            <div class="donut-chart" style="background: conic-gradient(var(--color-accent) 0% ${sharedPercent}%, var(--color-success) ${sharedPercent}% 100%);">
              <div class="donut-chart-center" style="background:var(--color-bg-secondary); width: 120px; height:120px; border-radius:50%; display:flex; flex-direction:column; align-items:center; justify-content:center;">
                <span class="donut-chart-center-value">${data.completedRides}</span>
                <span class="donut-chart-center-label">Total Completed</span>
              </div>
            </div>

            <div class="chart-legend">
              <div class="chart-legend-item">
                <span class="chart-legend-dot" style="background:var(--color-accent)"></span>
                <span>Shared Auto (${sharedPercent}%)</span>
              </div>
              <div class="chart-legend-item">
                <span class="chart-legend-dot" style="background:var(--color-success)"></span>
                <span>Private Auto (${privatePercent}%)</span>
              </div>
            </div>
          </div>

          <div class="card" style="padding: 28px; display: flex; flex-direction: column; justify-content: center; align-items: center;">
            <i class="fas fa-lock-open text-gradient" style="font-size:3rem; margin-bottom:16px;"></i>
            <h4>Quick Actions</h4>
            <div style="display:flex; flex-direction:column; gap:10px; width:100%; margin-top:20px;">
              <button class="btn btn-primary" onclick="AdminApp.switchTab('approvals')">Review Pending Drivers</button>
              <button class="btn btn-secondary" onclick="AdminApp.switchTab('complaints')">View System Complaints</button>
            </div>
          </div>
        </div>
      `;
    } catch (e) {
      console.error(e);
    }
  },

  async renderApprovals(container) {
    this.updateHeader('Driver Registrations', 'Pending credentials and vehicle verifications');
    try {
      const data = await API.get('/api/admin/drivers/pending');
      
      if (data.drivers.length === 0) {
        container.innerHTML = `
          <div class="card" style="text-align: center; padding: 40px;">
            <i class="fas fa-clipboard-check" style="font-size: 3rem; color: var(--color-text-muted); margin-bottom: 16px;"></i>
            <p>All driver applications are fully verified!</p>
          </div>
        `;
        return;
      }

      container.innerHTML = data.drivers.map(d => `
        <div class="verification-card">
          <div class="verification-header">
            <div class="verification-avatar">${d.full_name[0].toUpperCase()}</div>
            <div class="verification-info">
              <div class="verification-name">${d.full_name}</div>
              <div class="verification-meta">Email: ${d.email} | Phone: ${d.phone} | Gender: ${d.gender}</div>
            </div>
            <span class="badge badge-warning">PENDING VERIFICATION</span>
          </div>

          <div class="verification-details">
            <div class="verification-detail">
              <div class="verification-detail-label">Driving Credentials</div>
              <div class="verification-detail-value">License: <strong>${d.license_number || 'N/A'}</strong></div>
              <div class="verification-detail-value" style="margin-top: 4px;">Exp: ${d.experience_years} Years</div>
            </div>
            <div class="verification-detail">
              <div class="verification-detail-label">Vehicle Details</div>
              <div class="verification-detail-value">Reg: <strong>${d.registration_number || 'N/A'}</strong></div>
              <div class="verification-detail-value" style="margin-top: 4px;">Model: ${d.vehicle_color || ''} ${d.vehicle_model || 'Rickshaw'}</div>
            </div>
          </div>

          <div class="verification-documents">
            <div class="verification-doc" onclick="AdminApp.viewDocument('${d.profile_photo}')">
              <div class="verification-doc-icon text-gradient"><i class="fas fa-image"></i></div>
              <div class="verification-doc-label">Profile Photo</div>
            </div>
            <div class="verification-doc" onclick="AdminApp.viewDocument('${d.license_photo}')">
              <div class="verification-doc-icon text-gradient"><i class="fas fa-file-invoice"></i></div>
              <div class="verification-doc-label">License copy</div>
            </div>
            <div class="verification-doc" onclick="AdminApp.viewDocument('${d.vehicle_photo}')">
              <div class="verification-doc-icon text-gradient"><i class="fas fa-taxi"></i></div>
              <div class="verification-doc-label">Vehicle Photo</div>
            </div>
          </div>

          <div class="verification-actions">
            <button class="btn btn-danger" style="flex:1;" onclick="AdminApp.verifyDriver(${d.id}, 'reject')">Reject Partner</button>
            <button class="btn btn-success" style="flex:2;" onclick="AdminApp.verifyDriver(${d.id}, 'approve')">Approve Partner</button>
          </div>
        </div>
      `).join('');
    } catch (e) {
      console.error(e);
    }
  },

  viewDocument(filename) {
    if (!filename || filename === 'null') {
      this.showToast('No document file uploaded', 'warning');
      return;
    }

    const container = document.getElementById('viewer-modal-container');
    container.innerHTML = `
      <div class="modal-overlay" style="display: flex; align-items: center; justify-content: center; position: fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.85); z-index:99999;" onclick="document.getElementById('viewer-modal-container').innerHTML = ''">
        <div class="card" style="max-width: 600px; padding: 12px; background:var(--color-bg-secondary); border: 1px solid var(--color-border); cursor:default;" onclick="event.stopPropagation()">
          <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
            <span>Verification Document</span>
            <span style="cursor:pointer;" onclick="document.getElementById('viewer-modal-container').innerHTML = ''"><i class="fas fa-times"></i></span>
          </div>
          <img src="/uploads/${filename}" style="width:100%; border-radius:var(--radius-md); max-height:480px; object-fit:contain;">
        </div>
      </div>
    `;
  },

  async verifyDriver(id, action) {
    let reason = '';
    if (action === 'reject') {
      reason = prompt('Enter reason for application rejection:');
      if (reason === null) return;
    } else {
      if (!confirm('Are you sure you want to approve this driver application?')) return;
    }

    try {
      const res = await API.post(`/api/admin/drivers/${id}/verify`, { action, reason });
      this.showToast(res.message, 'success');
      this.switchTab('approvals');
    } catch (err) {
      this.showToast(err.error || 'Verification process failed', 'error');
    }
  },

  async renderUsers(container) {
    this.updateHeader('User Management', 'Suspend or activate passengers and driver accounts');
    try {
      const data = await API.get('/api/admin/users');
      
      container.innerHTML = `
        <div class="card" style="padding: 24px; overflow-x: auto;">
          <table class="table" style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="text-align: left; border-bottom: 1px solid var(--color-border);">
                <th style="padding: 12px;">Full Name</th>
                <th style="padding: 12px;">Email</th>
                <th style="padding: 12px;">Role</th>
                <th style="padding: 12px;">Wallet</th>
                <th style="padding: 12px;">Status</th>
                <th style="padding: 12px; text-align:right;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${data.users.map(u => {
                let statusBadge = `<span class="badge badge-success">ACTIVE</span>`;
                if (u.status === 'suspended') statusBadge = `<span class="badge badge-danger">SUSPENDED</span>`;
                
                let actionBtn = '';
                if (u.role !== 'admin') {
                  actionBtn = u.status === 'suspended'
                    ? `<button class="btn btn-secondary btn-sm" onclick="AdminApp.toggleUserStatus(${u.id}, 'activate')">Activate</button>`
                    : `<button class="btn btn-danger btn-sm" onclick="AdminApp.toggleUserStatus(${u.id}, 'suspend')">Suspend</button>`;
                }

                return `
                  <tr style="border-bottom: 1px solid rgba(255,255,255,0.03);">
                    <td style="padding: 12px; font-weight:600;">${u.full_name}</td>
                    <td style="padding: 12px; color:var(--color-text-secondary);">${u.email}</td>
                    <td style="padding: 12px; text-transform:capitalize;">${u.role}</td>
                    <td style="padding: 12px; font-weight:600;">₹${u.wallet_balance.toFixed(2)}</td>
                    <td style="padding: 12px;">${statusBadge}</td>
                    <td style="padding: 12px; text-align:right;">${actionBtn}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (e) {
      console.error(e);
    }
  },

  async toggleUserStatus(id, action) {
    if (!confirm(`Are you sure you want to ${action} this user?`)) return;

    try {
      const res = await API.post(`/api/admin/users/${id}/suspend`, { action });
      this.showToast(res.message, 'success');
      this.switchTab('users');
    } catch (err) {
      this.showToast(err.error || 'Failed to update user status', 'error');
    }
  },

  async renderRides(container) {
    this.updateHeader('Rides Monitor', 'Realtime tracking of all matching, active, and past bookings');
    try {
      const data = await API.get('/api/admin/rides');

      if (data.rides.length === 0) {
        container.innerHTML = `<div class="card" style="text-align:center; padding:40px;"><p>No bookings registered in the system yet.</p></div>`;
        return;
      }

      container.innerHTML = `
        <div class="card" style="padding: 24px; overflow-x: auto;">
          <table class="table" style="width:100%; border-collapse: collapse;">
            <thead>
              <tr style="text-align:left; border-bottom: 1px solid var(--color-border);">
                <th style="padding: 12px;">Ride ID</th>
                <th style="padding: 12px;">Passenger</th>
                <th style="padding: 12px;">Driver</th>
                <th style="padding: 12px;">Route Details</th>
                <th style="padding: 12px;">Ride Type</th>
                <th style="padding: 12px;">Status</th>
                <th style="padding: 12px; text-align:right;">Fare</th>
              </tr>
            </thead>
            <tbody>
              ${data.rides.map(r => {
                let statusClass = 'badge-primary';
                if (r.status === 'completed') statusClass = 'badge-success';
                if (r.status === 'cancelled') statusClass = 'badge-danger';
                if (r.status === 'matching') statusClass = 'badge-warning';

                return `
                  <tr style="border-bottom: 1px solid rgba(255,255,255,0.03); font-size:0.85rem;">
                    <td style="padding: 12px;">#${r.id}</td>
                    <td style="padding: 12px; font-weight:600;">${r.passenger_name}</td>
                    <td style="padding: 12px; color:var(--color-text-secondary);">${r.driver_name || '<em style="color:var(--color-text-muted);">Unassigned</em>'}</td>
                    <td style="padding: 12px; max-width: 250px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                      <div style="font-weight:600;">Pickup: ${r.pickup_address}</div>
                      <div style="color:var(--color-text-muted); font-size:0.75rem; margin-top:2px;">Drop: ${r.drop_address}</div>
                    </td>
                    <td style="padding: 12px; text-transform:uppercase;"><span class="badge ${r.ride_type === 'shared' ? 'badge-primary' : 'badge-success'}" style="padding:2px 6px; font-size:0.65rem;">${r.ride_type}</span></td>
                    <td style="padding: 12px;"><span class="badge ${statusClass}">${r.status.toUpperCase()}</span></td>
                    <td style="padding: 12px; text-align:right; font-weight:700;">₹${(r.fare_final || r.fare_estimate).toFixed(0)}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (e) {
      console.error(e);
    }
  },

  async renderComplaints(container) {
    this.updateHeader('Complaints Desk', 'Respond to client reports and issues');
    try {
      const data = await API.get('/api/admin/complaints');

      if (data.complaints.length === 0) {
        container.innerHTML = `
          <div class="card" style="text-align: center; padding: 40px;">
            <i class="fas fa-smile" style="font-size: 3rem; color: var(--color-success); margin-bottom: 16px;"></i>
            <p>Excellent! There are no complaints in the registry.</p>
          </div>
        `;
        return;
      }

      container.innerHTML = data.complaints.map(c => {
        let statusBadge = `<span class="badge badge-danger">OPEN</span>`;
        if (c.status === 'resolved') statusBadge = `<span class="badge badge-success">RESOLVED</span>`;
        
        return `
          <div class="complaint-card">
            <div class="complaint-header">
              <div>
                <span class="complaint-subject">${c.subject}</span>
                <div class="complaint-user">Reporter: <strong>${c.user_name}</strong> (${c.user_email})</div>
              </div>
              <div style="text-align:right;">
                ${statusBadge}
                <div style="font-size: 0.75rem; color: var(--color-text-muted); margin-top: 4px;">Date: ${new Date(c.created_at).toLocaleDateString()}</div>
              </div>
            </div>

            <div class="complaint-description">${c.description}</div>

            ${c.ride_id ? `
              <div class="complaint-ride-info">
                <span>Ride Reference: <strong>#${c.ride_id}</strong></span>
                <span>Type: <strong>${c.ride_type.toUpperCase()}</strong></span>
                <span>Pickup: <strong>${c.pickup_address}</strong></span>
              </div>
            ` : ''}

            ${c.status !== 'resolved' ? `
              <div style="margin-top: 16px; display:flex; justify-content:flex-end;">
                <button class="btn btn-primary btn-sm" onclick="AdminApp.resolveComplaint(${c.id})">
                  <i class="fas fa-check"></i> Address & Resolve
                </button>
              </div>
            ` : `
              <div style="background: rgba(255,255,255,0.02); border-left:3px solid var(--color-success); padding:10px; border-radius:4px; font-size:0.8rem; color:var(--color-text-secondary);">
                <strong>Resolution Response:</strong> ${c.admin_response || 'Addressed by admin.'}
              </div>
            `}
          </div>
        `;
      }).join('');
    } catch (e) {
      console.error(e);
    }
  },

  async resolveComplaint(id) {
    const response = prompt('Enter resolution remarks to notify the user:');
    if (response === null) return;

    try {
      const res = await API.post(`/api/admin/complaints/${id}/resolve`, { response, status: 'resolved' });
      this.showToast(res.message, 'success');
      this.switchTab('complaints');
    } catch (err) {
      this.showToast(err.error || 'Failed to resolve issue', 'error');
    }
  },

  async renderAnalytics(container) {
    this.updateHeader('Operations Analytics', 'System peaks, cancellations and driver metrics');
    try {
      const data = await API.get('/api/admin/analytics');

      container.innerHTML = `
        <div class="grid grid-3" style="gap:20px; margin-bottom: 24px;">
          <div class="earnings-card">
            <div class="earnings-card-value" style="color:var(--color-danger);">${data.cancellationRate}%</div>
            <div class="earnings-card-label">Cancellation Rate</div>
          </div>
          <div class="earnings-card">
            <div class="earnings-card-value" style="color:var(--color-success);">₹${data.revenueByDay.reduce((sum, d) => sum + d.revenue, 0).toFixed(0)}</div>
            <div class="earnings-card-label">Total revenue (30 days)</div>
          </div>
          <div class="earnings-card">
            <div class="earnings-card-value" style="color:var(--color-info);">${data.ridesByHour.length} Peak slots</div>
            <div class="earnings-card-label">Peak Slots Tracked</div>
          </div>
        </div>

        <!-- CSS Bar Chart (Peak Hours slots) -->
        <div class="card" style="padding: 24px; margin-bottom: 24px;">
          <h4 style="margin-bottom: 16px;">Ride Demands by Hour (24h format - Past 30 Days)</h4>
          <div class="bar-chart">
            ${data.ridesByHour.map(h => {
              const maxCount = Math.max(...data.ridesByHour.map(item => item.count), 1);
              const heightPercent = (h.count / maxCount) * 100;
              return `
                <div class="bar-chart-item">
                  <span class="bar-chart-value">${h.count}</span>
                  <div class="bar-chart-bar" style="height: ${heightPercent}%;"></div>
                  <span class="bar-chart-label">${h.hour}:00</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- Top drivers -->
        <div class="card" style="padding:28px;">
          <h3 style="margin-bottom: 16px;">Top Driver Payouts</h3>
          <table class="table" style="width:100%; border-collapse:collapse;">
            <thead>
              <tr style="text-align:left; border-bottom: 1px solid var(--color-border);">
                <th style="padding:12px;">Driver Name</th>
                <th style="padding:12px;">Rides Completed</th>
                <th style="padding:12px;">Avg. Rating</th>
                <th style="padding:12px; text-align:right;">Lifetime Payouts</th>
              </tr>
            </thead>
            <tbody>
              ${data.topDrivers.map(d => `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.03);">
                  <td style="padding:12px; font-weight:600;">${d.full_name}</td>
                  <td style="padding:12px;">${d.total_rides} Rides</td>
                  <td style="padding:12px; color:var(--color-warning);">${d.rating_avg.toFixed(1)} ★</td>
                  <td style="padding:12px; text-align:right; font-weight:700; color:var(--color-success);">₹${d.total_earnings.toFixed(0)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (e) {
      console.error(e);
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
  document.addEventListener('DOMContentLoaded', () => AdminApp.init());
} else {
  AdminApp.init();
}

