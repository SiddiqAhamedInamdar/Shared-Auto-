// ═══════════════════════════════════════════════
// ShareAuto — API Client
// Handles all HTTP requests with auth token management
// ═══════════════════════════════════════════════

const API = {
  baseUrl: '',

  isAdminPath() {
    return window.location.pathname.startsWith('/admin');
  },

  getToken() {
    const key = this.isAdminPath() ? 'shareauto_admin_token' : 'shareauto_token';
    return localStorage.getItem(key);
  },

  setToken(token) {
    const key = this.isAdminPath() ? 'shareauto_admin_token' : 'shareauto_token';
    localStorage.setItem(key, token);
  },

  setRefreshToken(token) {
    const key = this.isAdminPath() ? 'shareauto_admin_refresh_token' : 'shareauto_refresh_token';
    localStorage.setItem(key, token);
  },

  getRefreshToken() {
    const key = this.isAdminPath() ? 'shareauto_admin_refresh_token' : 'shareauto_refresh_token';
    return localStorage.getItem(key);
  },

  setUser(user) {
    const key = this.isAdminPath() ? 'shareauto_admin_user' : 'shareauto_user';
    localStorage.setItem(key, JSON.stringify(user));
  },

  getUser() {
    try {
      const key = this.isAdminPath() ? 'shareauto_admin_user' : 'shareauto_user';
      return JSON.parse(localStorage.getItem(key));
    } catch (e) {
      return null;
    }
  },

  clearAuth() {
    if (this.isAdminPath()) {
      localStorage.removeItem('shareauto_admin_token');
      localStorage.removeItem('shareauto_admin_refresh_token');
      localStorage.removeItem('shareauto_admin_user');
    } else {
      localStorage.removeItem('shareauto_token');
      localStorage.removeItem('shareauto_refresh_token');
      localStorage.removeItem('shareauto_user');
    }
  },

  isAuthenticated() {
    return !!this.getToken();
  },

  async request(method, url, data = null, isFormData = false) {
    const headers = {};
    const token = this.getToken();

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    if (!isFormData) {
      headers['Content-Type'] = 'application/json';
    }

    const config = {
      method,
      headers,
    };

    if (data) {
      config.body = isFormData ? data : JSON.stringify(data);
    }

    try {
      const response = await fetch(`${this.baseUrl}${url}`, config);
      const result = await response.json();

      if (!response.ok) {
        // Try to refresh token on 401
        if (response.status === 401) {
          if (result.code === 'TOKEN_EXPIRED') {
            const refreshed = await this.refreshToken();
            if (refreshed) {
              // Retry the request with new token
              headers['Authorization'] = `Bearer ${this.getToken()}`;
              const retryConfig = { ...config, headers };
              const retryResponse = await fetch(`${this.baseUrl}${url}`, retryConfig);
              return await retryResponse.json();
            }
          }

          // If unauthorized and not a login/signup route, trigger clean logout
          if (!url.includes('/api/auth/login') && !url.includes('/api/auth/signup') && !url.includes('/api/auth/admin/login')) {
            this.clearAuth();
            if (typeof app !== 'undefined' && app.logout) {
              app.logout();
            } else if (typeof AdminApp !== 'undefined' && AdminApp.logout) {
              AdminApp.logout();
            } else {
              window.location.hash = '#/login';
            }
          }
        }

        // If forbidden, the role might be out of sync
        if (response.status === 403) {
          if (typeof app !== 'undefined' && app.handleRouting) {
            app.handleRouting();
          } else if (typeof AdminApp !== 'undefined' && AdminApp.init) {
            AdminApp.init();
          }
        }

        throw { status: response.status, ...result };
      }

      return result;
    } catch (err) {
      if (err.status) throw err;
      throw { error: 'Network error. Please check your connection.' };
    }
  },

  async refreshToken() {
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) return false;

    try {
      const response = await fetch(`${this.baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken })
      });

      if (response.ok) {
        const data = await response.json();
        this.setToken(data.token);
        return true;
      }
    } catch (e) { /* ignore */ }

    this.clearAuth();
    return false;
  },

  // Convenience methods
  get(url) { return this.request('GET', url); },
  post(url, data) { return this.request('POST', url, data); },
  put(url, data) { return this.request('PUT', url, data); },
  delete(url) { return this.request('DELETE', url); },
  upload(url, formData) { return this.request('POST', url, formData, true); }
};
