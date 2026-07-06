// ═══════════════════════════════════════════════
// ShareAuto — Auth View & Logic
// ═══════════════════════════════════════════════

const AuthView = {
  renderLogin(container) {
    container.innerHTML = `
      <div class="auth-page">
        <!-- Left Hero Panel -->
        <div class="auth-hero">
          <div class="auth-hero-content">
            <div class="auth-brand">
              <div class="auth-brand-icon">
                <i class="fas fa-route"></i>
              </div>
              <span class="auth-brand-name">ShareAuto</span>
            </div>
            <h1>Reliable Auto-Rickshaw Rides, Shared or Private.</h1>
            <p>Affordable, safe, and community-driven auto rickshaw rides tailored for students, professionals, and daily commuters.</p>
            <div class="auth-features">
              <div class="auth-feature">
                <div class="auth-feature-icon"><i class="fas fa-user-friends"></i></div>
                <span>Gender-matched options for shared rides</span>
              </div>
              <div class="auth-feature">
                <div class="auth-feature-icon"><i class="fas fa-shield-alt"></i></div>
                <span>Verified driver partners & vehicle onboarding</span>
              </div>
              <div class="auth-feature">
                <div class="auth-feature-icon"><i class="fas fa-wallet"></i></div>
                <span>Seamless cash & secure wallet payments</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Right Form Panel -->
        <div class="auth-form-panel">
          <div class="auth-form-container">
            <div class="auth-card">
              <h2 class="auth-card-title">Welcome Back</h2>
              <p class="auth-card-subtitle">Log in to continue your journey</p>
              
              <form id="login-form">
                <div class="form-group">
                  <label class="form-label" for="login-email">Email Address</label>
                  <input type="email" id="login-email" class="form-control" placeholder="name@domain.com" required>
                </div>
                
                <div class="form-group">
                  <label class="form-label" for="login-password">Password</label>
                  <input type="password" id="login-password" class="form-control" placeholder="••••••••" required>
                </div>
                
                <button type="submit" class="btn btn-primary btn-block" style="width: 100%; margin-top: 16px;">
                  <span>Log In</span> <i class="fas fa-arrow-right"></i>
                </button>
              </form>
              
              <div class="auth-divider">or</div>
              
              <div class="auth-link">
                Don't have an account? <a href="#/signup">Sign Up</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Wire up events
    const form = document.getElementById('login-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value;
      const password = document.getElementById('login-password').value;

      try {
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i> Logging in...`;

        const res = await API.post('/api/auth/login', { email, password });
        
        API.setToken(res.token);
        API.setRefreshToken(res.refreshToken);
        API.setUser(res.user);

        app.currentUser = res.user;
        
        // Fetch full profile (e.g. driver details)
        await app.fetchUserProfile();

        WS.connect();

        app.showToast('Welcome back, ' + res.user.full_name + '!', 'success');
        app.redirectHomeByRole();
      } catch (err) {
        app.showToast(err.error || 'Login failed. Please check credentials.', 'error');
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = false;
        btn.innerHTML = `<span>Log In</span> <i class="fas fa-arrow-right"></i>`;
      }
    });
  },

  renderSignup(container) {
    let selectedRole = 'passenger';
    let selectedGender = 'other';

    container.innerHTML = `
      <div class="auth-page">
        <!-- Left Hero Panel -->
        <div class="auth-hero">
          <div class="auth-hero-content">
            <div class="auth-brand">
              <div class="auth-brand-icon">
                <i class="fas fa-route"></i>
              </div>
              <span class="auth-brand-name">ShareAuto</span>
            </div>
            <h1>Join the smart auto rickshaw revolution.</h1>
            <p>Save money, reduce emissions, and ride safely. Create your driver partner or passenger account in under 2 minutes.</p>
            <div class="auth-features">
              <div class="auth-feature">
                <div class="auth-feature-icon"><i class="fas fa-percentage"></i></div>
                <span>Up to 50% discount with shared autos</span>
              </div>
              <div class="auth-feature">
                <div class="auth-feature-icon"><i class="fas fa-star"></i></div>
                <span>Rated and background verified local drivers</span>
              </div>
              <div class="auth-feature">
                <div class="auth-feature-icon"><i class="fas fa-map-pin"></i></div>
                <span>Realtime tracking & automated fare split</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Right Form Panel -->
        <div class="auth-form-panel">
          <div class="auth-form-container">
            <div class="auth-card">
              <h2 class="auth-card-title">Get Started</h2>
              <p class="auth-card-subtitle">Create your ShareAuto account today</p>
              
              <div class="role-selector">
                <div class="role-option selected" data-role="passenger" id="role-passenger">
                  <div class="role-option-icon"><i class="fas fa-user"></i></div>
                  <div class="role-option-label">Passenger</div>
                  <div class="role-option-desc">Need a ride</div>
                </div>
                <div class="role-option" data-role="driver" id="role-driver">
                  <div class="role-option-icon"><i class="fas fa-taxi"></i></div>
                  <div class="role-option-label">Driver</div>
                  <div class="role-option-desc">Want to earn</div>
                </div>
              </div>

              <form id="signup-form">
                <div class="form-group">
                  <label class="form-label" for="signup-name">Full Name</label>
                  <input type="text" id="signup-name" class="form-control" placeholder="John Doe" required>
                </div>

                <div class="form-group">
                  <label class="form-label" for="signup-email">Email Address</label>
                  <input type="email" id="signup-email" class="form-control" placeholder="name@domain.com" required>
                </div>

                <div class="grid grid-2" style="gap: 12px; margin-bottom: 0;">
                  <div class="form-group">
                    <label class="form-label" for="signup-phone">Phone Number</label>
                    <input type="tel" id="signup-phone" class="form-control" placeholder="9876543210" pattern="[6-9][0-9]{9}" required>
                  </div>
                  <div class="form-group">
                    <label class="form-label">Gender</label>
                    <div class="gender-selector">
                      <div class="gender-option" data-gender="male">Male</div>
                      <div class="gender-option" data-gender="female">Female</div>
                      <div class="gender-option selected" data-gender="other">Other</div>
                    </div>
                  </div>
                </div>

                <div class="form-group">
                  <label class="form-label" for="signup-password">Password</label>
                  <input type="password" id="signup-password" class="form-control" placeholder="Min. 6 chars (1 letter & 1 digit)" required>
                </div>

                <button type="submit" class="btn btn-primary btn-block" style="width: 100%; margin-top: 16px;">
                  <span>Create Account</span> <i class="fas fa-user-plus"></i>
                </button>
              </form>
              
              <div class="auth-divider">or</div>
              
              <div class="auth-link">
                Already have an account? <a href="#/login">Log In</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Role selector interaction
    const passengerOpt = document.getElementById('role-passenger');
    const driverOpt = document.getElementById('role-driver');
    
    passengerOpt.onclick = () => {
      selectedRole = 'passenger';
      passengerOpt.classList.add('selected');
      driverOpt.classList.remove('selected');
    };

    driverOpt.onclick = () => {
      selectedRole = 'driver';
      driverOpt.classList.add('selected');
      passengerOpt.classList.remove('selected');
    };

    // Gender selector interaction
    const genderOpts = container.querySelectorAll('.gender-option');
    genderOpts.forEach(opt => {
      opt.onclick = () => {
        genderOpts.forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        selectedGender = opt.getAttribute('data-gender');
      };
    });

    // Submit handler
    const form = document.getElementById('signup-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const fullName = document.getElementById('signup-name').value;
      const email = document.getElementById('signup-email').value;
      const phone = document.getElementById('signup-phone').value;
      const password = document.getElementById('signup-password').value;

      try {
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i> Creating...`;

        const res = await API.post('/api/auth/signup', {
          fullName,
          email,
          phone,
          password,
          role: selectedRole,
          gender: selectedGender
        });

        API.setToken(res.token);
        API.setRefreshToken(res.refreshToken);
        API.setUser(res.user);

        app.currentUser = res.user;

        // Fetch full profile (e.g. driver details)
        await app.fetchUserProfile();

        WS.connect();

        app.showToast('Account registered successfully!', 'success');
        app.redirectHomeByRole();
      } catch (err) {
        app.showToast(err.error || 'Signup failed. Please try again.', 'error');
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = false;
        btn.innerHTML = `<span>Create Account</span> <i class="fas fa-user-plus"></i>`;
      }
    });
  }
};
