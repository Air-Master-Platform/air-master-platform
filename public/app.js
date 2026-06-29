'use strict';

// ───────── Auth / user ─────────
let currentUser = null;
(async function loadMe() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) return (window.location.href = '/login');
    const { user } = await res.json();
    currentUser = user;
    document.getElementById('userName').textContent = user.username;
    document.getElementById('userRole').textContent = user.role;
    document.getElementById('userAvatar').textContent = user.username.slice(0, 2).toUpperCase();
    renderDashboard();
  } catch {
    window.location.href = '/login';
  }
})();

// ───────── Sidebar nav ─────────
const navItems = document.querySelectorAll('.nav-item');
const views = document.querySelectorAll('.view');
const pageTitle = document.getElementById('pageTitle');
const sidebar = document.getElementById('sidebar');

navItems.forEach((btn) => {
  btn.addEventListener('click', () => {
    navItems.forEach((b) => b.classList.remove('active'));
    views.forEach((v) => v.classList.remove('active'));
    btn.classList.add('active');
    const view = btn.dataset.view;
    document.getElementById('view-' + view).classList.add('active');
    pageTitle.textContent = btn.querySelector('.nav-label').textContent;
    sidebar.classList.remove('open');
    if (view === 'agent') {
      if (!threadsLoaded) loadThreads();
      document.getElementById('chatInput').focus();
    }
    if (view === 'buildup') {
      initBuildup();
    }
  });
});

document.getElementById('mobileMenu').addEventListener('click', () => sidebar.classList.toggle('open'));

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login';
});

// ───────── Dashboard (cargo mock data) ─────────
function renderDashboard() {
  const metrics = [
    { label: 'Active Shipments', value: '1,284', icon: '📦', up: true, sub: '+8.2% vs last month' },
    { label: 'In Transit', value: '342', icon: '✈️', up: true, sub: '27 arriving today' },
    { label: 'On-Time Rate', value: '99.2%', icon: '⏱️', up: true, sub: '+0.4% this quarter' },
    { label: 'Revenue (MTD)', value: '$2.4M', icon: '💰', up: false, sub: '-1.1% vs target' },
  ];
  document.getElementById('metrics').innerHTML = metrics.map((m) => `
    <div class="metric">
      <div class="metric-strip"></div>
      <div class="metric-body">
        <div class="metric-top">
          <span class="metric-label">${m.label}</span>
          <span class="metric-icon">${m.icon}</span>
        </div>
        <div class="metric-value">${m.value}</div>
        <div class="metric-sub">
          <span class="${m.up ? 'up' : 'down'}">${m.up ? '▲' : '▼'}</span>
          <span>${m.sub}</span>
        </div>
      </div>
    </div>`).join('');

  const shipments = [
    { id: 'AM-90412', route: 'Riyadh → Frankfurt', when: 'Jun 27, 2026 · 14:20', status: 'transit' },
    { id: 'AM-90388', route: 'Dubai → Hong Kong', when: 'Jun 27, 2026 · 09:05', status: 'delivered' },
    { id: 'AM-90377', route: 'Jeddah → London', when: 'Jun 26, 2026 · 22:40', status: 'transit' },
    { id: 'AM-90351', route: 'Cairo → New York', when: 'Jun 26, 2026 · 18:15', status: 'pending' },
    { id: 'AM-90340', route: 'Doha → Singapore', when: 'Jun 26, 2026 · 11:00', status: 'delayed' },
  ];
  const badgeClass = { transit: 'b-transit', delivered: 'b-delivered', pending: 'b-pending', delayed: 'b-delayed' };
  const badgeText = { transit: 'In Transit', delivered: 'Delivered', pending: 'Pending', delayed: 'Delayed' };
  document.getElementById('recentShipments').innerHTML = shipments.map((s) => `
    <div class="list-row">
      <div class="list-ico">📦</div>
      <div class="list-main">
        <p class="list-title">${s.id} — ${s.route}</p>
        <p class="list-meta">${s.when}</p>
      </div>
      <span class="badge ${badgeClass[s.status]}">${badgeText[s.status]}</span>
    </div>`).join('');

  drawCharts();
}

let chartsDrawn = false;
function drawCharts() {
  if (chartsDrawn || typeof Chart === 'undefined') return;
  chartsDrawn = true;
  const red = '#e02230';
  const grey = '#cbd0d6';

  new Chart(document.getElementById('shipmentsChart'), {
    type: 'line',
    data: {
      labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
      datasets: [
        { label: 'Shipments', data: [840, 920, 1010, 980, 1150, 1284],
          borderColor: red, backgroundColor: 'rgba(224,34,48,0.08)', borderWidth: 2.5,
          fill: true, tension: 0.35, pointRadius: 3, pointBackgroundColor: red },
        { label: 'Delivered', data: [810, 890, 985, 950, 1120, 1240],
          borderColor: grey, borderWidth: 2, tension: 0.35, pointRadius: 2, fill: false },
      ],
    },
    options: { responsive: true, plugins: { legend: { position: 'bottom' } },
      scales: { y: { grid: { color: '#eef0f3' } }, x: { grid: { display: false } } } },
  });

  new Chart(document.getElementById('regionChart'), {
    type: 'doughnut',
    data: {
      labels: ['Middle East', 'Europe', 'Asia', 'Americas'],
      datasets: [{ data: [42, 28, 20, 10],
        backgroundColor: [red, '#f5727c', '#facad0', '#cbd0d6'], borderWidth: 0 }],
    },
    options: { responsive: true, cutout: '62%', plugins: { legend: { position: 'bottom' } } },
  });
}

// ───────── Agent chat ─────────
let activeSessionId = null;
let activeThreadName = null;
let threadsLoaded = false;
let isTyping = false;

const messagesEl = document.getElementById('messages');
const threadListEl = document.getElementById('threadList');
const threadTitleEl = document.getElementById('threadTitle');
const renameBtn = document.getElementById('renameBtn');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');

function uuid() { return crypto.randomUUID(); }
function timeNow() { return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

const QUICK = [
  { t: 'Track a shipment', d: 'Get live status by tracking number' },
  { t: 'Request a quote', d: 'Air freight pricing for a route' },
  { t: 'Customs & docs', d: 'What paperwork do I need?' },
  { t: 'Transit times', d: 'Estimated delivery between hubs' },
];

function showQuickActions() {
  messagesEl.innerHTML = `
    <div class="quick">
      <p class="quick-greet">Hi ${esc(currentUser?.username || '')} 👋 — how can the Air Master Agent help today?</p>
      <div class="quick-grid">
        ${QUICK.map((q, i) => `<button class="quick-chip" data-q="${i}"><strong>${q.t}</strong><span>${q.d}</span></button>`).join('')}
      </div>
    </div>`;
  messagesEl.querySelectorAll('.quick-chip').forEach((chip) => {
    chip.addEventListener('click', () => sendMessage(QUICK[chip.dataset.q].t));
  });
}

function addBubble(role, content) {
  // Clear quick actions if present
  const quick = messagesEl.querySelector('.quick');
  if (quick) quick.remove();

  const row = document.createElement('div');
  row.className = 'row ' + role;
  const name = role === 'agent' ? 'Air Master Agent' : 'You';
  const avatar = role === 'agent'
    ? `<div class="row-avatar agent"><img src="/air_master_logo.webp" alt="A"></div>`
    : `<div class="row-avatar user">👤</div>`;
  row.innerHTML = `
    ${avatar}
    <div class="bubble-wrap">
      <div class="bubble-head"><span class="bubble-name">${name}</span><span class="bubble-time">${timeNow()}</span></div>
      <div class="bubble ${role}">${esc(content)}</div>
    </div>`;
  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return row;
}

function addTyping() {
  const row = document.createElement('div');
  row.className = 'row agent';
  row.id = 'typingRow';
  row.innerHTML = `
    <div class="row-avatar agent"><img src="/air_master_logo.webp" alt="A"></div>
    <div class="bubble agent" style="padding:0"><div class="typing"><span></span><span></span><span></span></div></div>`;
  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}
function removeTyping() { document.getElementById('typingRow')?.remove(); }

async function sendMessage(text) {
  text = (text || '').trim();
  if (!text || isTyping) return;
  addBubble('user', text);
  chatInput.value = '';
  autoResize();
  isTyping = true;
  sendBtn.disabled = true;
  addTyping();

  try {
    const res = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, session_id: activeSessionId }),
    });
    const data = await res.json();
    removeTyping();
    if (!res.ok) throw new Error(data.error || 'Agent error.');
    if (!activeSessionId) {
      activeSessionId = data.session_id;
      threadsLoaded = false;
    }
    addBubble('agent', data.reply);
    if (data.isNew) { loadThreads(); refreshTitle(); }
  } catch (err) {
    removeTyping();
    addBubble('agent', '⚠️ ' + err.message);
  } finally {
    isTyping = false;
    sendBtn.disabled = false;
    chatInput.focus();
  }
}

chatForm.addEventListener('submit', (e) => { e.preventDefault(); sendMessage(chatInput.value); });
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(chatInput.value); }
});
function autoResize() {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 140) + 'px';
}
chatInput.addEventListener('input', autoResize);

document.getElementById('newChatBtn').addEventListener('click', () => {
  activeSessionId = null;
  activeThreadName = null;
  threadTitleEl.textContent = 'Air Master Agent';
  renameBtn.hidden = true;
  document.querySelectorAll('.thread').forEach((t) => t.classList.remove('active'));
  showQuickActions();
  chatInput.focus();
});

// non-functional UI buttons
document.getElementById('attachBtn').addEventListener('click', () =>
  addInfo('📎 File attachments are coming soon.'));
document.getElementById('micBtn').addEventListener('click', () =>
  addInfo('🎙 Voice input is coming soon.'));
function addInfo(msg) {
  const quick = messagesEl.querySelector('.quick');
  if (quick) quick.remove();
  addBubble('agent', msg);
}

// ── Threads ──
async function loadThreads() {
  try {
    const res = await fetch('/api/chat-history/threads');
    const { threads } = await res.json();
    threadsLoaded = true;
    if (!threads || threads.length === 0) {
      threadListEl.innerHTML = `<p class="threads-empty">No conversations yet.</p>`;
      if (!activeSessionId) showQuickActions();
      return;
    }
    threadListEl.innerHTML = threads.map((t) => `
      <div class="thread ${t.id === activeSessionId ? 'active' : ''}" data-id="${t.id}">
        <span class="thread-name">${esc(t.name || 'Untitled')}</span>
        <button class="thread-del" data-del="${t.id}" title="Delete">🗑</button>
      </div>`).join('');
    threadListEl.querySelectorAll('.thread').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.dataset.del) return;
        openThread(el.dataset.id, el.querySelector('.thread-name').textContent);
      });
    });
    threadListEl.querySelectorAll('.thread-del').forEach((b) => {
      b.addEventListener('click', (e) => { e.stopPropagation(); deleteThread(b.dataset.del); });
    });
    if (!activeSessionId) showQuickActions();
  } catch {
    threadListEl.innerHTML = `<p class="threads-empty">Failed to load.</p>`;
  }
}

async function openThread(id, name) {
  activeSessionId = id;
  activeThreadName = name;
  threadTitleEl.textContent = name;
  renameBtn.hidden = false;
  document.querySelectorAll('.thread').forEach((t) => t.classList.toggle('active', t.dataset.id === id));
  messagesEl.innerHTML = '';
  try {
    const res = await fetch('/api/chat-history?session_id=' + id);
    const { messages } = await res.json();
    messages.forEach((m) => addBubble(m.role === 'assistant' ? 'agent' : 'user', m.content));
    if (messages.length === 0) showQuickActions();
  } catch {
    addBubble('agent', '⚠️ Failed to load conversation.');
  }
}

function refreshTitle() {
  if (activeSessionId) renameBtn.hidden = false;
}

renameBtn.addEventListener('click', async () => {
  const next = prompt('Rename conversation:', threadTitleEl.textContent);
  if (!next || !next.trim() || !activeSessionId) return;
  const name = next.trim();
  threadTitleEl.textContent = name;
  await fetch('/api/chat-history/threads/' + activeSessionId, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  loadThreads();
});

async function deleteThread(id) {
  if (!confirm('Delete this conversation?')) return;
  await fetch('/api/chat-history/threads/' + id, { method: 'DELETE' });
  if (id === activeSessionId) {
    activeSessionId = null;
    threadTitleEl.textContent = 'Air Master Agent';
    renameBtn.hidden = true;
    showQuickActions();
  }
  loadThreads();
}

// ════════════════════════════════════════════════════════════════════
//  BUILD UP PLAN — dynamic aircraft main-deck canvas
//  Standard PAG 224×318cm: 11 PAG (A1–A11) + 1 AKE/PKC (P12)
//  Data-driven & future-ready: swap `load` from a live API later.
// ════════════════════════════════════════════════════════════════════
// Empty position templates per family (limits from the EgyptAir B737-800SF manual).
const FAMILY_POSITIONS = {
  PMC: [['M1',2494],['M2',2948],['M3',2948],['M4',2948],['M5',3628],['M6',3628],
        ['M7',2948],['M8',2948],['M9',2948],['M10',2494],['P12',1133]],
  PAG: [['A1',1814],['A2',2948],['A3',2948],['A4',2948],['A5',3628],['A6',3628],
        ['A7',2948],['A8',2948],['A9',2948],['A10',2948],['A11',1814],['P12',1133]],
};
function emptyPositions(fam) {
  return (FAMILY_POSITIONS[fam] || FAMILY_POSITIONS.PMC).map(
    ([id, limit]) => ({ id, type: id === 'P12' ? 'AKE/PKC' : fam, limit, load: 0, pallet: null }));
}
let buFamily = 'PMC';
let BU_POSITIONS = emptyPositions(buFamily);

let buInited = false;
let buCanvas, buCtx, buSlots = [], buHover = -1, buSelected = -1;
const buEditor = () => document.getElementById('buEditor');

function buColor(pct) {
  if (pct > 100) return { fill: '#7f1d1d', bar: '#991b1b' };
  if (pct >= 90) return { fill: '#dc2626', bar: '#ef4444' };
  if (pct >= 70) return { fill: '#d97706', bar: '#f59e0b' };
  return { fill: '#16a34a', bar: '#22c55e' };
}

function initBuildup() {
  if (buInited) { drawBuildup(); return; }
  buInited = true;
  buCanvas = document.getElementById('buildupCanvas');
  buCtx = buCanvas.getContext('2d');

  buCanvas.addEventListener('mousemove', (e) => {
    const r = buCanvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const prev = buHover;
    buHover = buSlots.findIndex((s) => x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h);
    buCanvas.style.cursor = buHover >= 0 ? 'pointer' : 'default';
    if (buHover !== prev) drawBuildup();
  });
  buCanvas.addEventListener('mouseleave', () => { if (buHover !== -1) { buHover = -1; drawBuildup(); } });
  buCanvas.addEventListener('click', (e) => {
    const r = buCanvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const i = buSlots.findIndex((s) => x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h);
    if (i >= 0) selectPosition(i);
  });

  window.addEventListener('resize', () => { if (document.getElementById('view-buildup').classList.contains('active')) drawBuildup(); });

  // editor inputs
  const loadInput = document.getElementById('buEditLoad');
  const loadRange = document.getElementById('buEditLoadRange');
  loadInput.addEventListener('input', () => {
    if (buSelected < 0) return;
    const p = BU_POSITIONS[buSelected];
    p.load = Math.max(0, Number(loadInput.value) || 0);
    loadRange.value = Math.min(100, Math.round((p.load / p.limit) * 100));
    refreshEditor(); drawBuildup(); renderBuTotals();
  });
  loadRange.addEventListener('input', () => {
    if (buSelected < 0) return;
    const p = BU_POSITIONS[buSelected];
    p.load = Math.round((Number(loadRange.value) / 100) * p.limit);
    loadInput.value = p.load;
    refreshEditor(); drawBuildup(); renderBuTotals();
  });

  document.getElementById('buReset').addEventListener('click', () => {
    BU_POSITIONS = emptyPositions(buFamily);
    buSelected = -1; buEditor().hidden = true;
    document.getElementById('buResultCard').hidden = true;
    document.getElementById('buPlanStatus').textContent = '';
    drawBuildup(); renderBuTotals();
  });
  document.getElementById('buSample').addEventListener('click', loadSampleManifest);
  document.getElementById('buRun').addEventListener('click', runEnginePlan);
  document.getElementById('buFamily').addEventListener('change', (e) => {
    buFamily = e.target.value;
    BU_POSITIONS = emptyPositions(buFamily);
    buSelected = -1; buEditor().hidden = true;
    document.getElementById('buResultCard').hidden = true;
    const w = buFamily === 'PAG' ? '224' : '244';
    const n = buFamily === 'PAG' ? '11 PAG' : '10 PMC';
    document.getElementById('buSub').textContent = `Standard ${buFamily} — ${w} × 318 cm · ${n} + 1 AKE/PKC`;
    drawBuildup(); renderBuTotals();
  });

  renderBuTotals();
  drawBuildup();
}

// ── Manifest parsing + engine call ───────────────────────────────────
// Accepts lines like:  "ENGINE: 150x120x90, 2200"  or  "120x100x80, 2000"
function parseManifest(text) {
  const boxes = [], errors = [];
  text.split('\n').forEach((line, idx) => {
    const raw = line.trim();
    if (!raw) return;
    let id = null, rest = raw;
    const colon = raw.indexOf(':');
    if (colon > 0 && !/^\d/.test(raw)) { id = raw.slice(0, colon).trim(); rest = raw.slice(colon + 1); }
    const m = rest.match(/(\d+)\s*[x×]\s*(\d+)\s*[x×]\s*(\d+)\s*,\s*(\d+)/i);
    if (!m) { errors.push(`Line ${idx + 1}: "${raw}"`); return; }
    boxes.push({ id: id || `BOX_${boxes.length + 1}`,
      length: +m[1], width: +m[2], height: +m[3], weight: +m[4] });
  });
  return { boxes, errors };
}

function loadSampleManifest() {
  const sample = buFamily === 'PAG'
    ? ['PAG_A: 100x100x80, 1500', 'PAG_B: 100x100x80, 1500', 'PAG_C: 100x100x80, 1500',
       'PAG_D: 100x100x80, 1000', 'PAG_E: 100x100x80, 1000', 'SMALL_1: 60x50x40, 300',
       'SMALL_2: 60x50x40, 300', 'SMALL_3: 60x50x40, 300']
    : ['ENGINE: 150x120x90, 2200', 'PUMP_A: 120x100x80, 2000', 'PUMP_B: 120x100x80, 1800',
       'CRATE_1: 120x100x80, 1500', 'CRATE_2: 120x100x80, 1500', 'BOX_S: 80x60x50, 600',
       'OVERSIZE: 600x40x40, 300'];
  document.getElementById('buManifest').value = sample.join('\n');
  document.getElementById('buPlanStatus').textContent = 'Sample loaded — press “Run Plan”.';
}

async function runEnginePlan() {
  const status = document.getElementById('buPlanStatus');
  const runBtn = document.getElementById('buRun');
  const { boxes, errors } = parseManifest(document.getElementById('buManifest').value);
  if (errors.length) { status.innerHTML = `<span class="ps-bad">Could not parse: ${errors.join('; ')}</span>`; return; }
  if (!boxes.length) { status.innerHTML = `<span class="ps-bad">Add at least one item to the manifest.</span>`; return; }

  runBtn.disabled = true;
  status.innerHTML = `<span class="ps-busy">Running engine on ${boxes.length} item(s)…</span>`;
  try {
    const res = await fetch('/api/loadplan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ family: buFamily, boxes }),
    });
    const data = await res.json();
    if (!res.ok && !data.positions) {
      status.innerHTML = `<span class="ps-bad">${data.error || 'Engine error.'}</span>`;
      runBtn.disabled = false; return;
    }
    applyPlan(data);
  } catch (e) {
    status.innerHTML = `<span class="ps-bad">Request failed: ${e.message}</span>`;
  } finally {
    runBtn.disabled = false;
  }
}

function applyPlan(data) {
  // Rebuild the deck from the engine's position payload.
  if (Array.isArray(data.positions) && data.positions.length) {
    BU_POSITIONS = data.positions.map((p) => ({ id: p.id, type: p.type, limit: p.limit, load: p.load, pallet: p.pallet }));
  }
  buSelected = -1; buEditor().hidden = true;
  drawBuildup(); renderBuTotals();
  renderPlanResult(data);
}

function renderPlanResult(data) {
  const status = document.getElementById('buPlanStatus');
  const card = document.getElementById('buResultCard');
  const body = document.getElementById('buResultBody');
  const t = data.totals || {};

  const STATUS_TEXT = {
    OK: ['ps-ok', '✓ Legal, balanced & re-validated'],
    INFEASIBLE: ['ps-bad', '✗ No legal balance found'],
    NO_PALLETS: ['ps-bad', '✗ No pallets could be built'],
    REVALIDATION_FAILED: ['ps-bad', '✗ Plan rejected by re-validator'],
    ERROR: ['ps-bad', '✗ Engine error'],
  };
  const [cls, label] = STATUS_TEXT[data.status] || ['ps-bad', data.status || 'Error'];
  status.innerHTML = `<span class="${cls}">${label}</span> · ${t.pallets_built || 0} pallets · `
    + `${(t.packed_weight || 0).toLocaleString()} / ${(t.payload_limit || 0).toLocaleString()} kg · ${data.runtime_s ?? '—'}s`;

  let html = '';
  if (data.cg) {
    const c = data.cg;
    const span = c.aft_limit - c.fwd_limit;
    const pos = Math.max(0, Math.min(100, ((c.arm - c.fwd_limit) / span) * 100));
    const tpos = Math.max(0, Math.min(100, ((c.target - c.fwd_limit) / span) * 100));
    const inEnv = c.arm >= c.fwd_limit && c.arm <= c.aft_limit;
    html += `<div class="cg-block">
      <div class="cg-row"><span>Centre of Gravity</span>
        <strong class="${inEnv ? 'cg-ok' : 'cg-bad'}">${c.arm} in</strong></div>
      <div class="cg-bar">
        <div class="cg-target" style="left:${tpos}%" title="Target ${c.target}"></div>
        <div class="cg-marker ${inEnv ? '' : 'bad'}" style="left:${pos}%"></div>
      </div>
      <div class="cg-scale"><span>${c.fwd_limit} (fwd)</span><span>target ${c.target}</span><span>${c.aft_limit} (aft)</span></div>
      <p class="cg-note">Envelope shown is a provisional operational guard pending the certified AFM CG envelope.</p>
    </div>`;
  }

  const v = data.validation || {};
  html += `<div class="val-block ${v.ok ? 'val-ok' : 'val-bad'}">`
    + `<strong>${v.ok ? '✓ All hard limits satisfied (independent re-validation)' : '✗ Validation issues'}</strong>`;
  if (v.violations && v.violations.length) html += '<ul>' + v.violations.map((x) => `<li>${x}</li>`).join('') + '</ul>';
  html += '</div>';

  if (data.rejected && data.rejected.length) {
    html += `<div class="rej-block"><strong>${data.rejected.length} item(s) rejected by build-up:</strong><ul>`
      + data.rejected.map((r) => `<li>${r.id} (${r.dims}, ${r.weight}kg) — ${r.reason}</li>`).join('') + '</ul></div>';
  }

  if (data.pallets && data.pallets.length) {
    html += `<div class="plt-block"><strong>Pallets built (${data.pallets.length}):</strong><ul>`
      + data.pallets.map((p) => `<li>${p.id} → ${p.position || '(unassigned)'} · ${p.weight}kg · ${p.height}cm · [${p.boxes.join(', ')}]</li>`).join('')
      + '</ul></div>';
  }

  body.innerHTML = html;
  card.hidden = false;
}

function renderBuTotals() {
  const totLimit = BU_POSITIONS.reduce((a, p) => a + p.limit, 0);
  const totLoad = BU_POSITIONS.reduce((a, p) => a + p.load, 0);
  const used = BU_POSITIONS.filter((p) => p.load > 0).length;
  const over = BU_POSITIONS.filter((p) => p.load > p.limit).length;
  const pct = Math.round((totLoad / totLimit) * 100);
  document.getElementById('buTotals').innerHTML = `
    <div class="bu-total"><div class="lbl">Total Capacity</div><div class="val">${totLimit.toLocaleString()} kg</div><div class="meta">12 positions</div></div>
    <div class="bu-total"><div class="lbl">Total Loaded</div><div class="val">${totLoad.toLocaleString()} kg</div><div class="meta">${pct}% utilized</div></div>
    <div class="bu-total"><div class="lbl">Positions Used</div><div class="val">${used} / 12</div><div class="meta">${12 - used} free</div></div>
    <div class="bu-total" style="border-left-color:${over ? '#dc2626' : '#16a34a'}"><div class="lbl">Overweight</div><div class="val">${over}</div><div class="meta">${over ? 'Attention needed' : 'All within limits'}</div></div>`;
}

function selectPosition(i) {
  buSelected = i;
  buEditor().hidden = false;
  refreshEditor();
  drawBuildup();
  buEditor().scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function refreshEditor() {
  if (buSelected < 0) return;
  const p = BU_POSITIONS[buSelected];
  const pct = Math.round((p.load / p.limit) * 100);
  document.getElementById('buEditTitle').textContent = 'Position ' + p.id;
  document.getElementById('buEditPos').textContent = p.id;
  document.getElementById('buEditType').textContent = p.type;
  document.getElementById('buEditLimit').textContent = p.limit.toLocaleString() + ' kg';
  document.getElementById('buEditLoad').value = p.load;
  document.getElementById('buEditLoad').max = p.limit;
  document.getElementById('buEditLoadRange').value = Math.min(100, pct);
  const pctEl = document.getElementById('buEditPct');
  pctEl.textContent = pct + '%';
  pctEl.style.color = buColor(pct).fill;
}

function drawBuildup() {
  if (!buCanvas) return;
  const wrap = buCanvas.parentElement;
  const cssW = Math.max(720, wrap.clientWidth - 16);
  const cssH = 300;
  const dpr = window.devicePixelRatio || 1;
  buCanvas.width = cssW * dpr;
  buCanvas.height = cssH * dpr;
  buCanvas.style.height = cssH + 'px';
  const ctx = buCtx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const n = BU_POSITIONS.length;
  const padL = 70, padR = 80, padT = 60, padB = 40;
  const noseW = 60, tailW = 70;
  const bodyL = padL + noseW;
  const bodyR = cssW - padR - tailW;
  const bodyW = bodyR - bodyL;
  const cy = (padT + (cssH - padB)) / 2;
  const fuseTop = padT, fuseBot = cssH - padB;
  const fuseH = fuseBot - fuseTop;

  // ── Fuselage outline (nose left → tail right) ──
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(padL, cy);                                   // nose tip
  ctx.quadraticCurveTo(bodyL - 18, fuseTop, bodyL, fuseTop);
  ctx.lineTo(bodyR, fuseTop);                             // top edge
  ctx.quadraticCurveTo(bodyR + tailW, fuseTop + 6, cssW - padR + 6, cy - 16); // tail upper
  ctx.lineTo(cssW - padR + 6, cy + 16);                   // tail end
  ctx.quadraticCurveTo(bodyR + tailW, fuseBot - 6, bodyR, fuseBot); // tail lower
  ctx.lineTo(bodyL, fuseBot);                             // bottom edge
  ctx.quadraticCurveTo(bodyL - 18, fuseBot, padL, cy);   // nose
  ctx.closePath();
  const g = ctx.createLinearGradient(0, fuseTop, 0, fuseBot);
  g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#f1f3f6');
  ctx.fillStyle = g;
  ctx.shadowColor = 'rgba(0,0,0,0.08)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = '#cfd4da'; ctx.lineWidth = 2; ctx.stroke();

  // cockpit window hint
  ctx.beginPath();
  ctx.arc(padL + 22, cy, 8, -Math.PI / 2.2, Math.PI / 2.2);
  ctx.strokeStyle = '#b8bec6'; ctx.lineWidth = 2; ctx.stroke();
  // tail fin
  ctx.beginPath();
  ctx.moveTo(bodyR + 6, fuseTop + 2);
  ctx.lineTo(bodyR + 40, fuseTop - 30);
  ctx.lineTo(bodyR + 54, fuseTop - 28);
  ctx.lineTo(bodyR + 30, fuseTop + 2);
  ctx.closePath();
  ctx.fillStyle = '#e02230'; ctx.fill();
  ctx.restore();

  // ── Position slots ──
  const gap = 6;
  const slotW = (bodyW - gap * (n - 1)) / n;
  const slotH = fuseH - 36;
  const slotY = fuseTop + 18;
  buSlots = [];

  BU_POSITIONS.forEach((p, i) => {
    const x = bodyL + i * (slotW + gap);
    buSlots.push({ x, y: slotY, w: slotW, h: slotH });
    const pct = p.limit ? (p.load / p.limit) * 100 : 0;
    const col = buColor(pct);
    const isHover = i === buHover, isSel = i === buSelected;

    // slot base
    ctx.save();
    roundRect(ctx, x, slotY, slotW, slotH, 7);
    ctx.fillStyle = p.load > 0 ? '#ffffff' : '#f7f8fa';
    ctx.fill();

    // usage fill (bottom-up)
    if (p.load > 0) {
      const fh = Math.min(slotH, slotH * Math.min(pct, 100) / 100);
      ctx.save();
      roundRect(ctx, x, slotY, slotW, slotH, 7); ctx.clip();
      const fg = ctx.createLinearGradient(0, slotY + slotH - fh, 0, slotY + slotH);
      fg.addColorStop(0, col.bar); fg.addColorStop(1, col.fill);
      ctx.fillStyle = fg;
      ctx.fillRect(x, slotY + slotH - fh, slotW, fh);
      ctx.restore();
    }

    // border
    roundRect(ctx, x, slotY, slotW, slotH, 7);
    ctx.lineWidth = isSel ? 3 : isHover ? 2.5 : 1.5;
    ctx.strokeStyle = isSel ? '#e02230' : isHover ? '#b81a26' : '#c9ced5';
    ctx.stroke();

    // text: position id (top)
    ctx.fillStyle = pct > 35 ? '#ffffff' : '#1a1d21';
    ctx.textAlign = 'center';
    ctx.font = '700 13px -apple-system, sans-serif';
    ctx.fillText(p.id, x + slotW / 2, slotY + 18);
    // type
    ctx.font = '600 8.5px -apple-system, sans-serif';
    ctx.fillStyle = pct > 45 ? 'rgba(255,255,255,0.85)' : '#9aa1ab';
    ctx.fillText(p.type, x + slotW / 2, slotY + 30);

    // weight (bottom)
    ctx.fillStyle = pct > 12 ? '#ffffff' : '#6b7280';
    ctx.font = '700 10px -apple-system, sans-serif';
    ctx.fillText(p.load > 0 ? p.load + 'kg' : '—', x + slotW / 2, slotY + slotH - 18);
    ctx.font = '500 8px -apple-system, sans-serif';
    ctx.fillStyle = pct > 12 ? 'rgba(255,255,255,0.8)' : '#9aa1ab';
    ctx.fillText('/' + p.limit, x + slotW / 2, slotY + slotH - 7);

    // % badge for loaded
    if (p.load > 0) {
      ctx.font = '800 9px -apple-system, sans-serif';
      ctx.fillStyle = pct > 35 ? '#ffffff' : col.fill;
      ctx.fillText(Math.round(pct) + '%', x + slotW / 2, slotY + slotH / 2 + 3);
    }
    ctx.restore();
  });

  // labels
  ctx.fillStyle = '#9aa1ab'; ctx.font = '600 11px -apple-system, sans-serif';
  ctx.textAlign = 'left'; ctx.fillText('◀ NOSE', padL - 6, padT - 18);
  ctx.textAlign = 'right'; ctx.fillText('TAIL ▶', cssW - padR + 6, padT - 18);
  ctx.textAlign = 'center'; ctx.fillStyle = '#6b7280'; ctx.font = '700 12px -apple-system, sans-serif';
  const fw = buFamily === 'PAG' ? '224' : '244';
  ctx.fillText(`MAIN DECK CARGO COMPARTMENT — ${buFamily} ${fw} × 318 CM`, cssW / 2, padT - 18);
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
