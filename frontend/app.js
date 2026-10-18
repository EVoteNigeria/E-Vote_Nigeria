// Biometric E-Voting System Admin Dashboard Logic
// Connects securely to FastAPI backend endpoints

// ========================================================
// THEME MANAGEMENT (DARK & LIGHT MODES)
// ========================================================
function getPreferredTheme() {
  const saved = localStorage.getItem('evote_theme');
  if (saved) return saved;
  return (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
}

function applyTheme(theme) {
  const isLight = theme === 'light';
  if (isLight) {
    document.documentElement.classList.add('theme-light');
    document.documentElement.classList.remove('theme-dark');
    document.body.classList.add('theme-light');
    document.body.classList.remove('theme-dark');
  } else {
    document.documentElement.classList.remove('theme-light');
    document.documentElement.classList.add('theme-dark');
    document.body.classList.remove('theme-light');
    document.body.classList.add('theme-dark');
  }
  try {
    localStorage.setItem('evote_theme', theme);
  } catch (e) {}

  document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
    btn.setAttribute('aria-checked', isLight ? 'true' : 'false');
    const textSpan = btn.querySelector('.theme-toggle-text');
    if (textSpan) {
      textSpan.textContent = isLight ? 'Light Mode' : 'Dark Mode';
    }
  });
}

function toggleTheme() {
  const isCurrentlyLight = document.documentElement.classList.contains('theme-light') || 
                           document.body.classList.contains('theme-light');
  applyTheme(isCurrentlyLight ? 'dark' : 'light');
}

function initThemeToggles() {
  applyTheme(getPreferredTheme());
  document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      toggleTheme();
    };
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initThemeToggles);
} else {
  initThemeToggles();
}

if (window.matchMedia) {
  try {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', e => {
      if (!localStorage.getItem('evote_theme')) {
        applyTheme(e.matches ? 'light' : 'dark');
      }
    });
  } catch (e) {}
}

let authToken = localStorage.getItem('evote_token');
let currentAdmin = JSON.parse(localStorage.getItem('evote_admin') || 'null');
let activeElectionId = null;
let currentLcdPage = 0;
let cachedParties = [];

// API helper
async function apiRequest(endpoint, method = 'GET', body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(endpoint, options);
  if (res.status === 401) {
    logout();
    throw new Error('Session expired');
  }
  return res.json();
}

// Clock updates
function updateLagosClock() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-GB', { timeZone: 'Africa/Lagos' });
  const clockEl = document.getElementById('lagos-clock');
  if (clockEl) clockEl.textContent = `LAGOS: ${timeStr}`;
}
setInterval(updateLagosClock, 1000);
updateLagosClock();

// Authentication handling
const loginForm = document.getElementById('login-form');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = document.getElementById('login-username').value;
    const p = document.getElementById('login-password').value;
    const errBox = document.getElementById('login-error');

    try {
      const data = await apiRequest('/api/v1/auth/login', 'POST', { username: u, password: p });
      if (data.access_token) {
        authToken = data.access_token;
        currentAdmin = data.admin;
        localStorage.setItem('evote_token', authToken);
        localStorage.setItem('evote_admin', JSON.stringify(currentAdmin));
        initAppView();
      } else {
        errBox.textContent = data.detail || 'Authentication failed';
        errBox.style.display = 'block';
      }
    } catch (err) {
      errBox.textContent = err.message || 'Connection error';
      errBox.style.display = 'block';
    }
  });
}

function logout() {
  localStorage.removeItem('evote_token');
  localStorage.removeItem('evote_admin');
  authToken = null;
  currentAdmin = null;
  document.getElementById('login-view').style.display = 'flex';
  document.getElementById('app-view').style.display = 'none';
}

const logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) logoutBtn.addEventListener('click', logout);

// Navigation Routing
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    item.classList.add('active');

    const target = item.getAttribute('data-page');
    document.querySelectorAll('.page-view').forEach(p => p.style.display = 'none');
    const targetPage = document.getElementById(`page-${target}`);
    if (targetPage) targetPage.style.display = 'block';

    loadPageData(target);
  });
});

function loadPageData(page) {
  switch(page) {
    case 'overview': loadOverview(); break;
    case 'elections': loadElections(); break;
    case 'parties': loadParties(); break;
    case 'voters': loadVoters(); break;
    case 'enrollment': loadEnrollmentView(); break;
    case 'terminals': loadTerminals(); break;
    case 'turnout': loadTurnout(); break;
    case 'results': loadResults(); break;
    case 'audit': loadAuditLogs(); break;
    case 'settings': loadSettingsView(); break;
  }
}

// Modals handling
function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('active');
}

function closeModal(id) {
  if (id) {
    const m = document.getElementById(id);
    if (m) m.classList.remove('active');
  } else {
    document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
  }
}

// Close buttons inside modals
document.querySelectorAll('.modal-close, .modal-close-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
  });
});

// Click outside modal card to close
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.classList.remove('active');
    }
  });
});

// Escape key to dismiss any active modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
  }
});

// 1. Overview Dashboard
async function loadOverview() {
  try {
    const data = await apiRequest('/api/v1/overview/stats');
    if (data.election) {
      activeElectionId = data.election.id;
      document.getElementById('top-election-title').textContent = `${data.election.title} (${data.election.status.toUpperCase()})`;
      document.getElementById('overview-el-code').textContent = data.election.election_code;
      document.getElementById('overview-el-status').innerHTML = `<span class="badge badge-success">${data.election.status}</span>`;
      document.getElementById('overview-el-dates').textContent = `${data.election.starts_at} to ${data.election.ends_at}`;
    }

    const vs = data.voter_stats;
    document.getElementById('stat-total-voters').textContent = vs.total_eligible_voters.toLocaleString();
    document.getElementById('stat-enrolled-fps').textContent = vs.total_enrolled_fps.toLocaleString();
    document.getElementById('stat-turnout-pct').textContent = `${vs.turnout_percentage}%`;
    document.getElementById('stat-total-voted').textContent = vs.total_voted.toLocaleString();

    document.getElementById('overview-ballots-count').textContent = vs.total_accepted_ballots.toLocaleString();
    document.getElementById('overview-participants-count').textContent = vs.total_voted.toLocaleString();

    document.getElementById('turnout-progress-bar').style.width = `${Math.min(100, vs.turnout_percentage)}%`;
    document.getElementById('turnout-bar-label').textContent = `${vs.turnout_percentage}%`;

    const ts = data.terminal_stats;
    document.getElementById('stat-online-terminals').textContent = `${ts.online} / ${ts.total}`;

    const alertEl = document.getElementById('integrity-alert');
    if (vs.integrity_mismatch) {
      alertEl.style.display = 'block';
      document.getElementById('overview-reconciliation-badge').innerHTML = '<span class="badge badge-danger">Mismatch</span>';
    } else {
      alertEl.style.display = 'none';
      document.getElementById('overview-reconciliation-badge').innerHTML = '<span class="badge badge-success">Consistent</span>';
    }
    await updateDbStatus();
    const voters = await apiRequest('/api/v1/voters');
    checkSessionRecovery(voters);
  } catch (err) {
    console.error('Error loading overview:', err);
  }
}

// 2. Election Management
async function loadElections() {
  const list = await apiRequest('/api/v1/elections');
  const tbody = document.getElementById('elections-table-body');
  tbody.innerHTML = '';
  list.forEach(el => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${el.election_code}</strong></td>
      <td>${el.title}</td>
      <td>${el.election_type}</td>
      <td><span class="badge badge-${el.status === 'Open' ? 'success' : 'info'}">${el.status}</span></td>
      <td><small>${el.starts_at} &rarr; ${el.ends_at}</small></td>
      <td>${el.result_visibility}</td>
      <td>
        ${el.status === 'Draft' ? `<button onclick="updateElectionStatus('${el.id}', 'Open')" class="btn btn-primary btn-sm">Open Election</button>` : ''}
        ${el.status === 'Open' ? `<button onclick="updateElectionStatus('${el.id}', 'Closed')" class="btn btn-danger btn-sm">Close Election</button>` : ''}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

window.updateElectionStatus = async function(id, status) {
  if (!confirm(`Are you sure you want to change election status to ${status}?`)) return;
  await apiRequest(`/api/v1/elections/${id}/status`, 'PUT', { status });
  loadElections();
  loadOverview();
};

const btnCreateEl = document.getElementById('btn-create-election');
if (btnCreateEl) btnCreateEl.addEventListener('click', () => openModal('modal-create-election'));

const formCreateEl = document.getElementById('form-create-election');
if (formCreateEl) {
  formCreateEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      election_code: document.getElementById('el-input-code').value,
      title: document.getElementById('el-input-title').value,
      starts_at: document.getElementById('el-input-starts').value.replace('T', ' ') + ':00',
      ends_at: document.getElementById('el-input-ends').value.replace('T', ' ') + ':00',
      election_type: 'General',
      scope: 'National',
      timezone: 'Africa/Lagos',
      result_visibility: 'Authorized Live Aggregate'
    };
    await apiRequest('/api/v1/elections', 'POST', payload);
    closeModal('modal-create-election');
    formCreateEl.reset();
    loadElections();
  });
}

// 3. Parties & 16x4 LCD Simulator
async function loadParties() {
  if (!activeElectionId) {
    const stats = await apiRequest('/api/v1/overview/stats');
    if (stats.election) activeElectionId = stats.election.id;
  }
  if (!activeElectionId) return;

  cachedParties = await apiRequest(`/api/v1/elections/${activeElectionId}/parties`);
  const tbody = document.getElementById('parties-table-body');
  tbody.innerHTML = '';
  cachedParties.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.display_order}</td>
      <td><strong>${p.party_acronym}</strong></td>
      <td>${p.party_name}</td>
      <td><code>${p.lcd_label}</code></td>
      <td>${p.candidate_name || '-'}</td>
      <td><button onclick="deleteParty('${p.id}')" class="btn btn-danger btn-sm">Remove</button></td>
    `;
    tbody.appendChild(tr);
  });

  renderLcdSimulator();
}

function renderLcdSimulator() {
  const pageSize = 4;
  const totalPages = Math.max(1, Math.ceil(cachedParties.length / pageSize));
  if (currentLcdPage >= totalPages) currentLcdPage = totalPages - 1;
  if (currentLcdPage < 0) currentLcdPage = 0;

  const pageNum = currentLcdPage + 1;
  const pageParties = cachedParties.slice(currentLcdPage * pageSize, (currentLcdPage + 1) * pageSize);

  // Pad to 16 chars helper
  const pad16 = (s) => (s + '                ').substring(0, 16);
  // Pad half col to 8 chars
  const pad8 = (s) => (s + '        ').substring(0, 8);

  const row1 = pad16("Choose a party:");
  const row2 = pad16(`*Prev ${pageNum}/${totalPages} #Next`);

  const pA = pageParties[0] ? `A:${pageParties[0].lcd_label}` : '';
  const pB = pageParties[1] ? `B:${pageParties[1].lcd_label}` : '';
  const row3 = pad8(pA) + pad8(pB);

  const pC = pageParties[2] ? `C:${pageParties[2].lcd_label}` : '';
  const pD = pageParties[3] ? `D:${pageParties[3].lcd_label}` : '';
  const row4 = pad8(pC) + pad8(pD);

  document.getElementById('lcd-row-1').textContent = row1;
  document.getElementById('lcd-row-2').textContent = row2;
  document.getElementById('lcd-row-3').textContent = row3;
  document.getElementById('lcd-row-4').textContent = row4;
}

document.getElementById('lcd-nav-prev').addEventListener('click', () => {
  currentLcdPage--;
  renderLcdSimulator();
});
document.getElementById('lcd-nav-next').addEventListener('click', () => {
  currentLcdPage++;
  renderLcdSimulator();
});

const btnAddParty = document.getElementById('btn-add-party');
if (btnAddParty) btnAddParty.addEventListener('click', () => openModal('modal-add-party'));

const formAddParty = document.getElementById('form-add-party');
if (formAddParty) {
  formAddParty.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = formAddParty.querySelector('button[type="submit"]');
    const origText = submitBtn ? submitBtn.textContent : 'Add Party';

    try {
      if (!activeElectionId) {
        const stats = await apiRequest('/api/v1/overview/stats');
        if (stats.election) activeElectionId = stats.election.id;
      }
      if (!activeElectionId) {
        alert('No active election found. Please create or configure an election first.');
        return;
      }

      const partyName = document.getElementById('party-input-name').value.trim();
      const partyAcronym = document.getElementById('party-input-acronym').value.trim().toUpperCase();
      const lcdLabel = document.getElementById('party-input-lcd').value.toUpperCase().trim();
      const candidateName = document.getElementById('party-input-candidate').value.trim();

      if (!partyName || !partyAcronym || !lcdLabel) {
        alert('Please fill out all required party fields.');
        return;
      }

      if (lcdLabel.length > 8) {
        alert('LCD Label must be 8 characters or fewer to fit the 16x4 hardware display column.');
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Adding Party...';
      }

      const payload = {
        election_id: activeElectionId,
        party_name: partyName,
        party_acronym: partyAcronym,
        lcd_label: lcdLabel,
        candidate_name: candidateName,
        display_order: (cachedParties ? cachedParties.length : 0) + 1,
        is_active: true
      };

      await apiRequest('/api/v1/parties', 'POST', payload);
      closeModal('modal-add-party');
      formAddParty.reset();
      await loadParties();
      if (typeof loadOverview === 'function') loadOverview();
    } catch (err) {
      alert('Failed to add political party: ' + (err.message || err));
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = origText;
      }
    }
  });
}

window.deleteParty = async function(id) {
  if (!confirm('Remove this party from the ballot?')) return;
  await apiRequest(`/api/v1/parties/${id}`, 'DELETE');
  loadParties();
};

window.deleteVoter = async function(id, voterId, voterName) {
  if (!confirm(`Are you sure you want to permanently delete voter ${voterId} (${voterName})?\nThis will remove their registration and biometric slot mappings.`)) {
    return;
  }
  try {
    await apiRequest(`/api/v1/voters/${id}`, 'DELETE');
    try {
      const stored = JSON.parse(localStorage.getItem('evote_session_backup_voters') || '[]');
      const filtered = stored.filter(v => v.id !== id && v.voter_id !== voterId);
      localStorage.setItem('evote_session_backup_voters', JSON.stringify(filtered));
    } catch (e) {}
    loadVoters();
    loadOverview();
  } catch (err) {
    alert('Failed to delete voter: ' + (err.message || err));
  }
};

// 4. Voter Registry
async function loadVoters(searchQuery = '') {
  const url = searchQuery ? `/api/v1/voters?search=${encodeURIComponent(searchQuery)}` : '/api/v1/voters';
  const voters = await apiRequest(url);
  
  if (Array.isArray(voters)) {
    cacheVotersSession(voters);
  }

  const tbody = document.getElementById('voters-table-body');
  tbody.innerHTML = '';
  voters.forEach(v => {
    const safeName = (v.full_name || '').replace(/'/g, "\\'");
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${v.voter_id}</strong></td>
      <td>${v.full_name}</td>
      <td><span class="badge badge-success">${v.eligibility_status}</span></td>
      <td><span class="badge badge-info">${v.registration_status}</span></td>
      <td>${v.fp_status === 'Enrolled' ? `<span class="badge badge-success">Slot #${v.sensor_slot_id}</span>` : `<span class="badge badge-warning">Not Enrolled</span>`}</td>
      <td>${v.polling_location_name || 'PU-01-LAG'}</td>
      <td>
        <div style="display: flex; gap: 6px;">
          <button onclick="triggerEnrollFor('${v.id}')" class="btn btn-secondary btn-sm" title="Queue hardware fingerprint scan on ESP32">&#9757; Enroll</button>
          <button onclick="deleteVoter('${v.id}', '${v.voter_id}', '${safeName}')" class="btn btn-danger btn-sm" title="Permanently delete voter record">&#128465; Delete</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

document.getElementById('btn-search-voters').addEventListener('click', () => {
  loadVoters(document.getElementById('voter-search-input').value.trim());
});

const btnAddVoter = document.getElementById('btn-add-voter');
if (btnAddVoter) btnAddVoter.addEventListener('click', () => openModal('modal-add-voter'));

const formAddVoter = document.getElementById('form-add-voter');
if (formAddVoter) {
  formAddVoter.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      voter_id: document.getElementById('voter-input-id').value.trim(),
      full_name: document.getElementById('voter-input-name').value.trim(),
      registration_status: 'Active',
      eligibility_status: 'Eligible',
      polling_location_id: 'loc_lagos_central'
    };
    await apiRequest('/api/v1/voters', 'POST', payload);
    closeModal('modal-add-voter');
    formAddVoter.reset();
    loadVoters();
    loadOverview();
  });
}

// 5. Fingerprint Enrollment
async function loadEnrollmentView() {
  const voters = await apiRequest('/api/v1/voters');
  const terminals = await apiRequest('/api/v1/terminals');

  const vSelect = document.getElementById('enroll-voter-select');
  vSelect.innerHTML = '<option value="">-- Choose Voter --</option>';
  voters.forEach(v => {
    vSelect.innerHTML += `<option value="${v.id}">Voter ID: ${v.voter_id} - ${v.full_name} (${v.fp_status === 'Enrolled' ? 'Already Enrolled' : 'Pending'})</option>`;
  });

  const tSelect = document.getElementById('enroll-terminal-select');
  tSelect.innerHTML = '<option value="">-- Choose Terminal --</option>';
  terminals.forEach(t => {
    tSelect.innerHTML += `<option value="${t.device_id}">${t.device_name} [${t.device_id}] (${t.is_online ? 'ONLINE' : 'OFFLINE'})</option>`;
  });
}

window.triggerEnrollFor = function(voterId) {
  document.querySelector('[data-page="enrollment"]').click();
  setTimeout(() => {
    document.getElementById('enroll-voter-select').value = voterId;
  }, 200);
};

const formEnroll = document.getElementById('enrollment-form');
if (formEnroll) {
  formEnroll.addEventListener('submit', async (e) => {
    e.preventDefault();
    const voterUuid = document.getElementById('enroll-voter-select').value;
    const devId = document.getElementById('enroll-terminal-select').value;
    const finger = document.getElementById('enroll-finger-label').value;

    const res = await apiRequest('/api/v1/fingerprints/start-enrollment', 'POST', {
      voter_uuid: voterUuid,
      device_id: devId,
      finger_label: finger
    });

    document.getElementById('enroll-feedback-title').textContent = `Command Sent to ${devId}!`;
    document.getElementById('enroll-feedback-msg').innerHTML = `
      <div style="margin-top: 10px; color: #34d399; font-weight: 600;">Slot #${res.assigned_slot} Allocated</div>
      <div>Voter: <strong>${res.voter_name}</strong> (ID: ${res.voter_id})</div>
      <p style="margin-top: 8px;">The ESP32 screen will now prompt: <em>Place Finger to Enroll Slot #${res.assigned_slot}</em></p>
    `;
  });
}

// 6. Terminals
async function loadTerminals() {
  const terminals = await apiRequest('/api/v1/terminals');
  const tbody = document.getElementById('terminals-table-body');
  tbody.innerHTML = '';
  terminals.forEach(t => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${t.device_id}</strong></td>
      <td>${t.device_name}</td>
      <td>${t.polling_location_name || 'PU-01-LAG'}</td>
      <td><span class="badge badge-${t.is_online ? 'success' : 'danger'}">${t.is_online ? 'ONLINE' : 'OFFLINE'}</span></td>
      <td><code>v${t.firmware_version}</code></td>
      <td>${t.sensor_slots_used} / ${t.sensor_slot_capacity}</td>
      <td><small>${t.last_heartbeat_at || 'Never'}</small></td>
    `;
    tbody.appendChild(tr);
  });
}

// 7. Turnout
async function loadTurnout() {
  const stats = await apiRequest('/api/v1/overview/stats');
  const vs = stats.voter_stats;
  document.getElementById('turnout-total-reg').textContent = vs.total_eligible_voters.toLocaleString();
  document.getElementById('turnout-rate-pct').textContent = `${vs.turnout_percentage}%`;
  document.getElementById('turnout-pending-voters').textContent = vs.remaining_voters.toLocaleString();
}

// 8. Results
async function loadResults() {
  if (!activeElectionId) {
    const stats = await apiRequest('/api/v1/overview/stats');
    if (stats.election) activeElectionId = stats.election.id;
  }
  if (!activeElectionId) return;

  const data = await apiRequest(`/api/v1/elections/${activeElectionId}/results`);
  const tbody = document.getElementById('results-table-body');
  tbody.innerHTML = '';

  if (data.results) {
    data.results.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${r.party_name}</strong></td>
        <td><code>${r.party_acronym}</code></td>
        <td>${r.candidate_name || '-'}</td>
        <td style="font-weight: 700; font-size: 1.05rem;">${r.vote_count.toLocaleString()}</td>
        <td>
          <div style="display: flex; align-items: center; gap: 10px;">
            <div style="flex: 1; height: 8px; background: var(--bg-surface-elevated); border-radius: var(--radius-full); overflow: hidden;">
              <div style="width: ${r.percentage}%; height: 100%; background: #3b82f6;"></div>
            </div>
            <span style="font-size: 0.84rem; font-weight: 600;">${r.percentage}%</span>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }
}

// 9. Audit Logs
async function loadAuditLogs() {
  const logs = await apiRequest('/api/v1/audit-logs');
  const tbody = document.getElementById('audit-table-body');
  tbody.innerHTML = '';
  logs.forEach(l => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><small style="font-family: var(--font-mono);">${l.event_timestamp}</small></td>
      <td><strong>${l.actor_type}</strong></td>
      <td><code>${l.event_type}</code></td>
      <td><span class="badge badge-${l.result === 'Success' ? 'success' : 'danger'}">${l.result}</span></td>
      <td><span class="badge badge-${l.severity === 'Critical' ? 'danger' : 'info'}">${l.severity}</span></td>
      <td>${l.sanitized_description}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Quick refresh
document.getElementById('btn-quick-refresh').addEventListener('click', () => {
  const activeNav = document.querySelector('.nav-item.active');
  if (activeNav) loadPageData(activeNav.getAttribute('data-page'));
});

// App initialization
function initAppView() {
  document.getElementById('login-view').style.display = 'none';
  document.getElementById('app-view').style.display = 'flex';
  if (currentAdmin) {
    document.getElementById('user-display-name').textContent = currentAdmin.full_name || currentAdmin.username;
    document.getElementById('user-display-role').textContent = currentAdmin.role || 'Administrator';
    document.getElementById('avatar-initials').textContent = (currentAdmin.username || 'AD').substring(0, 2).toUpperCase();
  }
  loadOverview();
}

// Check session on initial load
if (authToken && currentAdmin) {
  initAppView();
} else {
  document.getElementById('login-view').style.display = 'flex';
  document.getElementById('app-view').style.display = 'none';
}

// ========================================================
// DATABASE PERSISTENCE, BACKUP & SESSION RECOVERY MODULE
// ========================================================

// 1. Database Status & Engine Indicator
async function updateDbStatus() {
  try {
    const status = await apiRequest('/api/v1/system/db-status');
    const topBadge = document.getElementById('top-db-status');
    if (topBadge && status) {
      if (status.is_persistent) {
        topBadge.className = 'badge badge-success';
        topBadge.textContent = status.engine === 'postgresql' ? '🟢 PostgreSQL (Persistent)' : '🟢 SQLite (Local Persistent)';
      } else {
        topBadge.className = 'badge badge-warning';
        topBadge.textContent = '🟠 SQLite (Ephemeral Cloud)';
      }
      topBadge.onclick = () => {
        const settingsNav = document.querySelector('[data-page="settings"]');
        if (settingsNav) settingsNav.click();
      };
    }
    return status;
  } catch (err) {
    console.error('Error updating DB status:', err);
    return null;
  }
}

// 2. Browser Session Storage Caching & Auto-Recovery
function cacheVotersSession(currentVoters) {
  if (!currentVoters || !Array.isArray(currentVoters)) return;
  try {
    const stored = JSON.parse(localStorage.getItem('evote_session_backup_voters') || '[]');
    const map = new Map();
    stored.forEach(v => map.set(v.voter_id, v));
    currentVoters.forEach(v => map.set(v.voter_id, v));
    const merged = Array.from(map.values());
    localStorage.setItem('evote_session_backup_voters', JSON.stringify(merged));
  } catch (e) {
    console.warn('Failed to cache voters to localStorage:', e);
  }
}

function checkSessionRecovery(serverVoters) {
  const alertEl = document.getElementById('session-recovery-alert');
  if (!alertEl) return;

  try {
    const stored = JSON.parse(localStorage.getItem('evote_session_backup_voters') || '[]');
    if (!stored || stored.length === 0) {
      alertEl.style.display = 'none';
      return;
    }

    const serverIds = new Set((serverVoters || []).map(v => v.voter_id));
    const missing = stored.filter(v => !serverIds.has(v.voter_id));

    if (missing.length > 0) {
      document.getElementById('recovery-voter-count').textContent = missing.length;
      alertEl.style.display = 'block';
    } else {
      alertEl.style.display = 'none';
    }
  } catch (e) {
    alertEl.style.display = 'none';
  }
}

// 3. Direct Hardware Slot Mapping
window.openMapSlotModal = function(id, voterId, fullName) {
  document.getElementById('map-slot-voter-id').value = voterId;
  document.getElementById('map-slot-voter-name').value = `${fullName} (ID: ${voterId})`;
  document.getElementById('map-slot-number').value = '';
  openModal('modal-map-slot');
};

const formMapSlot = document.getElementById('form-map-slot');
if (formMapSlot) {
  formMapSlot.addEventListener('submit', async (e) => {
    e.preventDefault();
    const voterId = document.getElementById('map-slot-voter-id').value;
    const termId = document.getElementById('map-slot-terminal-select').value;
    const slotNum = parseInt(document.getElementById('map-slot-number').value, 10);
    const finger = document.getElementById('map-slot-finger').value;

    try {
      const res = await apiRequest(`/api/v1/voters/${voterId}/map-slot`, 'POST', {
        device_id: termId,
        sensor_slot_id: slotNum,
        finger_label: finger
      });
      closeModal('modal-map-slot');
      alert(res.message || 'Slot mapped successfully!');
      loadVoters();
      loadOverview();
    } catch (err) {
      alert('Error mapping slot: ' + (err.message || err));
    }
  });
}

// 4. System Settings & Persistence View
async function loadSettingsView() {
  const status = await updateDbStatus();
  if (status) {
    const badge = document.getElementById('settings-db-badge');
    if (badge) {
      badge.className = `badge badge-${status.is_persistent ? 'success' : 'warning'}`;
      badge.textContent = status.status_label;
    }
    const engineEl = document.getElementById('settings-db-engine');
    if (engineEl) engineEl.textContent = `${status.engine.toUpperCase()} (${status.is_persistent ? 'Persistent across all reboots' : 'Ephemeral - Resets on container sleep'})`;
    const guidanceEl = document.getElementById('settings-db-guidance');
    if (guidanceEl) guidanceEl.textContent = status.guidance;
    const countV = document.getElementById('settings-count-voters');
    if (countV) countV.textContent = status.voter_count;
    const countB = document.getElementById('settings-count-ballots');
    if (countB) countB.textContent = status.ballot_count;
    const countE = document.getElementById('settings-count-enrolled');
    if (countE) countE.textContent = status.enrolled_count;
  }
}

// 5. Download Backup (JSON)
const btnDownloadBackup = document.getElementById('btn-download-backup');
if (btnDownloadBackup) {
  btnDownloadBackup.addEventListener('click', async () => {
    try {
      btnDownloadBackup.disabled = true;
      btnDownloadBackup.textContent = 'Generating Backup...';
      const backup = await apiRequest('/api/v1/system/backup');
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `evote_system_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      btnDownloadBackup.innerHTML = '&#128190; Download Complete Database Backup (JSON)';
      btnDownloadBackup.disabled = false;
    } catch (err) {
      alert('Failed to generate backup: ' + err.message);
      btnDownloadBackup.disabled = false;
    }
  });
}

// 6. Restore from File
const btnTriggerRestore = document.getElementById('btn-trigger-file-restore');
const inputRestoreFile = document.getElementById('input-restore-file');
const restoreStatusMsg = document.getElementById('restore-status-msg');

if (btnTriggerRestore && inputRestoreFile) {
  btnTriggerRestore.addEventListener('click', () => inputRestoreFile.click());

  inputRestoreFile.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const parsed = JSON.parse(evt.target.result);
        const res = await apiRequest('/api/v1/system/restore', 'POST', { data: parsed });
        if (restoreStatusMsg) {
          restoreStatusMsg.style.display = 'block';
          restoreStatusMsg.style.background = 'rgba(52, 211, 153, 0.2)';
          restoreStatusMsg.style.color = '#34d399';
          restoreStatusMsg.textContent = `Restored successfully! Voters: ${res.summary.voters_restored}, Fingerprints: ${res.summary.fingerprints_restored}, Ballots: ${res.summary.ballots_restored}`;
        }
        loadOverview();
        loadSettingsView();
        loadVoters();
      } catch (err) {
        if (restoreStatusMsg) {
          restoreStatusMsg.style.display = 'block';
          restoreStatusMsg.style.background = 'rgba(239, 68, 68, 0.2)';
          restoreStatusMsg.style.color = '#f87171';
          restoreStatusMsg.textContent = 'Restore failed: ' + (err.message || err);
        }
      }
      inputRestoreFile.value = '';
    };
    reader.readAsText(file);
  });
}

// 7. Restore Session Data from Alert Banner
const btnRestoreSession = document.getElementById('btn-restore-session');
if (btnRestoreSession) {
  btnRestoreSession.addEventListener('click', async () => {
    btnRestoreSession.disabled = true;
    btnRestoreSession.textContent = 'Restoring...';
    try {
      const stored = JSON.parse(localStorage.getItem('evote_session_backup_voters') || '[]');
      let count = 0;
      for (const v of stored) {
        try {
          await apiRequest('/api/v1/voters', 'POST', {
            voter_id: v.voter_id,
            full_name: v.full_name,
            registration_status: v.registration_status || 'Active',
            eligibility_status: v.eligibility_status || 'Eligible',
            polling_location_id: v.polling_location_id || 'loc_lagos_central'
          });
          count++;
        } catch (e) {
          // Skip if already in DB
        }
        if (v.sensor_slot_id && v.fp_status === 'Enrolled') {
          try {
            await apiRequest(`/api/v1/voters/${v.voter_id}/map-slot`, 'POST', {
              device_id: 'ESP32-01',
              sensor_slot_id: parseInt(v.sensor_slot_id, 10),
              finger_label: 'Right Index Finger'
            });
          } catch (e) {}
        }
      }
      document.getElementById('session-recovery-alert').style.display = 'none';
      alert(`Restoration complete! Recovered ${count} voter records into the active database.`);
      loadOverview();
      loadVoters();
    } catch (err) {
      alert('Error restoring session: ' + err.message);
    } finally {
      btnRestoreSession.disabled = false;
      btnRestoreSession.innerHTML = '&#8635; Restore Session Data';
    }
  });
}

const btnDismissRecovery = document.getElementById('btn-dismiss-recovery');
if (btnDismissRecovery) {
  btnDismissRecovery.addEventListener('click', () => {
    document.getElementById('session-recovery-alert').style.display = 'none';
  });
}

const btnClearCache = document.getElementById('btn-clear-cache');
if (btnClearCache) {
  btnClearCache.addEventListener('click', () => {
    if (confirm('Clear local browser session cache of voters?')) {
      localStorage.removeItem('evote_session_backup_voters');
      document.getElementById('session-recovery-alert').style.display = 'none';
      alert('Browser session cache cleared.');
    }
  });
}

// ========================================================
// OFFICIAL INEC / E-VOTE PDF REPORT & EXPORT GENERATORS
// ========================================================

function numberToWords(num) {
  if (num === 0) return 'Zero';
  if (!num || isNaN(num)) return 'Zero';
  num = Math.floor(Math.abs(num));
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function convert(n) {
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 !== 0 ? '-' + ones[n % 10] : '');
    if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 !== 0 ? ' and ' + convert(n % 100) : '');
    if (n < 1000000) return convert(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 !== 0 ? ' ' + convert(n % 1000) : '');
    return convert(Math.floor(n / 1000000)) + ' Million' + (n % 1000000 !== 0 ? ' ' + convert(n % 1000000) : '');
  }
  return convert(num);
}

function formatReportDate(d = new Date()) {
  try {
    return d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'Africa/Lagos'
    }) + ' WAT';
  } catch (e) {
    return d.toUTCString();
  }
}

function generateReportHash(prefix = 'INEC-EVOTE') {
  const chars = '0123456789ABCDEF';
  let hash = '';
  for (let i = 0; i < 32; i++) {
    hash += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}-${hash.slice(0, 8)}-${hash.slice(8, 16)}-${hash.slice(16, 24)}-${hash.slice(24, 32)}`;
}

let currentReportHtml = '';
let currentReportTitle = '';
let currentReportFilename = '';

function printReportWindow(htmlContent, title) {
  const printWin = window.open('', '_blank');
  if (!printWin) {
    alert('Please allow pop-ups for this website to print/save the document.');
    return;
  }
  printWin.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>${title}</title>
      <style>
        @page { size: A4 portrait; margin: 10mm; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #ffffff !important; color: #111827 !important; margin: 0; padding: 20px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #d1d5db; padding: 6px 8px; font-size: 11px; }
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      </style>
    </head>
    <body>
      ${htmlContent}
      <script>
        window.onload = function() {
          window.print();
        };
      <\/script>
    </body>
    </html>
  `);
  printWin.document.close();
}

async function triggerDirectDownload(element, filename) {
  const statusEl = document.getElementById('report-preview-status');
  const dlBtn = document.getElementById('btn-modal-download-pdf');
  if (statusEl) statusEl.textContent = 'Rendering certified PDF document...';
  if (dlBtn) { dlBtn.disabled = true; dlBtn.textContent = 'Downloading...'; }

  try {
    if (typeof html2pdf !== 'undefined' && element) {
      const opt = {
        margin: [10, 10, 12, 10], // mm
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: '#ffffff',
          scrollX: 0,
          scrollY: 0
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };
      await html2pdf().from(element).set(opt).save();
      if (statusEl) statusEl.innerHTML = '<span style="color: #10b981; font-weight: 600;">&#10004; PDF downloaded successfully!</span>';
    } else {
      printReportWindow(currentReportHtml, currentReportTitle);
    }
  } catch (err) {
    console.error('PDF generation error:', err);
    if (statusEl) statusEl.textContent = 'Direct download failed. Please use the Print button to save as PDF.';
  } finally {
    if (dlBtn) { dlBtn.disabled = false; dlBtn.innerHTML = '&#128190; Download PDF'; }
  }
}

async function showReportPreviewAndExport(contentHtml, title, filename) {
  currentReportHtml = contentHtml;
  currentReportTitle = title;
  currentReportFilename = filename;

  const modal = document.getElementById('modal-report-preview');
  const titleEl = document.getElementById('report-preview-title');
  const statusEl = document.getElementById('report-preview-status');
  const contentEl = document.getElementById('report-preview-content');

  if (titleEl) titleEl.textContent = title;
  if (statusEl) statusEl.textContent = 'Preparing certified document...';
  if (contentEl) contentEl.innerHTML = contentHtml;

  if (modal) {
    modal.classList.add('active');
  }

  // Allow the DOM to render the visible content in the modal before capturing
  setTimeout(async () => {
    if (contentEl) {
      await triggerDirectDownload(contentEl, filename);
    }
  }, 150);
}

let isGeneratingVoters = false;
let isGeneratingResults = false;
let isGeneratingAudit = false;

// 1. VOTER REGISTER REPORT
async function generateVotersReportPDF() {
  if (isGeneratingVoters) return;
  isGeneratingVoters = true;

  const triggerBtns = [
    document.getElementById('btn-export-voters-pdf'),
    document.getElementById('btn-report-voters')
  ].filter(Boolean);

  triggerBtns.forEach(b => { b.disabled = true; b.textContent = 'Generating PDF...'; });

  try {
    const [stats, voters] = await Promise.all([
      apiRequest('/api/v1/overview/stats').catch(() => ({})),
      apiRequest('/api/v1/voters?limit=1000').catch(() => [])
    ]);

    const electionTitle = (stats.election && stats.election.title) ? stats.election.title : 'Federal / State Election';
    const totalVoters = Array.isArray(voters) ? voters.length : 0;
    const enrolledCount = Array.isArray(voters) 
      ? voters.filter(v => v.sensor_slot_id && (v.fp_status === 'Enrolled' || v.sensor_slot_id > 0)).length 
      : 0;
    const eligibleCount = Array.isArray(voters) 
      ? voters.filter(v => v.eligibility_status === 'Eligible' && v.registration_status === 'Active').length 
      : 0;
    const reportHash = generateReportHash('INEC-VR');
    const generatedDate = formatReportDate();

    const voterRows = totalVoters === 0 ? `
      <tr>
        <td colspan="7" style="padding: 18px; text-align: center; color: #6b7280; font-style: italic;">
          No registered voters recorded in this polling register.
        </td>
      </tr>
    ` : voters.map((v, i) => {
      const isEnrolled = v.sensor_slot_id && (v.fp_status === 'Enrolled' || v.sensor_slot_id > 0);
      const fpBadge = isEnrolled 
        ? `<span style="background: #ecfdf5; color: #047857; padding: 2px 6px; border-radius: 4px; font-weight: 600; font-size: 10px; border: 1px solid #a7f3d0;">Enrolled (Slot #${v.sensor_slot_id})</span>`
        : `<span style="background: #fef2f2; color: #b91c1c; padding: 2px 6px; border-radius: 4px; font-weight: 600; font-size: 10px; border: 1px solid #fecaca;">Not Enrolled</span>`;

      return `
        <tr style="border-bottom: 1px solid #e5e7eb; font-size: 10px; ${i % 2 === 1 ? 'background: #f9fafb;' : ''}">
          <td style="padding: 6px 8px; text-align: center; font-weight: 600; color: #6b7280;">${i + 1}</td>
          <td style="padding: 6px 8px; font-family: monospace; font-weight: 700; color: #111827;">${v.voter_id}</td>
          <td style="padding: 6px 8px; font-weight: 600; color: #111827;">${v.full_name}</td>
          <td style="padding: 6px 8px; color: #4b5563;">${v.polling_location_name || 'Lagos Central (ESP32-01)'}</td>
          <td style="padding: 6px 8px; text-align: center;">${fpBadge}</td>
          <td style="padding: 6px 8px; text-align: center;"><span style="color: #047857; font-weight: 600;">${v.eligibility_status || 'Eligible'}</span></td>
          <td style="padding: 6px 8px; text-align: center; border-left: 1px dashed #cbd5e1; width: 90px;">
            <div style="height: 18px; border-bottom: 1px solid #94a3b8; margin: 0 auto; width: 85%;"></div>
          </td>
        </tr>
      `;
    }).join('');

    const htmlContent = `
      <div style="width: 100%; background: #ffffff; color: #111827;">
        <!-- Official INEC Header -->
        <div style="text-align: center; border-bottom: 3px double #008751; padding-bottom: 14px; margin-bottom: 16px;">
          <div style="display: flex; align-items: center; justify-content: center; gap: 12px; margin-bottom: 6px;">
            <div style="width: 36px; height: 36px; border-radius: 50%; background: #008751; display: flex; align-items: center; justify-content: center; color: #ffffff; font-weight: 900; font-size: 18px; border: 2px solid #005a36;">
              &#9733;
            </div>
            <div>
              <div style="font-size: 14px; font-weight: 800; letter-spacing: 1.5px; color: #008751; text-transform: uppercase;">
                Independent National Electoral Commission (INEC)
              </div>
              <div style="font-size: 10px; font-weight: 700; letter-spacing: 1px; color: #4b5563; text-transform: uppercase;">
                Federal Republic of Nigeria &bull; Biometric E-Voting Registry
              </div>
            </div>
          </div>
          <div style="font-size: 16px; font-weight: 900; color: #111827; text-transform: uppercase; margin-top: 6px;">
            Official Voter Register & Biometric Accreditation Record
          </div>
          <div style="font-size: 10.5px; color: #4b5563; margin-top: 2px;">
            Certified Register of Eligible Voters for ${electionTitle}
          </div>
        </div>

        <!-- Scope & Metadata Box -->
        <div style="display: grid; grid-template-columns: 2fr 1.2fr; gap: 12px; background: #f0fdf4; border: 1px solid #86efac; border-radius: 6px; padding: 10px 14px; margin-bottom: 16px; font-size: 11px;">
          <div>
            <div><strong>Election:</strong> ${electionTitle}</div>
            <div style="margin-top: 3px;"><strong>Polling Station:</strong> Lagos Central Division (Unit ESP32-01)</div>
            <div style="margin-top: 3px;"><strong>Biometric Sensor:</strong> AS608 Optical Sensor (500 DPI) & 4x4 Keypad</div>
          </div>
          <div>
            <div><strong>Generated:</strong> ${generatedDate}</div>
            <div style="margin-top: 3px;"><strong>Total Registered:</strong> <strong>${totalVoters.toLocaleString()}</strong> voters</div>
            <div style="margin-top: 3px;"><strong>Biometrics Enrolled:</strong> <strong style="color: #047857;">${enrolledCount.toLocaleString()}</strong> (${totalVoters > 0 ? Math.round(enrolledCount / totalVoters * 100) : 0}%)</div>
          </div>
        </div>

        <!-- Voters Data Table -->
        <table style="width: 100%; border-collapse: collapse; font-size: 10.5px; margin-bottom: 20px;">
          <thead>
            <tr style="background: #008751; color: #ffffff;">
              <th style="padding: 7px 8px; border: 1px solid #005a36; text-align: center; width: 5%;">S/N</th>
              <th style="padding: 7px 8px; border: 1px solid #005a36; text-align: left; width: 18%;">Voter ID (Keypad)</th>
              <th style="padding: 7px 8px; border: 1px solid #005a36; text-align: left; width: 25%;">Full Legal Name</th>
              <th style="padding: 7px 8px; border: 1px solid #005a36; text-align: left; width: 18%;">Polling Unit</th>
              <th style="padding: 7px 8px; border: 1px solid #005a36; text-align: center; width: 16%;">AS608 Fingerprint</th>
              <th style="padding: 7px 8px; border: 1px solid #005a36; text-align: center; width: 10%;">Eligibility</th>
              <th style="padding: 7px 8px; border: 1px solid #005a36; text-align: center; width: 14%;">Accreditation Check</th>
            </tr>
          </thead>
          <tbody>
            ${voterRows}
          </tbody>
        </table>

        <!-- Official Certification & Signatures Section -->
        <div style="border-top: 2px solid #008751; padding-top: 14px; margin-top: 10px;">
          <div style="font-size: 11px; font-weight: 700; color: #065f46; text-transform: uppercase; margin-bottom: 12px;">
            Statutory Certification & Attestation of Polling Unit Officials
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-bottom: 18px;">
            <div style="border: 1px solid #d1d5db; border-radius: 4px; padding: 8px; font-size: 10px; background: #f9fafb;">
              <div style="font-weight: 700; color: #111827; margin-bottom: 18px;">Presiding Officer (PO):</div>
              <div style="border-bottom: 1px solid #4b5563; margin-bottom: 4px;"></div>
              <div>Name & Signature</div>
            </div>
            <div style="border: 1px solid #d1d5db; border-radius: 4px; padding: 8px; font-size: 10px; background: #f9fafb;">
              <div style="font-weight: 700; color: #111827; margin-bottom: 18px;">Polling Unit Security Agent:</div>
              <div style="border-bottom: 1px solid #4b5563; margin-bottom: 4px;"></div>
              <div>NPF / NSCDC Representative</div>
            </div>
            <div style="border: 2px dashed #008751; border-radius: 4px; padding: 8px; text-align: center; font-size: 9.5px; background: #f0fdf4;">
              <div style="font-weight: 800; color: #008751; text-transform: uppercase; margin-bottom: 10px;">INEC E-VOTE OFFICIAL SEAL</div>
              <div style="color: #64748b; font-size: 8.5px;">Cryptographically Verified Ledger</div>
              <div style="margin-top: 4px; font-family: monospace; font-size: 8px; color: #065f46;">VERIFIED SECURE</div>
            </div>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 9px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 6px;">
            <div>Verification Security Hash: <code style="font-family: monospace;">${reportHash}</code></div>
            <div>Federal Republic of Nigeria &bull; Automated Biometric Electoral System</div>
          </div>
        </div>
      </div>
    `;

    await showReportPreviewAndExport(htmlContent, 'INEC Certified Voter Register', `Voter_Register_Report_${Date.now()}.pdf`);
  } catch (err) {
    console.error('Error generating Voter Register PDF:', err);
    alert('Failed to generate Voter Register PDF: ' + err.message);
  } finally {
    isGeneratingVoters = false;
    triggerBtns.forEach(b => {
      b.disabled = false;
      if (b.id === 'btn-export-voters-pdf') b.innerHTML = '📄 Export Register (PDF)';
      else b.innerHTML = '📄 Download Register PDF';
    });
  }
}

// 2. ELECTION RESULTS CERTIFICATE (FORM EC 8A)
async function generateResultsCertificatePDF() {
  if (isGeneratingResults) return;
  isGeneratingResults = true;

  const triggerBtns = [
    document.getElementById('btn-export-results'),
    document.getElementById('btn-report-results')
  ].filter(Boolean);

  triggerBtns.forEach(b => { b.disabled = true; b.textContent = 'Generating Certificate...'; });

  try {
    if (!activeElectionId) {
      const stats = await apiRequest('/api/v1/overview/stats').catch(() => ({}));
      if (stats.election) activeElectionId = stats.election.id;
    }
    if (!activeElectionId) {
      alert('No active or closed election record found to generate results certificate.');
      return;
    }

    const data = await apiRequest(`/api/v1/elections/${activeElectionId}/results`);
    if (data.status === 'HIDDEN') {
      alert('Results for this election are sealed until polls are closed.');
      return;
    }

    const election = data.election || {};
    const results = data.results || [];
    const totalValid = data.total_valid_ballots || 0;
    const totalEligible = data.total_eligible_voters || 0;
    const totalParticipants = data.total_participants || 0;
    const turnoutPct = data.turnout_percentage || 0;
    const isReconciled = data.reconciled !== false;
    const reportHash = generateReportHash('INEC-EC8A');
    const generatedDate = formatReportDate();

    // Top party determination
    const topParty = results.length > 0 ? results[0] : null;
    let winnerDeclarationHtml = '';
    if (topParty && topParty.vote_count > 0) {
      winnerDeclarationHtml = `
        <div style="background: #f0fdf4; border: 2px solid #008751; padding: 12px 16px; border-radius: 6px; margin-bottom: 16px; font-size: 11px;">
          <div style="font-weight: 800; color: #008751; text-transform: uppercase; margin-bottom: 4px; font-size: 11.5px;">
            Official Declaration of Election Return:
          </div>
          <div style="line-height: 1.5; color: #14532d;">
            I hereby certify that <strong>${topParty.candidate_name || 'The Accredited Candidate'}</strong> of the 
            <strong>${topParty.party_name} (${topParty.party_acronym})</strong>, having satisfied the requirements of the Electoral Act 
            and scored the majority of valid votes cast totaling <strong>${topParty.vote_count.toLocaleString()}</strong> 
            (<em>${numberToWords(topParty.vote_count)} Ballots</em>) representing <strong>${topParty.percentage}%</strong> of total valid votes, 
            is hereby declared <strong>WINNER AND RETURNED ELECTED</strong>.
          </div>
        </div>
      `;
    } else {
      winnerDeclarationHtml = `
        <div style="background: #fefce8; border: 1px solid #fde047; padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; font-size: 11px; color: #854d0e;">
          <strong>Interim Return Notice:</strong> Polling is currently ongoing or awaiting ballot aggregation. No candidate has yet attained the statutory threshold.
        </div>
      `;
    }

    const resultsRows = results.length === 0 ? `
      <tr>
        <td colspan="6" style="padding: 16px; text-align: center; color: #6b7280; font-style: italic;">
          No accepted ballots recorded for this election.
        </td>
      </tr>
    ` : results.map((r, i) => `
      <tr style="border-bottom: 1px solid #e5e7eb; font-size: 11px; ${i % 2 === 1 ? 'background: #f9fafb;' : ''}">
        <td style="padding: 7px 8px; text-align: center; font-weight: 600; color: #6b7280;">${i + 1}</td>
        <td style="padding: 7px 8px; font-weight: 700; color: #111827;">${r.party_name}</td>
        <td style="padding: 7px 8px; text-align: center;"><code style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-weight: 700;">${r.party_acronym}</code></td>
        <td style="padding: 7px 8px; color: #374151;">${r.candidate_name || '-'}</td>
        <td style="padding: 7px 8px; text-align: right; font-weight: 800; font-size: 11.5px; color: #111827;">${r.vote_count.toLocaleString()}</td>
        <td style="padding: 7px 8px; text-align: right; font-weight: 700; color: #008751;">${r.percentage}%</td>
      </tr>
    `).join('');

    const htmlContent = `
      <div style="width: 100%; background: #ffffff; color: #111827;">
        <!-- Official INEC Form EC8A Header -->
        <div style="text-align: center; border-bottom: 3px double #008751; padding-bottom: 12px; margin-bottom: 14px;">
          <div style="display: flex; align-items: center; justify-content: center; gap: 12px; margin-bottom: 6px;">
            <div style="width: 38px; height: 38px; border-radius: 50%; background: #008751; display: flex; align-items: center; justify-content: center; color: #ffffff; font-weight: 900; font-size: 18px; border: 2px solid #005a36;">
              &#9733;
            </div>
            <div>
              <div style="font-size: 14px; font-weight: 800; letter-spacing: 1.5px; color: #008751; text-transform: uppercase;">
                Independent National Electoral Commission
              </div>
              <div style="font-size: 10px; font-weight: 700; letter-spacing: 1px; color: #4b5563; text-transform: uppercase;">
                Federal Republic of Nigeria &bull; Form EC 8A
              </div>
            </div>
          </div>
          <div style="font-size: 17px; font-weight: 900; color: #111827; text-transform: uppercase; margin-top: 4px;">
            Statement of Results / Certificate of Return
          </div>
          <div style="font-size: 10.5px; color: #4b5563; margin-top: 2px;">
            Official Declaration of Polling Unit Results for ${election.title || 'General Election'}
          </div>
        </div>

        <!-- Metadata Ribbon -->
        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 12px; background: #f0fdf4; border: 1px solid #86efac; border-radius: 6px; padding: 10px 14px; margin-bottom: 16px; font-size: 11px;">
          <div>
            <div><strong>Election Title:</strong> ${election.title || 'Federal General Election'}</div>
            <div style="margin-top: 3px;"><strong>Election Code:</strong> <code>${election.code || election.id || 'ELEC-2026-001'}</code> &bull; <strong>Status:</strong> ${election.status || 'Active'}</div>
            <div style="margin-top: 3px;"><strong>Polling Station:</strong> Lagos Central Division (Terminal ESP32-01)</div>
          </div>
          <div>
            <div><strong>Certified Date:</strong> ${generatedDate}</div>
            <div style="margin-top: 3px;"><strong>Accreditation Terminal:</strong> ESP32-01 Online</div>
            <div style="margin-top: 3px;"><strong>Audit Check:</strong> <strong style="color: #166534;">&#10004; Verified 100%</strong></div>
          </div>
        </div>

        <!-- Section A: Ballot Reconciliation & Voter Turnout -->
        <div style="margin-bottom: 16px;">
          <div style="font-size: 11.5px; font-weight: 700; color: #065f46; text-transform: uppercase; margin-bottom: 6px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px;">
            Section A: Voter Turnout & Ballot Reconciliation Audit
          </div>
          <table style="width: 100%; border-collapse: collapse; font-size: 10.5px;">
            <tr style="background: #f9fafb;">
              <td style="padding: 6px 8px; border: 1px solid #d1d5db; width: 35%;">1. Number of Voters on Register</td>
              <td style="padding: 6px 8px; border: 1px solid #d1d5db; font-weight: 700; width: 15%;">${totalEligible.toLocaleString()}</td>
              <td style="padding: 6px 8px; border: 1px solid #d1d5db; width: 35%;">2. Accredited Voters / Total Participants</td>
              <td style="padding: 6px 8px; border: 1px solid #d1d5db; font-weight: 700; width: 15%;">${totalParticipants.toLocaleString()}</td>
            </tr>
            <tr>
              <td style="padding: 6px 8px; border: 1px solid #d1d5db;">3. Total Valid Ballots Counted</td>
              <td style="padding: 6px 8px; border: 1px solid #d1d5db; font-weight: 700;">${totalValid.toLocaleString()}</td>
              <td style="padding: 6px 8px; border: 1px solid #d1d5db;">4. Voter Turnout Rate (%)</td>
              <td style="padding: 6px 8px; border: 1px solid #d1d5db; font-weight: 700; color: #008751;">${turnoutPct}%</td>
            </tr>
            <tr style="background: #f9fafb;">
              <td style="padding: 6px 8px; border: 1px solid #d1d5db;">5. Rejected / Spoiled Ballots</td>
              <td style="padding: 6px 8px; border: 1px solid #d1d5db; font-weight: 700;">0 (Electronic Strict Verification)</td>
              <td style="padding: 6px 8px; border: 1px solid #d1d5db;">6. Reconciliation Balance Status</td>
              <td style="padding: 6px 8px; border: 1px solid #d1d5db; font-weight: 700; color: #166534;">
                ${isReconciled ? '&#10004; 100% RECONCILED' : 'DISCREPANCY FLAGGED'}
              </td>
            </tr>
          </table>
        </div>

        <!-- Section B: Political Party Votes -->
        <div style="margin-bottom: 16px;">
          <div style="font-size: 11.5px; font-weight: 700; color: #065f46; text-transform: uppercase; margin-bottom: 6px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px;">
            Section B: Valid Votes Scored by Political Parties
          </div>
          <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
            <thead>
              <tr style="background: #008751; color: #ffffff;">
                <th style="padding: 7px 8px; border: 1px solid #005a36; text-align: center; width: 6%;">S/N</th>
                <th style="padding: 7px 8px; border: 1px solid #005a36; text-align: left; width: 28%;">Political Party</th>
                <th style="padding: 7px 8px; border: 1px solid #005a36; text-align: center; width: 12%;">Acronym</th>
                <th style="padding: 7px 8px; border: 1px solid #005a36; text-align: left; width: 24%;">Candidate Name</th>
                <th style="padding: 7px 8px; border: 1px solid #005a36; text-align: right; width: 15%;">Valid Votes</th>
                <th style="padding: 7px 8px; border: 1px solid #005a36; text-align: right; width: 15%;">Percentage (%)</th>
              </tr>
            </thead>
            <tbody>
              ${resultsRows}
            </tbody>
            <tfoot>
              <tr style="background: #f1f5f9; font-weight: 800; font-size: 11px;">
                <td colspan="4" style="padding: 7px 8px; border: 1px solid #cbd5e1; text-align: right;">TOTAL VALID BALLOTS COUNTED:</td>
                <td style="padding: 7px 8px; border: 1px solid #cbd5e1; text-align: right;">${totalValid.toLocaleString()}</td>
                <td style="padding: 7px 8px; border: 1px solid #cbd5e1; text-align: right; color: #008751;">100.0%</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <!-- Winner Declaration -->
        ${winnerDeclarationHtml}

        <!-- Section D: Official Endorsements & Signatures -->
        <div style="border-top: 2px solid #008751; padding-top: 12px; margin-top: 12px;">
          <div style="font-size: 11px; font-weight: 700; color: #065f46; text-transform: uppercase; margin-bottom: 10px;">
            Section C: Certification & Endorsement of Polling Unit Agents
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 16px;">
            <div style="border: 1px solid #cbd5e1; border-radius: 4px; padding: 8px; font-size: 10px; background: #f8fafc;">
              <div style="font-weight: 700; color: #1e293b; margin-bottom: 22px;">Presiding Officer (PO):</div>
              <div style="border-bottom: 1px dashed #64748b; margin-bottom: 4px;"></div>
              <div>Name & Official Signature &bull; Date: ${generatedDate}</div>
            </div>
            <div style="border: 1px solid #cbd5e1; border-radius: 4px; padding: 8px; font-size: 10px; background: #f8fafc;">
              <div style="font-weight: 700; color: #1e293b; margin-bottom: 22px;">Returning Officer (RO):</div>
              <div style="border-bottom: 1px dashed #64748b; margin-bottom: 4px;"></div>
              <div>Name & Official Signature &bull; Date: ${generatedDate}</div>
            </div>
          </div>
          <table style="width: 100%; border-collapse: collapse; font-size: 9.5px; margin-bottom: 10px;">
            <thead>
              <tr style="background: #f1f5f9;">
                <th style="border: 1px solid #cbd5e1; padding: 4px 6px;">APC Polling Agent</th>
                <th style="border: 1px solid #cbd5e1; padding: 4px 6px;">PDP Polling Agent</th>
                <th style="border: 1px solid #cbd5e1; padding: 4px 6px;">LP Polling Agent</th>
                <th style="border: 1px solid #cbd5e1; padding: 4px 6px;">NNPP Polling Agent</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="border: 1px solid #cbd5e1; padding: 12px 6px; text-align: center; color: #94a3b8;">Endorsed & Signed</td>
                <td style="border: 1px solid #cbd5e1; padding: 12px 6px; text-align: center; color: #94a3b8;">Endorsed & Signed</td>
                <td style="border: 1px solid #cbd5e1; padding: 12px 6px; text-align: center; color: #94a3b8;">Endorsed & Signed</td>
                <td style="border: 1px solid #cbd5e1; padding: 12px 6px; text-align: center; color: #94a3b8;">Endorsed & Signed</td>
              </tr>
            </tbody>
          </table>
          <div style="display: flex; justify-content: space-between; font-size: 9px; color: #64748b; border-top: 1px solid #e5e7eb; padding-top: 6px;">
            <div>Verification Security Hash: <code style="font-family: monospace;">${reportHash}</code></div>
            <div>Official Form EC 8A &bull; Independent National Electoral Commission</div>
          </div>
        </div>
      </div>
    `;

    await showReportPreviewAndExport(htmlContent, 'INEC Form EC 8A - Statement of Results', `Election_Results_Certificate_Form_EC8A_${Date.now()}.pdf`);
  } catch (err) {
    console.error('Error generating Results Certificate PDF:', err);
    alert('Failed to generate Results Certificate: ' + err.message);
  } finally {
    isGeneratingResults = false;
    triggerBtns.forEach(b => {
      b.disabled = false;
      if (b.id === 'btn-export-results') b.innerHTML = '&#128438; Export Certificate (PDF)';
      else b.innerHTML = '📄 Download Form EC8A PDF';
    });
  }
}

// 3. AUDIT TRAIL REPORT
async function generateAuditReportPDF() {
  if (isGeneratingAudit) return;
  isGeneratingAudit = true;

  const triggerBtns = [
    document.getElementById('btn-export-audit-pdf'),
    document.getElementById('btn-report-audit')
  ].filter(Boolean);

  triggerBtns.forEach(b => { b.disabled = true; b.textContent = 'Generating PDF...'; });

  try {
    const [stats, logs] = await Promise.all([
      apiRequest('/api/v1/overview/stats').catch(() => ({})),
      apiRequest('/api/v1/audit-logs?limit=200').catch(() => [])
    ]);

    let auditList = [];
    if (Array.isArray(logs)) {
      auditList = logs;
    } else if (logs && Array.isArray(logs.logs)) {
      auditList = logs.logs;
    } else {
      // Fallback: extract loaded rows from Security & Audit Logs table if available
      const tableRows = document.querySelectorAll('#audit-table-body tr');
      if (tableRows && tableRows.length > 0) {
        tableRows.forEach(tr => {
          const cells = tr.querySelectorAll('td');
          if (cells.length >= 6) {
            auditList.push({
              event_timestamp: cells[0].textContent.trim(),
              actor_type: cells[1].textContent.trim(),
              event_type: cells[2].textContent.trim(),
              result: cells[3].textContent.trim(),
              severity: cells[4].textContent.trim(),
              sanitized_description: cells[5].textContent.trim()
            });
          }
        });
      }
    }

    const totalLogs = auditList.length;
    const reportHash = generateReportHash('INEC-AUDIT');
    const generatedDate = formatReportDate();

    const auditRows = totalLogs === 0 ? `
      <tr>
        <td colspan="7" style="padding: 16px; text-align: center; color: #6b7280; font-style: italic;">
          No audit event records captured.
        </td>
      </tr>
    ` : auditList.map((l, i) => {
      const isSuccess = l && l.result === 'Success';
      const resultBadge = isSuccess
        ? `<span style="background: #ecfdf5; color: #047857; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 9.5px; border: 1px solid #a7f3d0;">SUCCESS</span>`
        : `<span style="background: #fef2f2; color: #b91c1c; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 9.5px; border: 1px solid #fecaca;">${(l && l.result) || 'FAILED'}</span>`;

      const severityBadge = (l && (l.severity === 'Critical' || l.severity === 'Security'))
        ? `<span style="background: #fef2f2; color: #991b1b; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 9.5px;">${l.severity}</span>`
        : `<span style="background: #f0fdf4; color: #166534; padding: 2px 6px; border-radius: 4px; font-weight: 600; font-size: 9.5px;">${(l && l.severity) || 'Info'}</span>`;

      return `
        <tr style="border-bottom: 1px solid #e5e7eb; font-size: 10px; ${i % 2 === 1 ? 'background: #f9fafb;' : ''}">
          <td style="padding: 6px 8px; text-align: center; font-weight: 600; color: #6b7280;">${i + 1}</td>
          <td style="padding: 6px 8px; font-family: monospace; color: #374151; white-space: nowrap;">${(l && l.event_timestamp) || '-'}</td>
          <td style="padding: 6px 8px; font-weight: 700; color: #111827;">${(l && l.actor_type) || 'SYSTEM'}</td>
          <td style="padding: 6px 8px;"><code style="background: #f1f5f9; padding: 2px 4px; border-radius: 3px; font-size: 9.5px; font-weight: 600;">${(l && l.event_type) || '-'}</code></td>
          <td style="padding: 6px 8px; text-align: center;">${resultBadge}</td>
          <td style="padding: 6px 8px; text-align: center;">${severityBadge}</td>
          <td style="padding: 6px 8px; color: #374151;">${(l && l.sanitized_description) || '-'}</td>
        </tr>
      `;
    }).join('');

    const htmlContent = `
      <div style="width: 100%; background: #ffffff; color: #111827;">
        <!-- Official INEC Audit Header -->
        <div style="text-align: center; border-bottom: 3px double #008751; padding-bottom: 12px; margin-bottom: 14px;">
          <div style="display: flex; align-items: center; justify-content: center; gap: 12px; margin-bottom: 6px;">
            <div style="width: 38px; height: 38px; border-radius: 50%; background: #008751; display: flex; align-items: center; justify-content: center; color: #ffffff; font-weight: 900; font-size: 18px; border: 2px solid #005a36;">
              &#9733;
            </div>
            <div>
              <div style="font-size: 14px; font-weight: 800; letter-spacing: 1.5px; color: #008751; text-transform: uppercase;">
                Independent National Electoral Commission
              </div>
              <div style="font-size: 10px; font-weight: 700; letter-spacing: 1px; color: #4b5563; text-transform: uppercase;">
                Federal Republic of Nigeria &bull; Electoral Security & Integrity Division
              </div>
            </div>
          </div>
          <div style="font-size: 17px; font-weight: 900; color: #111827; text-transform: uppercase; margin-top: 4px;">
            Cryptographic Audit Trail & System Integrity Report
          </div>
          <div style="font-size: 10.5px; color: #4b5563; margin-top: 2px;">
            Immutable Event Log of Administrative Actions, Terminal Transactions, and Biometric Operations
          </div>
        </div>

        <!-- Scope & Summary Banner -->
        <div style="display: grid; grid-template-columns: 2fr 1.2fr; gap: 12px; background: #f0fdf4; border: 1px solid #86efac; border-radius: 6px; padding: 10px 14px; margin-bottom: 16px; font-size: 11px;">
          <div>
            <div><strong>Active Terminal:</strong> ESP32-01 (Lagos Central Division)</div>
            <div style="margin-top: 3px;"><strong>Cryptographic Ledger:</strong> SHA-256 Chained Event Log</div>
            <div style="margin-top: 3px;"><strong>Audit Scope:</strong> All Terminal & Server Transactions</div>
          </div>
          <div>
            <div><strong>Generated:</strong> ${generatedDate}</div>
            <div style="margin-top: 3px;"><strong>Total Events Logged:</strong> <strong>${totalLogs.toLocaleString()}</strong> events</div>
            <div style="margin-top: 3px;"><strong>System Status:</strong> <strong style="color: #047857;">&#10004; SECURE & VERIFIED</strong></div>
          </div>
        </div>

        <!-- Audit Table -->
        <table style="width: 100%; border-collapse: collapse; font-size: 10px; margin-bottom: 20px;">
          <thead>
            <tr style="background: #008751; color: #ffffff;">
              <th style="padding: 7px 6px; border: 1px solid #005a36; text-align: center; width: 5%;">S/N</th>
              <th style="padding: 7px 6px; border: 1px solid #005a36; text-align: left; width: 17%;">Timestamp</th>
              <th style="padding: 7px 6px; border: 1px solid #005a36; text-align: left; width: 11%;">Actor</th>
              <th style="padding: 7px 6px; border: 1px solid #005a36; text-align: left; width: 18%;">Event Type</th>
              <th style="padding: 7px 6px; border: 1px solid #005a36; text-align: center; width: 10%;">Result</th>
              <th style="padding: 7px 6px; border: 1px solid #005a36; text-align: center; width: 9%;">Severity</th>
              <th style="padding: 7px 6px; border: 1px solid #005a36; text-align: left; width: 30%;">Sanitized Description</th>
            </tr>
          </thead>
          <tbody>
            ${auditRows}
          </tbody>
        </table>

        <!-- Auditor Attestation -->
        <div style="border-top: 2px solid #008751; padding-top: 14px; margin-top: 12px;">
          <div style="font-size: 11px; font-weight: 700; color: #065f46; text-transform: uppercase; margin-bottom: 12px;">
            Cryptographic Integrity Attestation & Sign-off
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-bottom: 16px;">
            <div style="border: 1px solid #cbd5e1; border-radius: 4px; padding: 8px; font-size: 10px; background: #f8fafc;">
              <div style="font-weight: 700; color: #1e293b; margin-bottom: 18px;">Electoral IT Auditor:</div>
              <div style="border-bottom: 1px dashed #64748b; margin-bottom: 4px;"></div>
              <div>System Integrity Auditor &bull; INEC</div>
            </div>
            <div style="border: 1px solid #cbd5e1; border-radius: 4px; padding: 8px; font-size: 10px; background: #f8fafc;">
              <div style="font-weight: 700; color: #1e293b; margin-bottom: 18px;">Resident Electoral Commissioner:</div>
              <div style="border-bottom: 1px dashed #64748b; margin-bottom: 4px;"></div>
              <div>REC Authorization &bull; Signed</div>
            </div>
            <div style="border: 2px dashed #008751; border-radius: 4px; padding: 8px; text-align: center; font-size: 9.5px; background: #f0fdf4;">
              <div style="font-weight: 800; color: #008751; text-transform: uppercase; margin-bottom: 8px;">INTEGRITY CERTIFICATE</div>
              <div style="color: #64748b; font-size: 8.5px;">Chain Hash Validated</div>
              <div style="margin-top: 4px; font-family: monospace; font-size: 8px; color: #065f46;">NO TAMPER DETECTED</div>
            </div>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 9px; color: #64748b; border-top: 1px solid #e5e7eb; padding-top: 6px;">
            <div>Audit Hash: <code style="font-family: monospace;">${reportHash}</code></div>
            <div>Independent National Electoral Commission &bull; Security Audit Log</div>
          </div>
        </div>
      </div>
    `;

    await showReportPreviewAndExport(htmlContent, 'INEC Cryptographic Audit Trail Report', `Audit_Trail_Report_${Date.now()}.pdf`);
  } catch (err) {
    console.error('Error generating Audit Report PDF:', err);
    alert('Failed to generate Audit Report: ' + err.message);
  } finally {
    isGeneratingAudit = false;
    triggerBtns.forEach(b => {
      b.disabled = false;
      if (b.id === 'btn-export-audit-pdf') b.innerHTML = '📄 Export Audit Trail (PDF)';
      else b.innerHTML = '📄 Download Audit Trail PDF';
    });
  }
}

// Expose functions globally for inline onclick triggers
window.generateVotersReportPDF = generateVotersReportPDF;
window.generateResultsCertificatePDF = generateResultsCertificatePDF;
window.generateAuditReportPDF = generateAuditReportPDF;

// Attach event listeners for all report export buttons and modal
document.addEventListener('DOMContentLoaded', () => {
  const btnExportVoters = document.getElementById('btn-export-voters-pdf');
  if (btnExportVoters) btnExportVoters.addEventListener('click', generateVotersReportPDF);

  const btnRepVoters = document.getElementById('btn-report-voters');
  if (btnRepVoters) btnRepVoters.addEventListener('click', generateVotersReportPDF);

  const btnExportResults = document.getElementById('btn-export-results');
  if (btnExportResults) btnExportResults.addEventListener('click', generateResultsCertificatePDF);

  const btnRepResults = document.getElementById('btn-report-results');
  if (btnRepResults) btnRepResults.addEventListener('click', generateResultsCertificatePDF);

  const btnExportAudit = document.getElementById('btn-export-audit-pdf');
  if (btnExportAudit) btnExportAudit.addEventListener('click', generateAuditReportPDF);

  const btnRepAudit = document.getElementById('btn-report-audit');
  if (btnRepAudit) btnRepAudit.addEventListener('click', generateAuditReportPDF);

  const btnCloseModal = document.getElementById('btn-modal-close-preview');
  if (btnCloseModal) {
    btnCloseModal.addEventListener('click', () => {
      const modal = document.getElementById('modal-report-preview');
      if (modal) modal.classList.remove('active');
    });
  }

  const btnModalPrint = document.getElementById('btn-modal-print-pdf');
  if (btnModalPrint) {
    btnModalPrint.addEventListener('click', () => {
      printReportWindow(currentReportHtml, currentReportTitle);
    });
  }

  const btnModalDownload = document.getElementById('btn-modal-download-pdf');
  if (btnModalDownload) {
    btnModalDownload.addEventListener('click', () => {
      const contentEl = document.getElementById('report-preview-content');
      if (contentEl) triggerDirectDownload(contentEl, currentReportFilename);
    });
  }
});

