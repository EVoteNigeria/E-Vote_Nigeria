// Biometric E-Voting System Admin Dashboard Logic
// Connects securely to FastAPI backend endpoints

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

// 4. Voter Registry
async function loadVoters(searchQuery = '') {
  const url = searchQuery ? `/api/v1/voters?search=${encodeURIComponent(searchQuery)}` : '/api/v1/voters';
  const voters = await apiRequest(url);
  const tbody = document.getElementById('voters-table-body');
  tbody.innerHTML = '';
  voters.forEach(v => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${v.voter_id}</strong></td>
      <td>${v.full_name}</td>
      <td><span class="badge badge-success">${v.eligibility_status}</span></td>
      <td><span class="badge badge-info">${v.registration_status}</span></td>
      <td>${v.fp_status === 'Enrolled' ? `<span class="badge badge-success">Slot #${v.sensor_slot_id}</span>` : `<span class="badge badge-warning">Not Enrolled</span>`}</td>
      <td>${v.polling_location_name || 'PU-01-LAG'}</td>
      <td>
        <button onclick="triggerEnrollFor('${v.id}')" class="btn btn-secondary btn-sm">&#9757; Enroll Finger</button>
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
