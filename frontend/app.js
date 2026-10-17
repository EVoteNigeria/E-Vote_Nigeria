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
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

document.querySelectorAll('.modal-close').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
  });
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
    const payload = {
      election_id: activeElectionId,
      party_name: document.getElementById('party-input-name').value,
      party_acronym: document.getElementById('party-input-acronym').value,
      lcd_label: document.getElementById('party-input-lcd').value.toUpperCase().trim(),
      candidate_name: document.getElementById('party-input-candidate').value,
      display_order: cachedParties.length + 1,
      is_active: true
    };
    await apiRequest('/api/v1/parties', 'POST', payload);
    closeModal('modal-add-party');
    formAddParty.reset();
    loadParties();
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
          <button onclick="openMapSlotModal('${v.id}', '${v.voter_id}', '${safeName}')" class="btn btn-secondary btn-sm" title="Directly link to existing AS608 hardware slot without re-scanning">&#128279; Link Slot</button>
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
