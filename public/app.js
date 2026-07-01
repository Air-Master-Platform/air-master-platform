'use strict';

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// Build Up Plan state — declared first so initBuildup() (a hoisted function
// reachable from the nav handler) can never hit the temporal dead zone, even if
// some later top-level statement throws before its original declaration ran.
let buInited = false;
let buCanvas, buCtx, buSlots = [], buHover = -1, buSelected = -1;

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
      try {
        initBuildup();
      } catch (err) {
        console.error('Build Up Plan init failed:', err);
        const sec = document.getElementById('view-buildup');
        const note = document.getElementById('buInitError') || document.createElement('div');
        note.id = 'buInitError';
        note.style.cssText = 'margin:16px;padding:12px 14px;border-radius:10px;'
          + 'background:#fef2f2;color:#991b1b;font-size:13px;';
        note.textContent = 'Build Up Plan failed to load: ' + (err && err.message || err);
        if (!note.parentElement) sec.prepend(note);
      }
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
    { label: 'Active Shipments', value: '1,284', icon: 'i-package', up: true, sub: '+8.2% vs last month' },
    { label: 'In Transit', value: '342', icon: 'i-plane', up: true, sub: '27 arriving today' },
    { label: 'On-Time Rate', value: '99.2%', icon: 'i-timer', up: true, sub: '+0.4% this quarter' },
    { label: 'Revenue (MTD)', value: '$2.4M', icon: 'i-dollar', up: false, sub: '-1.1% vs target' },
  ];
  document.getElementById('metrics').innerHTML = metrics.map((m) => `
    <div class="metric">
      <div class="metric-strip"></div>
      <div class="metric-body">
        <div class="metric-top">
          <span class="metric-label">${m.label}</span>
          <span class="metric-icon"><svg class="icon"><use href="#${m.icon}"/></svg></span>
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
      <div class="list-ico"><svg class="icon"><use href="#i-package"/></svg></div>
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

// ── Shipment item popup ─────────────────────────────────────────
const itemModal = document.getElementById('itemModal');
const itemForm = document.getElementById('itemForm');
function openItemModal() {
  if (!itemModal || !itemForm) return;
  itemForm.reset();
  document.getElementById('imQty').value = '1';
  itemModal.hidden = false;
  setTimeout(() => document.getElementById('imLen').focus(), 30);
}
function closeItemModal() { if (itemModal) itemModal.hidden = true; }

// Bind null-safe: if the modal markup isn't present (e.g. a stale cached page),
// these no-op instead of throwing and halting the rest of the script.
const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
on('addItemBtn', 'click', openItemModal);
on('itemModalClose', 'click', closeItemModal);
on('itemCancel', 'click', closeItemModal);
on('itemModalBackdrop', 'click', closeItemModal);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && itemModal && !itemModal.hidden) closeItemModal();
});

if (itemForm) itemForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('imName').value.trim();
  const L = +document.getElementById('imLen').value;
  const W = +document.getElementById('imWid').value;
  const H = +document.getElementById('imHei').value;
  const wt = +document.getElementById('imWt').value;
  const qty = Math.max(1, Math.floor(+document.getElementById('imQty').value || 1));
  if (!(L > 0 && W > 0 && H > 0 && wt > 0)) return;
  // Send a precise, labelled line the agent cannot misread.
  const label = name ? `${name}: ` : '';
  const msg = `Shipment item — ${label}Length ${L} cm, Width ${W} cm, Height ${H} cm, `
    + `Weight ${wt} kg, Quantity ${qty}.`;
  closeItemModal();
  sendMessage(msg);
});

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

// FWD (nose-side) and AFT (tail-side) balance groups — exactly the positions
// in the engine's cumulative forward/aft load limits (aircraft_config.py).
// The middle position (M6 / A6) is the neutral pivot and belongs to neither.
const FWD_POS = { PMC: ['M1', 'M2', 'M3', 'M4', 'M5'], PAG: ['A1', 'A2', 'A3', 'A4', 'A5'] };
const AFT_POS = { PMC: ['M7', 'M8', 'M9', 'M10', 'P12'], PAG: ['A7', 'A8', 'A9', 'A10', 'A11', 'P12'] };
const FWD_TINT = { fill: 'rgba(96,140,200,0.13)', line: 'rgba(120,164,220,0.55)', hex: 0x5a8cd0, css: '#7aa4dc' };
const AFT_TINT = { fill: 'rgba(224,150,80,0.13)', line: 'rgba(230,168,96,0.55)', hex: 0xe09650, css: '#e0a866' };
let buFamily = 'PMC';
let BU_POSITIONS = emptyPositions(buFamily);

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
    setManifestRows([]);
    drawBuildup(); updateBuildup3D(); renderBuTotals();
  });
  document.getElementById('buSample').addEventListener('click', loadSampleManifest);
  document.getElementById('buRun').addEventListener('click', runEnginePlan);

  // 2D / 3D view toggle
  document.getElementById('buView2D').addEventListener('click', () => setBuView('2d'));
  document.getElementById('buView3D').addEventListener('click', () => setBuView('3d'));

  // manifest row controls
  document.getElementById('buAddRow').addEventListener('click', () => addManifestRow());
  document.getElementById('buTemplate').addEventListener('click', downloadTemplate);
  const fileInput = document.getElementById('buFile');
  fileInput.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) importManifestFile(f);
    e.target.value = '';                    // allow re-importing the same file
  });
  setManifestRows([]);                      // start with one empty row
  document.getElementById('buFamily').addEventListener('change', (e) => {
    buFamily = e.target.value;
    BU_POSITIONS = emptyPositions(buFamily);
    buSelected = -1; buEditor().hidden = true;
    document.getElementById('buResultCard').hidden = true;
    const w = buFamily === 'PAG' ? '224' : '244';
    const n = buFamily === 'PAG' ? '11 PAG' : '10 PMC';
    document.getElementById('buSub').textContent = `Standard ${buFamily} — ${w} × 318 cm · ${n} + 1 AKE/PKC`;
    drawBuildup(); updateBuildup3D(); renderBuTotals();
  });

  renderBuTotals();
  drawBuildup();
}

// ── Structured manifest rows ─────────────────────────────────────────
// Each row is one item type: name, L×W×H (cm), weight (kg), quantity.
// On run, a row with quantity n expands into n boxes (NAME_1 … NAME_n).
const SAMPLES = {
  PMC: [
    { name: 'ENGINE',  length: 150, width: 120, height: 90, weight: 2200, qty: 1 },
    { name: 'PUMP',    length: 120, width: 100, height: 80, weight: 2000, qty: 2 },
    { name: 'CRATE',   length: 120, width: 100, height: 80, weight: 1500, qty: 2 },
    { name: 'BOX_S',   length: 80,  width: 60,  height: 50, weight: 600,  qty: 1 },
    { name: 'OVERSIZE', length: 600, width: 40, height: 40, weight: 300,  qty: 1 },
  ],
  PAG: [
    { name: 'PAG_A',  length: 100, width: 100, height: 80, weight: 1500, qty: 3 },
    { name: 'PAG_D',  length: 100, width: 100, height: 80, weight: 1000, qty: 2 },
    { name: 'SMALL',  length: 60,  width: 50,  height: 40, weight: 300,  qty: 3 },
  ],
};

function mfRowsEl() { return document.getElementById('buRows'); }

function addManifestRow(item = {}) {
  const row = document.createElement('div');
  row.className = 'mf-row';
  const n = (v) => (v === undefined || v === null ? '' : v);
  row.innerHTML =
    `<input class="mf-name" type="text" placeholder="Item name" value="${n(item.name)}" />
     <input class="mf-len"  type="number" min="1" inputmode="numeric" placeholder="L" value="${n(item.length)}" />
     <input class="mf-wid"  type="number" min="1" inputmode="numeric" placeholder="W" value="${n(item.width)}" />
     <input class="mf-hei"  type="number" min="1" inputmode="numeric" placeholder="H" value="${n(item.height)}" />
     <input class="mf-wt"   type="number" min="1" inputmode="numeric" placeholder="kg" value="${n(item.weight)}" />
     <input class="mf-qty"  type="number" min="1" inputmode="numeric" value="${item.qty ? item.qty : 1}" />
     <button class="mf-del" type="button" title="Remove item">✕</button>`;
  row.querySelector('.mf-del').addEventListener('click', () => {
    row.remove();
    if (!mfRowsEl().children.length) addManifestRow();
  });
  mfRowsEl().appendChild(row);
  return row;
}

function setManifestRows(items) {
  mfRowsEl().innerHTML = '';
  if (!items || !items.length) { addManifestRow(); return; }
  items.forEach((it) => addManifestRow(it));
}

// Read rows → { boxes, errors }. Quantity expands into individual boxes.
function collectManifestBoxes() {
  const boxes = [], errors = [];
  const seen = {};
  const rows = Array.from(mfRowsEl().querySelectorAll('.mf-row'));
  rows.forEach((row, i) => {
    const name = row.querySelector('.mf-name').value.trim();
    const L = +row.querySelector('.mf-len').value;
    const W = +row.querySelector('.mf-wid').value;
    const H = +row.querySelector('.mf-hei').value;
    const wt = +row.querySelector('.mf-wt').value;
    const qty = Math.max(1, Math.floor(+row.querySelector('.mf-qty').value || 1));
    // Skip fully-empty rows silently.
    if (!name && !L && !W && !H && !wt) return;
    if (!(L > 0 && W > 0 && H > 0 && wt > 0)) {
      errors.push(`Row ${i + 1}${name ? ` (${name})` : ''}: fill L, W, H and weight with positive numbers.`);
      return;
    }
    const base = (name || `BOX_${i + 1}`).replace(/\s+/g, '_');
    for (let q = 1; q <= qty; q++) {
      let id = qty > 1 ? `${base}_${q}` : base;
      while (seen[id]) id += '*';           // guarantee uniqueness across rows
      seen[id] = true;
      boxes.push({ id, length: L, width: W, height: H, weight: wt });
    }
  });
  return { boxes, errors };
}

function loadSampleManifest() {
  setManifestRows(SAMPLES[buFamily] || SAMPLES.PMC);
  document.getElementById('buPlanStatus').innerHTML =
    '<span class="ps-busy">Sample loaded — press “Run Plan”.</span>';
}

// ── Excel / CSV import ────────────────────────────────────────────────
// Flexible header matching so common column names just work.
const COL_ALIASES = {
  name:   ['name', 'item', 'description', 'cargo', 'id'],
  length: ['length', 'len', 'l', 'long'],
  width:  ['width', 'wid', 'w'],
  height: ['height', 'hei', 'h', 'tall'],
  weight: ['weight', 'wt', 'kg', 'mass'],
  qty:    ['quantity', 'qty', 'q', 'count', 'pieces', 'pcs'],
};
function matchCol(header) {
  const h = String(header).trim().toLowerCase().replace(/\s|\(.*\)|_/g, '');
  for (const key in COL_ALIASES) {
    if (COL_ALIASES[key].some((a) => a === h)) return key;
  }
  return null;
}

function importManifestFile(file) {
  const status = document.getElementById('buPlanStatus');
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
      if (!rows.length) throw new Error('empty sheet');
      // Locate header row (first row that maps at least one known column).
      let hIdx = rows.findIndex((r) => r.some((c) => matchCol(c)));
      if (hIdx < 0) throw new Error('no recognizable columns (need name, length, width, height, weight, quantity)');
      const map = rows[hIdx].map(matchCol);
      const items = [];
      for (let r = hIdx + 1; r < rows.length; r++) {
        const cells = rows[r];
        if (!cells || !cells.length) continue;
        const it = { qty: 1 };
        map.forEach((key, c) => { if (key && cells[c] !== '' && cells[c] != null) it[key] = cells[c]; });
        if (it.name || it.length || it.weight) items.push(it);
      }
      if (!items.length) throw new Error('no data rows found');
      setManifestRows(items);
      status.innerHTML = `<span class="ps-ok">Imported ${items.length} item(s) from ${file.name}. Review &amp; press “Run Plan”.</span>`;
    } catch (err) {
      status.innerHTML = `<span class="ps-bad">Could not read “${file.name}”: ${err.message}</span>`;
    }
  };
  reader.onerror = () => { status.innerHTML = `<span class="ps-bad">Failed to read file.</span>`; };
  reader.readAsArrayBuffer(file);
}

function downloadTemplate() {
  const csv = 'name,length,width,height,weight,quantity\n'
    + 'ENGINE,150,120,90,2200,1\n'
    + 'PUMP,120,100,80,2000,2\n'
    + 'CRATE,120,100,80,1500,2\n';
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'manifest_template.csv';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ── Engine call ───────────────────────────────────────────────────────
async function runEnginePlan() {
  const status = document.getElementById('buPlanStatus');
  const runBtn = document.getElementById('buRun');
  const { boxes, errors } = collectManifestBoxes();
  if (errors.length) { status.innerHTML = `<span class="ps-bad">${errors.join('<br>')}</span>`; return; }
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
  lastPlanData = data; // keep for the 3D readout + real pallet heights
  buSelected = -1; buEditor().hidden = true;
  drawBuildup(); updateBuildup3D(); renderBuTotals();
  renderPlanResult(data);
}

function setBuView(mode) {
  const is3D = mode === '3d';
  document.getElementById('bu2DCard').hidden = is3D;
  document.getElementById('bu3DCard').hidden = !is3D;
  const btn2D = document.getElementById('buView2D'), btn3D = document.getElementById('buView3D');
  btn2D.classList.toggle('active', !is3D); btn2D.setAttribute('aria-selected', String(!is3D));
  btn3D.classList.toggle('active', is3D); btn3D.setAttribute('aria-selected', String(is3D));
  if (is3D) updateBuildup3D();
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
      ${renderHorizonGauge(c, inEnv)}
      <div class="cg-bar">
        <div class="cg-target" style="left:${tpos}%" title="Target ${c.target}"></div>
        <div class="cg-marker ${inEnv ? '' : 'bad'}" style="left:${pos}%"></div>
      </div>
      <div class="cg-scale"><span>${c.fwd_limit} (fwd)</span><span>target ${c.target}</span><span>${c.aft_limit} (aft)</span></div>
    </div>`;
  }

  const v = data.validation || {};
  html += `<div class="val-block ${v.ok ? 'val-ok' : 'val-bad'}">`
    + `<strong>${v.ok ? '✓ All hard limits satisfied (independent re-validation)' : '✗ Validation issues'}</strong>`;
  if (v.violations && v.violations.length) html += '<ul>' + v.violations.map((x) => `<li>${x}</li>`).join('') + '</ul>';
  html += '</div>';

  if (data.rejected && data.rejected.length) {
    html += `<div class="rej-block"><strong>${data.rejected.length} item(s) rejected by build-up:</strong><ul>`
      + data.rejected.map((r) => {
          const why = ` <button class="rej-why" data-id="${esc(r.id)}" data-dims="${esc(r.dims)}" data-weight="${r.weight}" data-reason="${esc(r.reason)}" type="button">Why? ▶</button>`;
          return `<li>${esc(r.id)} (${esc(r.dims)}, ${r.weight}kg) — ${esc(r.reason)}${why}</li>`;
        }).join('') + '</ul></div>';
  }

  if (data.pallets && data.pallets.length) {
    html += `<div class="plt-block"><strong>Pallets built (${data.pallets.length}):</strong><ul>`
      + data.pallets.map((p) => `<li>${p.id} → ${p.position || '(unassigned)'} · ${p.weight}kg · ${p.height}cm · [${p.boxes.join(', ')}]</li>`).join('')
      + '</ul></div>';
  }

  body.innerHTML = html;
  card.hidden = false;

  body.querySelectorAll('.rej-why').forEach((btn) => {
    btn.addEventListener('click', () => openRejectModal(btn.dataset.id, btn.dataset.dims, btn.dataset.reason, Number(btn.dataset.weight)));
  });
}

// ── CG artificial-horizon gauge ────────────────────────────────────────
// A real attitude-indicator metaphor: sky/ground bands tilt with the CG's
// offset from the trim target, clamped to a legible ±18° swing.
function renderHorizonGauge(c, inEnv) {
  const halfSpan = Math.max(1, (c.aft_limit - c.fwd_limit) / 2);
  const norm = Math.max(-1, Math.min(1, (c.arm - c.target) / halfSpan));
  const tiltDeg = (norm * 18).toFixed(1);
  const fwdMargin = (c.arm - c.fwd_limit).toFixed(1);
  const aftMargin = (c.aft_limit - c.arm).toFixed(1);
  return `
    <div class="horizon-wrap">
      <div class="horizon-gauge">
        <div class="horizon-disc" style="transform: rotate(${tiltDeg}deg)">
          <div class="horizon-sky"></div>
          <div class="horizon-ground"></div>
          <div class="horizon-line"></div>
          <div class="horizon-ladder" style="top:38%; left:50%; transform:translateX(-50%)"></div>
          <div class="horizon-ladder" style="top:62%; left:50%; transform:translateX(-50%)"></div>
        </div>
        <div class="horizon-index"></div>
      </div>
      <div class="horizon-readout">
        <div class="hr-label">Centre of Gravity</div>
        <div class="hr-value ${inEnv ? '' : 'hr-bad'}">${Number(c.arm).toFixed(1)} in</div>
        <div class="hr-margins">
          <span>fwd margin <b>${fwdMargin}"</b></span>
          <span>aft margin <b>${aftMargin}"</b></span>
        </div>
        <p class="hr-note">Envelope shown is a provisional operational guard pending the certified AFM CG envelope.</p>
      </div>
    </div>`;
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
  highlight3DPosition(i);
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

const MONO = 'ui-monospace, "IBM Plex Mono", Menlo, Consolas, monospace';

function drawBuildup() {
  if (!buCanvas) return;
  const wrap = buCanvas.parentElement;
  const cssW = Math.max(760, wrap.clientWidth - 16);
  const cssH = 360;
  const dpr = window.devicePixelRatio || 1;
  buCanvas.width = cssW * dpr;
  buCanvas.height = cssH * dpr;
  buCanvas.style.height = cssH + 'px';
  const ctx = buCtx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  // ── Instrument panel background (matches the 3D viewport) ──
  const bg = ctx.createLinearGradient(0, 0, 0, cssH);
  bg.addColorStop(0, '#141b24'); bg.addColorStop(1, '#0b0e13');
  roundRect(ctx, 1, 1, cssW - 2, cssH - 2, 14); ctx.fillStyle = bg; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1; ctx.stroke();
  drawReticle(ctx, cssW, cssH);

  const n = BU_POSITIONS.length;
  const padL = 58, padR = 66, padT = 58, padB = 88;
  const noseW = 56, tailW = 62;
  const bodyL = padL + noseW;
  const bodyR = cssW - padR - tailW;
  const bodyW = bodyR - bodyL;
  const cy = (padT + (cssH - padB)) / 2;
  const fuseTop = padT, fuseBot = cssH - padB;
  const fuseH = fuseBot - fuseTop;

  // ── Fuselage silhouette (top-view blueprint on dark) ──
  ctx.save();
  const tailTipX = cssW - padR + 4;
  const stabRootX = bodyR - 8;   // where the tailplane joins the body
  const stabH = 16;              // stabilizer half-span beyond the fuselage

  // Horizontal stabilizers (swept tailplane), above & below — drawn first so
  // the semi-transparent body reads as sitting on top of their roots.
  ctx.fillStyle = 'rgba(70,96,130,0.30)';
  ctx.strokeStyle = 'rgba(122,150,190,0.5)'; ctx.lineWidth = 1;
  [[-1, fuseTop], [1, fuseBot]].forEach(([dir, edgeY]) => {
    ctx.beginPath();
    ctx.moveTo(stabRootX, edgeY);
    ctx.lineTo(stabRootX + 24, edgeY + dir * stabH);
    ctx.lineTo(stabRootX + 40, edgeY + dir * stabH);
    ctx.lineTo(stabRootX + 34, edgeY);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
  });

  // Fuselage body: rounded ogive nose, straight sides, tapered tail cone.
  ctx.beginPath();
  ctx.moveTo(bodyL, fuseTop);
  ctx.bezierCurveTo(padL + noseW * 0.45, fuseTop, padL + 3, cy - 5, padL, cy);   // upper nose → tip
  ctx.bezierCurveTo(padL + 3, cy + 5, padL + noseW * 0.45, fuseBot, bodyL, fuseBot); // tip → lower nose
  ctx.lineTo(bodyR, fuseBot);                                                    // bottom edge
  ctx.quadraticCurveTo(bodyR + tailW * 0.78, fuseBot, tailTipX, cy + 6);         // tail cone (lower)
  ctx.quadraticCurveTo(tailTipX + 6, cy, tailTipX, cy - 6);                      // rounded tail tip
  ctx.quadraticCurveTo(bodyR + tailW * 0.78, fuseTop, bodyR, fuseTop);           // tail cone (upper)
  ctx.closePath();
  const g = ctx.createLinearGradient(0, fuseTop, 0, fuseBot);
  g.addColorStop(0, 'rgba(60,84,116,0.24)'); g.addColorStop(0.5, 'rgba(40,58,84,0.1)'); g.addColorStop(1, 'rgba(60,84,116,0.24)');
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = 'rgba(122,150,190,0.62)'; ctx.lineWidth = 1.5; ctx.stroke();

  // Vertical fin seen edge-on along the centreline (brand-red sliver aft).
  ctx.beginPath();
  ctx.moveTo(stabRootX + 8, cy - 3);
  ctx.lineTo(tailTipX - 2, cy);
  ctx.lineTo(stabRootX + 8, cy + 3);
  ctx.closePath();
  ctx.fillStyle = 'rgba(224,34,48,0.92)'; ctx.fill();

  // centreline
  ctx.strokeStyle = 'rgba(122,150,190,0.16)'; ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);
  ctx.beginPath(); ctx.moveTo(padL + 8, cy); ctx.lineTo(bodyR, cy); ctx.stroke();
  ctx.setLineDash([]);
  // cockpit hint
  ctx.beginPath(); ctx.arc(padL + 22, cy, 7, -Math.PI / 2.2, Math.PI / 2.2);
  ctx.strokeStyle = 'rgba(159,182,214,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.restore();

  // ── Position slots ──
  const gap = 6;
  const slotW = (bodyW - gap * (n - 1)) / n;
  const slotH = fuseH - 26;
  const slotY = fuseTop + 14;
  const slotXOf = (i) => bodyL + i * (slotW + gap);
  buSlots = [];

  // FWD / AFT section zones behind the slots (so which positions belong to
  // which balance group is obvious at a glance).
  const zoneSpan = (set) => {
    const idxs = (set || []).map((id) => BU_POSITIONS.findIndex((p) => p.id === id)).filter((i) => i >= 0);
    if (!idxs.length) return null;
    const l = Math.min(...idxs), r = Math.max(...idxs);
    return { left: slotXOf(l) - 4, right: slotXOf(r) + slotW + 4 };
  };
  const sectionZones = [
    { z: zoneSpan(FWD_POS[buFamily]), tint: FWD_TINT, label: '◀ FWD SECTION' },
    { z: zoneSpan(AFT_POS[buFamily]), tint: AFT_TINT, label: 'AFT SECTION ▶' },
  ];
  const zoneTop = slotY - 9, zoneH = slotH + 18;
  sectionZones.forEach(({ z, tint }) => {
    if (!z) return;
    roundRect(ctx, z.left, zoneTop, z.right - z.left, zoneH, 8);
    ctx.fillStyle = tint.fill; ctx.fill();
    ctx.setLineDash([4, 4]); ctx.strokeStyle = tint.line; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
  });

  BU_POSITIONS.forEach((p, i) => {
    const x = bodyL + i * (slotW + gap);
    buSlots.push({ x, y: slotY, w: slotW, h: slotH });
    const pct = p.limit ? (p.load / p.limit) * 100 : 0;
    const loaded = p.load > 0;
    const col = buColor(pct);
    const isHover = i === buHover, isSel = i === buSelected;
    const cx = x + slotW / 2;

    ctx.save();
    // cell base
    roundRect(ctx, x, slotY, slotW, slotH, 7);
    ctx.fillStyle = loaded ? '#0f1620' : '#0d131b';
    ctx.fill();

    // usage fill (bottom-up load level)
    if (loaded) {
      const fh = Math.min(slotH, slotH * Math.min(pct, 100) / 100);
      ctx.save();
      roundRect(ctx, x, slotY, slotW, slotH, 7); ctx.clip();
      const fg = ctx.createLinearGradient(0, slotY + slotH - fh, 0, slotY + slotH);
      fg.addColorStop(0, col.bar); fg.addColorStop(1, col.fill);
      ctx.fillStyle = fg;
      ctx.fillRect(x, slotY + slotH - fh, slotW, fh);
      // subtle fill top highlight line
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(x, slotY + slotH - fh, slotW, 1.5);
      ctx.restore();
    }

    // border (+ glow on hover/select)
    roundRect(ctx, x, slotY, slotW, slotH, 7);
    if (isSel || isHover) { ctx.shadowColor = 'rgba(224,34,48,0.5)'; ctx.shadowBlur = 10; }
    ctx.lineWidth = isSel ? 2.5 : isHover ? 2 : 1;
    ctx.strokeStyle = isSel ? '#e02230' : isHover ? '#f0808c' : 'rgba(160,178,200,0.28)';
    ctx.stroke();
    ctx.shadowColor = 'transparent';

    ctx.textAlign = 'center';
    // id (top)
    ctx.fillStyle = '#eef4fb';
    ctx.font = `800 13px ${MONO}`;
    ctx.fillText(p.id, cx, slotY + 17);
    // type
    ctx.font = `600 8px ${MONO}`;
    ctx.fillStyle = 'rgba(200,214,232,0.6)';
    ctx.fillText(p.type, cx, slotY + 28);

    // centre % (loaded)
    if (loaded) {
      ctx.font = `800 15px ${MONO}`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(Math.round(pct) + '%', cx, slotY + slotH / 2 + 5);
    }

    // bottom readout: load / limit
    ctx.font = `700 10px ${MONO}`;
    ctx.fillStyle = loaded ? '#ffffff' : 'rgba(160,178,200,0.55)';
    ctx.fillText(loaded ? p.load.toLocaleString() : '—', cx, slotY + slotH - 15);
    ctx.font = `500 8px ${MONO}`;
    ctx.fillStyle = 'rgba(200,214,232,0.5)';
    ctx.fillText('/ ' + p.limit.toLocaleString(), cx, slotY + slotH - 5);
    ctx.restore();
  });

  // NOSE/FWD · title · AFT/TAIL
  ctx.font = `700 11px ${MONO}`;
  ctx.fillStyle = FWD_TINT.css;
  ctx.textAlign = 'left'; ctx.fillText('◀ NOSE · FWD', padL - 8, padT - 16);
  ctx.fillStyle = AFT_TINT.css;
  ctx.textAlign = 'right'; ctx.fillText('AFT · TAIL ▶', cssW - padR + 6, padT - 16);
  ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(200,214,232,0.75)'; ctx.font = `700 11px ${MONO}`;
  const fw = buFamily === 'PAG' ? '224' : '244';
  ctx.fillText(`MAIN DECK — ${buFamily} ${fw} × 318 CM`, cssW / 2, padT - 16);

  // ── FWD / AFT section brackets + bold labels below the deck ──
  const brY = fuseBot + 11;
  sectionZones.forEach(({ z, tint, label }) => {
    if (!z) return;
    const zc = (z.left + z.right) / 2;
    ctx.strokeStyle = tint.css; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(z.left, brY - 5); ctx.lineTo(z.left, brY);
    ctx.lineTo(z.right, brY); ctx.lineTo(z.right, brY - 5);
    ctx.stroke();
    ctx.font = `800 12px ${MONO}`;
    const tw = ctx.measureText(label).width, pw = tw + 20, ph = 20, px = zc - pw / 2, py = brY + 5;
    ctx.fillStyle = tint.css; roundRect(ctx, px, py, pw, ph, 10); ctx.fill();
    ctx.fillStyle = '#0b0e13'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, zc, py + ph / 2 + 0.5); ctx.textBaseline = 'alphabetic';
  });

  // ── CG scale (fwd → aft) along the bottom, when a plan exists ──
  drawCGScale(ctx, bodyL, bodyW, cssH - 30);
}

// Four HUD-style corner brackets — the same reticle motif as the 3D frame.
function drawReticle(ctx, w, h) {
  const s = 16, m = 10;
  ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 2;
  const corner = (x, y, dx, dy) => {
    ctx.beginPath();
    ctx.moveTo(x, y + dy * s); ctx.lineTo(x, y); ctx.lineTo(x + dx * s, y); ctx.stroke();
  };
  corner(m, m, 1, 1); corner(w - m, m, -1, 1);
  corner(m, h - m, 1, -1); corner(w - m, h - m, -1, -1);
}

function drawCGScale(ctx, sx, sw, sy) {
  const c = lastPlanData && lastPlanData.cg;
  if (!c) return;
  const span = (c.aft_limit - c.fwd_limit) || 1;
  const at = (v) => sx + Math.max(0, Math.min(1, (v - c.fwd_limit) / span)) * sw;
  const inEnv = c.arm >= c.fwd_limit && c.arm <= c.aft_limit;

  // track
  ctx.save();
  roundRect(ctx, sx, sy - 4, sw, 8, 4);
  ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill();
  // green safe band across the envelope
  const grd = ctx.createLinearGradient(sx, 0, sx + sw, 0);
  grd.addColorStop(0, 'rgba(31,163,74,0.15)');
  grd.addColorStop(0.5, 'rgba(31,163,74,0.4)');
  grd.addColorStop(1, 'rgba(31,163,74,0.15)');
  roundRect(ctx, sx, sy - 4, sw, 8, 4); ctx.fillStyle = grd; ctx.fill();

  // target tick
  const tx = at(c.target);
  ctx.strokeStyle = '#f5c518'; ctx.lineWidth = 2; ctx.setLineDash([3, 2]);
  ctx.beginPath(); ctx.moveTo(tx, sy - 9); ctx.lineTo(tx, sy + 9); ctx.stroke();
  ctx.setLineDash([]);

  // actual CG marker
  const mx = at(c.arm);
  ctx.fillStyle = inEnv ? '#22c55e' : '#e02230';
  ctx.beginPath();
  ctx.moveTo(mx, sy - 10); ctx.lineTo(mx + 5, sy - 17); ctx.lineTo(mx - 5, sy - 17); ctx.closePath();
  ctx.fill();
  ctx.beginPath(); ctx.arc(mx, sy, 4, 0, Math.PI * 2); ctx.fill();

  // labels
  ctx.font = `600 9px ${MONO}`; ctx.fillStyle = 'rgba(160,178,200,0.7)';
  ctx.textAlign = 'left'; ctx.fillText(`FWD ${c.fwd_limit}`, sx, sy + 20);
  ctx.textAlign = 'right'; ctx.fillText(`AFT ${c.aft_limit}`, sx + sw, sy + 20);
  ctx.textAlign = 'center';
  ctx.fillStyle = inEnv ? '#22c55e' : '#e02230'; ctx.font = `800 10px ${MONO}`;
  ctx.fillText(`CG ${Number(c.arm).toFixed(1)} in ${inEnv ? '· IN ENVELOPE' : '· OUT'}`, mx, sy - 22);
  ctx.restore();
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

// ════════════════════════════════════════════════════════════════════
//  DOOR-FIT PLACARD — "why doesn't this fit through the cargo door?"
//  Reads the real door-envelope matrix (/api/door-envelope, parsed from
//  the same CSVs the engine's own door check reads) and shows the
//  binding number, not a guess.
// ════════════════════════════════════════════════════════════════════
let doorEnvelopeData = null;
async function getDoorEnvelopeData() {
  if (doorEnvelopeData) return doorEnvelopeData;
  const res = await fetch('/api/door-envelope');
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Could not load door envelope data.');
  doorEnvelopeData = data;
  return data;
}

// Door opening for a given presented height/width, per the real bracket table
// — mirrors aircraft_config.py's get_max_door_length(): round the height UP to
// the next published bracket, then take the first width column the item's width
// fits within. Returns the max length plus the matched opening dimensions.
function doorInfo(heightCm, widthCm, table) {
  const bracket = table.find((row) => row.height >= heightCm);
  if (!bracket) return { maxLen: 0, doorWidth: 0, bracketHeight: 0, widthFits: false };
  const entry = bracket.limits.find((lim) => widthCm <= lim.width);
  return {
    maxLen: entry ? entry.max_length : 0,
    doorWidth: entry ? entry.width : 0,
    bracketHeight: bracket.height,
    widthFits: !!entry,
  };
}

// The engine tries every axis-aligned rotation before rejecting an item;
// find the orientation with the most slack (closest to fitting).
function bestDoorFit(l, w, h, table) {
  const dims = [l, w, h];
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  let best = null;
  perms.forEach(([hi, wi, li]) => {
    const height = dims[hi], width = dims[wi], length = dims[li];
    const info = doorInfo(height, width, table);
    const slack = info.maxLen - length;
    if (!best || slack > best.slack) best = { height, width, length, slack, ...info };
  });
  return best;
}

// Loadable envelope constants (main deck, B737-800SF).
const ULD_BASE = { PMC: { l: 318, w: 244 }, PAG: { l: 318, w: 224 } };
const DECK_CEILING = 200; // cm contour ceiling (162 cm at P12)

// Diagnose why an item was rejected by build-up. The modal only opens for
// items the engine already rejected, so the verdict is always "rejected" — the
// job here is to show which physical gate is the binding one, matching the
// engine's reason code (geometry gates and/or the weight gate).
function analyzeReject(l, w, h, weight, family, doorTable, reason) {
  const base = ULD_BASE[family] || ULD_BASE.PMC;
  const maxPosLimit = Math.max(...(FAMILY_POSITIONS[family] || FAMILY_POSITIONS.PMC).map(([, lim]) => lim));
  const isWeight = /kg|weight|exceeds/i.test(reason || '');

  const dims = [l, w, h].sort((a, b) => b - a);
  const [A, B, C] = dims; // longest → shortest
  const footFits = (A <= base.l && B <= base.w) || (A <= base.w && B <= base.l);
  const door = bestDoorFit(l, w, h, doorTable);
  const canContain = footFits && C <= DECK_CEILING;

  const geomGates = [
    { name: 'Fit onto a ULD base', sub: `longest side vs ${base.l} cm base`, item: A, limit: base.l, pass: footFits, unit: 'cm' },
    { name: 'Clear the deck ceiling', sub: `min height vs ${DECK_CEILING} cm ceiling`, item: C, limit: DECK_CEILING, pass: C <= DECK_CEILING, unit: 'cm' },
    { name: 'Pass the aft cargo door', sub: `length vs ${door.maxLen} cm limit`, item: door.length, limit: door.maxLen, pass: door.slack >= 0, unit: 'cm' },
  ];
  // Weight gate: no position can hold more than the strongest position's limit.
  const weightGate = {
    name: 'Within weight limit', sub: `weight vs ${maxPosLimit.toLocaleString()} kg strongest position`,
    item: weight, limit: maxPosLimit, pass: weight <= maxPosLimit, unit: 'kg',
  };

  let gates, primary;
  if (isWeight) {
    gates = [weightGate, ...geomGates];
    if (!weightGate.pass) {
      primary = `At ${weight.toLocaleString()} kg it exceeds every position's limit (max ${maxPosLimit.toLocaleString()} kg)`;
    } else {
      weightGate.pass = false; // engine rejected on remaining capacity
      weightGate.sub = 'exceeds the remaining capacity on every position';
      primary = `No position has ${weight.toLocaleString()} kg of capacity left for it`;
    }
  } else {
    gates = geomGates;
    if (!footFits) primary = `Its longest side (${A} cm) can't lie on a ${base.l} cm ULD base`;
    else if (C > DECK_CEILING) primary = `Even lying flat it stands ${C} cm tall — over the ${DECK_CEILING} cm ceiling`;
    else if (door.slack < 0) primary = `It's ${Math.abs(door.slack)} cm too long for the aft cargo door`;
    else primary = 'Rejected by the contour check';
  }

  return {
    id: null, dims: [l, w, h], weight, base, gates, isWeight, door, canContain,
    bannerDetail: isWeight ? `${weight.toLocaleString()} KG` : `${l}×${w}×${h} CM`,
    primary,
  };
}

async function openRejectModal(id, dimsStr, reason, weight) {
  const modal = document.getElementById('doorModal');
  const title = document.getElementById('doorModalTitle');
  const explain = document.getElementById('doorExplain');
  title.textContent = `Loadability Check — ${id}`;
  explain.innerHTML = '<span class="ps-busy">Checking against the loadability rules…</span>';
  modal.hidden = false;

  const [l, w, h] = dimsStr.split('x').map(Number);
  try {
    const env = await getDoorEnvelopeData();
    // plan_api.py builds with is_aft=True, so the aft door table applies.
    const diag = analyzeReject(l, w, h, weight || 0, buFamily, env.aft, reason);
    diag.id = id;
    startRejectAnim(diag);

    const failing = diag.gates.filter((g) => !g.pass);
    const passing = diag.gates.filter((g) => g.pass);
    const intro = diag.isWeight
      ? `<b>${esc(id)}</b> weighs <code>${(weight || 0).toLocaleString()} kg</code> at <code>${l}×${w}×${h} cm</code>.`
      : `<b>${esc(id)}</b> measures <code>${l}×${w}×${h} cm</code>.`;
    explain.innerHTML = `
      <div class="de-verdict de-bad">✗ Rejected — ${esc(diag.primary.toLowerCase())}</div>
      <p>${intro} An item is only loadable if it fits a ULD base, clears the deck ceiling,
      passes the cargo door, and stays within a position's weight limit.
      It fails on <b>${failing.map((g) => g.name.toLowerCase()).join('</b>, <b>')}</b>${
        passing.length ? `, while it passes ${passing.map((g) => g.name.toLowerCase()).join(', ')}` : ''}.
      ${diag.isWeight ? ' The geometry is fine — the weight is the problem.' : ''}</p>
      <p style="color:#9aa1ab;font-size:12px;">Engine reason code: ${esc(reason)}</p>`;
  } catch (e) {
    explain.innerHTML = `<span class="ps-bad">${esc(e.message)}</span>`;
  }
}

function closeRejectModal() {
  stopRejectAnim();
  document.getElementById('doorModal').hidden = true;
}
document.getElementById('doorModalClose').addEventListener('click', closeRejectModal);
document.getElementById('doorModal').addEventListener('click', (e) => {
  if (e.target.id === 'doorModal') closeRejectModal();
});

function monoFont(px, weight) {
  return `${weight || '600'} ${px}px ui-monospace, "IBM Plex Mono", Menlo, Consolas, monospace`;
}

// One-shot reveal animation for the loadability placard (progress 0→1), then
// a gentle pulse on any failing gate.
let rejectAnim = null;
function startRejectAnim(diag) {
  stopRejectAnim();
  rejectAnim = { diag, start: performance.now(), raf: null };
  const loop = () => {
    if (!rejectAnim) return;
    const p = Math.min(1, (performance.now() - rejectAnim.start) / 850);
    drawRejectDiagram(rejectAnim.diag, easeOutCubic(p), performance.now());
    rejectAnim.raf = (p < 1 || diag.gates.some((g) => !g.pass)) ? requestAnimationFrame(loop) : null;
  };
  loop();
}
function stopRejectAnim() {
  if (rejectAnim && rejectAnim.raf) cancelAnimationFrame(rejectAnim.raf);
  rejectAnim = null;
}

function drawArrowLine(ctx, x1, y1, x2, y2, color, head = 5) {
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  const ang = Math.atan2(y2 - y1, x2 - x1);
  [[x1, y1, ang], [x2, y2, ang + Math.PI]].forEach(([x, y, a]) => {
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.lineTo(x - head * Math.cos(a - 0.5), y - head * Math.sin(a - 0.5));
    ctx.lineTo(x - head * Math.cos(a + 0.5), y - head * Math.sin(a + 0.5));
    ctx.closePath(); ctx.fill();
  });
}

// Animated loadability placard: a checklist of the three physical gates every
// item must pass to be loaded — fit a ULD base, clear the ceiling, pass the
// door — each a bar comparing the item's dimension to the limit, with the
// overhang hatched red where it fails. `p` = reveal progress 0→1.
function drawRejectDiagram(diag, p = 1, now = 0) {
  const canvas = document.getElementById('doorCanvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const OK = '#22c55e', BAD = '#ef4444', AMBER = '#f5c518', INK = '#cdd6e2', MUT = 'rgba(160,178,200,0.72)';

  ctx.clearRect(0, 0, W, H);
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#121821'); bg.addColorStop(1, '#0a0d12');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  drawReticle(ctx, W, H);

  // ── Verdict banner (the item was rejected by the engine) ──
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(239,68,68,0.16)';
  roundRect(ctx, 34, 12, W - 68, 30, 8); ctx.fill();
  ctx.fillStyle = BAD; ctx.font = monoFont(13, 800);
  ctx.fillText(`✗  ${diag.id} REJECTED  ·  ${diag.bannerDetail}`, W / 2, 33);

  // ── Gate gauges (3 geometry, or 4 when weight is the cause) ──
  const gx = 210, gw = W - gx - 34;      // gauge track region
  const top = 60, rowH = (H - top - 16) / diag.gates.length;

  diag.gates.forEach((g, i) => {
    const cy = top + rowH * i + rowH / 2;
    const pass = g.pass;
    const col = pass ? OK : BAD;

    // status chip + gate name
    ctx.textAlign = 'left';
    ctx.fillStyle = pass ? 'rgba(34,197,94,0.16)' : 'rgba(239,68,68,0.16)';
    roundRect(ctx, 26, cy - 22, 60, 20, 6); ctx.fill();
    ctx.fillStyle = col; ctx.font = monoFont(10, 800);
    ctx.textAlign = 'center'; ctx.fillText(pass ? 'PASS' : 'FAIL', 56, cy - 8);
    ctx.textAlign = 'left';
    ctx.fillStyle = INK; ctx.font = monoFont(12, 700);
    ctx.fillText(g.name, 26, cy + 10);
    ctx.fillStyle = MUT; ctx.font = monoFont(9, 600);
    ctx.fillText(g.sub, 26, cy + 24);

    // bar: allowed zone (0→limit) + item value with red overhang beyond
    const scaleMax = Math.max(g.item, g.limit) * 1.14;
    const pxPer = gw / scaleMax;
    const limX = gx + g.limit * pxPer;
    const barH = 18;
    const barY = cy - barH / 2;

    ctx.fillStyle = 'rgba(34,197,94,0.13)';
    roundRect(ctx, gx, barY, g.limit * pxPer, barH, 4); ctx.fill();
    ctx.strokeStyle = 'rgba(34,197,94,0.45)'; ctx.lineWidth = 1;
    roundRect(ctx, gx, barY, g.limit * pxPer, barH, 4); ctx.stroke();

    const fullW = g.item * pxPer;
    const itemW = fullW * p;
    const okW = Math.min(itemW, g.limit * pxPer);
    ctx.fillStyle = pass ? 'rgba(34,197,94,0.55)' : 'rgba(34,197,94,0.4)';
    roundRect(ctx, gx, barY + 3, Math.max(0, okW), barH - 6, 3); ctx.fill();

    if (itemW > g.limit * pxPer + 0.5) {
      const oxA = limX, oxB = gx + itemW;
      ctx.save();
      ctx.beginPath(); ctx.rect(oxA, barY, oxB - oxA, barH); ctx.clip();
      ctx.fillStyle = 'rgba(239,68,68,0.22)'; ctx.fillRect(oxA, barY, oxB - oxA + 4, barH);
      ctx.strokeStyle = BAD; ctx.lineWidth = 1.6;
      for (let x = oxA - 20; x < oxB + 20; x += 8) {
        ctx.beginPath(); ctx.moveTo(x, barY - 3); ctx.lineTo(x + 14, barY + barH + 3); ctx.stroke();
      }
      ctx.restore();
    }

    // limit tick (pulses if this gate fails)
    const pulse = pass ? 1 : 0.55 + 0.45 * Math.abs(Math.sin(now / 300));
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = AMBER; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(limX, barY - 6); ctx.lineTo(limX, barY + barH + 6); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = AMBER; ctx.font = monoFont(9, 800); ctx.textAlign = 'center';
    ctx.fillText(`max ${g.limit.toLocaleString()}`, limX, barY + barH + 17);

    // item value
    ctx.fillStyle = col; ctx.font = monoFont(11, 800); ctx.textAlign = 'right';
    ctx.fillText(`${g.item.toLocaleString()} ${g.unit}`, gx + gw, barY - 6);
    if (!pass && g.item > g.limit) {
      ctx.fillStyle = BAD; ctx.textAlign = 'left';
      ctx.fillText(`+${(g.item - g.limit).toLocaleString()}`, Math.min(limX + 6, gx + gw - 40), barY - 6);
    }
  });
}

// ════════════════════════════════════════════════════════════════════
//  3D DECK VIEWPORT (Three.js)
//  A true-to-the-manual view: the fuselage barrel is extruded from the
//  REAL loadable cross-section the engine uses (aircraft_config.py's
//  contour staircase), with structural frames, a lit cargo deck, and
//  ULD pallets sized to real proportions and coloured by utilization.
//  Same BU_POSITIONS data as the 2D canvas.
// ════════════════════════════════════════════════════════════════════
let lastPlanData = null;
let td = null; // lazily created on first switch to 3D

// Scene scale: 1 world unit = 1 metre. Aircraft length runs along +X
// (nose at −X), lateral along Z, vertical along Y.
const SCALE = { spacing: 2.9, uldLen: 2.7, uldWid: 2.2 };

// Loadable half-section: half-width (m) at height (m). Straight from the
// engine's get_allowed_x_range staircase — this is the certified envelope,
// not an artistic guess. Mirrored about the centreline to form the barrel.
const CONTOUR = [
  [1.59, 0.00], [1.59, 0.90], [1.39, 1.50],
  [1.24, 1.70], [1.05, 1.95], [0.62, 2.15], [0.0, 2.22],
];

function utilHex(pct) {
  if (pct > 100) return 0x991b1b;
  if (pct >= 90) return 0xdc2626;
  if (pct >= 70) return 0xf59e0b;
  return 0x1fa34a;
}

// ── small texture/label helpers (cached where cheap) ──

function gradientBackground() {
  const c = document.createElement('canvas'); c.width = 16; c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#1b2430'); grd.addColorStop(0.55, '#111721'); grd.addColorStop(1, '#0a0d12');
  g.fillStyle = grd; g.fillRect(0, 0, 16, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Corrugated-panel texture for the ULDs — near-white greyscale so the
// material's utilization colour still shows through (map multiplies colour),
// with subtle vertical ridges that catch the light like a real air pallet.
let _ribTex = null;
function ribbedTexture() {
  if (_ribTex) return _ribTex;
  const c = document.createElement('canvas'); c.width = 128; c.height = 16;
  const g = c.getContext('2d');
  for (let x = 0; x < 128; x++) {
    const v = 0.86 + 0.14 * Math.pow(Math.abs(Math.cos((x / 128) * Math.PI * 11)), 0.6);
    const s = Math.round(v * 255);
    g.fillStyle = `rgb(${s},${s},${s})`;
    g.fillRect(x, 0, 1, 16);
  }
  _ribTex = new THREE.CanvasTexture(c);
  _ribTex.wrapS = _ribTex.wrapT = THREE.RepeatWrapping;
  _ribTex.anisotropy = 4;
  return _ribTex;
}

function labelSprite(text, { color = '#e8eef5', size = 44, weight = 700, bg = null } = {}) {
  const pad = 12;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = `${weight} ${size}px ui-monospace, "IBM Plex Mono", Menlo, Consolas, monospace`;
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + pad * 2;
  const h = size + pad * 2;
  c.width = w; c.height = h;
  g.font = font; g.textBaseline = 'middle'; g.textAlign = 'center';
  if (bg) { g.fillStyle = bg; roundRectPath(g, 1, 1, w - 2, h - 2, 10); g.fill(); }
  g.fillStyle = color; g.fillText(text, w / 2, h / 2 + 1);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  spr.scale.set((w / h) * 0.62, 0.62, 1);
  spr.userData.dispose = () => { tex.dispose(); spr.material.dispose(); };
  return spr;
}
function roundRectPath(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// A crisp multi-line info panel (billboard) — used for the pallet placards
// so the slot name, capacity, load and utilization are all readable in 3D.
function infoPanelSprite(lines, { accent = '#e02230', worldH = 0.92 } = {}) {
  const DPR = 2, padX = 22 * DPR, padY = 16 * DPR, gap = 6 * DPR, barW = 8 * DPR;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const fontFor = (l) => `${l.weight || 600} ${(l.size || 22) * DPR}px ui-monospace, "IBM Plex Mono", Menlo, Consolas, monospace`;
  let w = 0, h = padY * 2;
  lines.forEach((l, i) => {
    g.font = fontFor(l);
    w = Math.max(w, Math.ceil(g.measureText(l.text).width));
    h += (l.size || 22) * DPR + (i ? gap : 0);
  });
  w += padX * 2 + barW;
  c.width = w; c.height = h;
  // panel
  g.fillStyle = 'rgba(13,16,19,0.9)';
  roundRectPath(g, 1, 1, w - 2, h - 2, 14 * DPR); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 1.5 * DPR;
  roundRectPath(g, 1, 1, w - 2, h - 2, 14 * DPR); g.stroke();
  // accent bar
  g.fillStyle = accent;
  roundRectPath(g, 10 * DPR, 12 * DPR, barW, h - 24 * DPR, barW / 2); g.fill();
  // text
  g.textBaseline = 'top'; g.textAlign = 'left';
  let y = padY;
  const tx = padX + barW;
  lines.forEach((l) => {
    g.font = fontFor(l); g.fillStyle = l.color || '#e8eef5';
    g.fillText(l.text, tx, y);
    y += (l.size || 22) * DPR + gap;
  });
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  spr.scale.set(worldH * (w / h), worldH, 1);
  spr.userData.dispose = () => { tex.dispose(); spr.material.dispose(); };
  return spr;
}

// Closed cross-section outline (for the end caps / structural frames).
function contourPoints() {
  const pts = [];
  for (let i = 0; i < CONTOUR.length; i++) pts.push(new THREE.Vector2(CONTOUR[i][0], CONTOUR[i][1]));
  for (let i = CONTOUR.length - 2; i >= 0; i--) pts.push(new THREE.Vector2(-CONTOUR[i][0], CONTOUR[i][1]));
  return pts;
}

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
// A gentle overshoot so pallets "settle" into place instead of stopping dead.
function easeOutBack(t) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }

function ensure3D() {
  if (td) return td;
  const mount = document.getElementById('bu3DMount');
  const frame = document.getElementById('bu3DFrame');
  const width = mount.clientWidth || 800;
  const height = mount.clientHeight || 440;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = gradientBackground();
  scene.fog = new THREE.Fog(0x0a0d12, 30, 88);

  // Aluminium ULDs need reflections to read as metal — a neutral room env.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(46, width / height, 0.1, 300);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.rotateSpeed = 0.62;
  controls.panSpeed = 0.6;
  controls.screenSpacePanning = true;
  controls.enableZoom = false; // replaced by the damped wheel zoom below
  controls.minDistance = 7;
  controls.maxDistance = 80;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.45;
  controls.addEventListener('start', () => { controls.autoRotate = false; });

  // ── Smooth, frequency-independent zoom (fixes jerky laptop-trackpad zoom) ──
  // OrbitControls' built-in wheel zoom applies a fixed step per wheel event and
  // isn't damped, so a high-frequency trackpad lurches. Instead, the wheel nudges
  // a *target distance* and the camera eases toward it every frame (see stepZoom).
  const dolly = { target: null };
  renderer.domElement.addEventListener('wheel', (e) => {
    e.preventDefault();
    controls.autoRotate = false;
    if (dolly.target == null) dolly.target = camera.position.distanceTo(controls.target);
    // Pinch-zoom (ctrlKey on trackpads) is finer-grained than two-finger scroll.
    const k = e.ctrlKey ? 0.010 : 0.0016;
    const factor = Math.exp(THREE.MathUtils.clamp(e.deltaY, -60, 60) * k);
    dolly.target = THREE.MathUtils.clamp(dolly.target * factor, controls.minDistance, controls.maxDistance);
  }, { passive: false });

  scene.add(new THREE.HemisphereLight(0x9fc0e8, 0x30251a, 0.7));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(-10, 26, 15);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  // Wide ortho frustum so the whole deck length casts shadow cleanly.
  Object.assign(key.shadow.camera, { left: -26, right: 26, top: 14, bottom: -14, near: 1, far: 90 });
  key.shadow.camera.updateProjectionMatrix();
  scene.add(key);
  scene.add(key.target);
  const rim = new THREE.DirectionalLight(0x88a6d0, 1.0);
  rim.position.set(16, 8, -14);
  scene.add(rim);

  const deckGroup = new THREE.Group();
  scene.add(deckGroup);

  // A reusable selection ring, hidden until a pallet is clicked.
  const selRing = new THREE.Mesh(
    new THREE.RingGeometry(1.55, 1.78, 40),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
  );
  selRing.rotation.x = -Math.PI / 2;
  selRing.visible = false;
  scene.add(selRing);

  // ── DOM overlays inside the framed viewport ──
  const readout = document.createElement('div');
  readout.className = 'bu3d-readout'; readout.id = 'bu3DReadout';
  frame.appendChild(readout);

  const tooltip = document.createElement('div');
  tooltip.className = 'bu3d-tooltip';
  frame.appendChild(tooltip);

  const cglegend = document.createElement('div');
  cglegend.className = 'bu3d-cglegend'; cglegend.style.display = 'none';
  cglegend.innerHTML =
    '<span class="cgl"><i style="background:#1fa34a"></i>CG envelope</span>' +
    '<span class="cgl"><i style="background:#f5c518"></i>trim target</span>' +
    '<span class="cgl"><i style="background:#e02230"></i>actual CG</span>';
  frame.appendChild(cglegend);

  const ctrlWrap = document.createElement('div');
  ctrlWrap.className = 'bu3d-controls';
  [['⟳', 'Reset', 'reset'], ['⬒', 'Top', 'top'], ['◧', 'Side', 'side']].forEach(([ic, label, key2]) => {
    const b = document.createElement('button');
    b.className = 'bu3d-cbtn'; b.type = 'button'; b.textContent = `${ic} ${label}`;
    b.addEventListener('click', () => setDeckView(key2));
    ctrlWrap.appendChild(b);
  });
  frame.appendChild(ctrlWrap);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  td = {
    scene, camera, renderer, controls, deckGroup, mount, frame, readout, tooltip, cglegend,
    selRing, raycaster, pointer, dolly, pickables: [], hovered: null, selected: null,
    cgMarker: null, anim: null, camTween: null, introDone: false, deckLen: 0,
  };

  // ── Interaction: hover highlight + click-to-select (syncs the 2D editor) ──
  const dom = renderer.domElement;
  dom.addEventListener('pointermove', (e) => {
    const rect = dom.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(td.pickables, false)[0];
    td.hovered = hit ? hit.object : null;
    dom.style.cursor = hit ? 'pointer' : 'grab';
    if (hit) {
      const u = hit.object.userData;
      const fr = frame.getBoundingClientRect();
      tooltip.style.left = (e.clientX - fr.left) + 'px';
      tooltip.style.top = (e.clientY - fr.top) + 'px';
      tooltip.innerHTML =
        `<div class="tt-id"><span class="tt-dot" style="background:${u.cssColor}"></span>${u.posId}</div>` +
        `${u.load.toLocaleString()} / ${u.limit.toLocaleString()} kg · <b>${Math.round(u.pct)}%</b><br>` +
        `height ${u.heightCm} cm · ${u.boxCount} item${u.boxCount === 1 ? '' : 's'}`;
      tooltip.classList.add('on');
    } else {
      tooltip.classList.remove('on');
    }
  });
  dom.addEventListener('pointerleave', () => { td.hovered = null; tooltip.classList.remove('on'); });
  dom.addEventListener('click', () => {
    if (td.hovered) selectPosition(td.hovered.userData.posIndex);
  });

  function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    stepCamTween(now);
    stepZoom();
    stepDeckAnim(now);
    stepHoverSelect(now);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  window.addEventListener('resize', () => {
    if (document.getElementById('bu3DCard').hidden) return;
    const w = mount.clientWidth || width, h = mount.clientHeight || height;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });

  return td;
}

// ── Cinematic camera fly-in / view presets ──
function startCamTween(toPos, toTarget, dur = 1400, opts = {}) {
  if (!td) return;
  td.controls.autoRotate = false;
  td.controls.enabled = false;
  td.camTween = {
    fromPos: td.camera.position.clone(), toPos: toPos.clone(),
    fromTarget: td.controls.target.clone(), toTarget: toTarget.clone(),
    start: performance.now(), dur, thenAutoRotate: !!opts.autoRotate,
  };
}
function stepCamTween(now) {
  if (!td || !td.camTween) return;
  const c = td.camTween;
  let t = (now - c.start) / c.dur; t = Math.max(0, Math.min(1, t));
  const e = easeInOutCubic(t);
  td.camera.position.lerpVectors(c.fromPos, c.toPos, e);
  td.controls.target.lerpVectors(c.fromTarget, c.toTarget, e);
  td.camera.lookAt(td.controls.target);
  if (t >= 1) {
    td.controls.enabled = true;
    if (c.thenAutoRotate) td.controls.autoRotate = true;
    // Re-sync the zoom target so the settled distance is what the wheel adjusts.
    td.dolly.target = td.camera.position.distanceTo(td.controls.target);
    td.camTween = null;
  }
}

// Ease the camera distance toward the wheel-set target (see the wheel handler).
function stepZoom() {
  if (!td || td.camTween || !td.dolly || td.dolly.target == null) return;
  const off = td.camera.position.clone().sub(td.controls.target);
  const cur = off.length();
  if (Math.abs(cur - td.dolly.target) < 0.002) return;
  off.setLength(THREE.MathUtils.lerp(cur, td.dolly.target, 0.18));
  td.camera.position.copy(td.controls.target).add(off);
}
function setDeckView(which) {
  if (!td) return;
  const L = td.deckLen, half = L / 2;
  const target = new THREE.Vector3(0, 1.1, 0);
  let pos;
  if (which === 'top') pos = new THREE.Vector3(0.01, half * 1.5 + 6, 0.01);
  else if (which === 'side') pos = new THREE.Vector3(0.01, 3.2, half * 1.35 + 6);
  else pos = new THREE.Vector3(-half * 0.62, half * 0.52 + 4, half * 0.98 + 7);
  startCamTween(pos, target, 900);
}

// Staggered "build-up" reveal with a settle overshoot — the visual echo of
// the engine stacking the load nose-to-tail. (Purely cosmetic; final heights
// are the engine's real pallet heights.)
function stepDeckAnim(now) {
  if (!td || !td.anim) return;
  const a = td.anim;
  let allDone = true;
  a.items.forEach((it) => {
    let t = (now - a.start - it.delay) / a.dur;
    t = Math.max(0, Math.min(1, t));
    const e = t < 1 ? Math.max(0.02, easeOutBack(t)) : 1;
    it.box.scale.y = e;
    it.box.position.y = (it.h * e) / 2 + 0.01;
    it.edges.scale.y = e;
    it.edges.position.y = it.box.position.y;
    if (it.tag) { it.tag.position.y = it.h * e + 0.55; it.tag.material.opacity = Math.min(1, t * 1.4); }
    if (t < 1) allDone = false;
  });
  if (allDone) td.anim = null;
}

// Per-frame hover/selection emphasis + a soft pulse on the CG marker and on
// any over-limit pallet (draws the eye to a problem without being gaudy).
function stepHoverSelect(now) {
  if (!td) return;
  const pulse = 0.5 + 0.5 * Math.sin(now / 320);
  td.pickables.forEach((m) => {
    const base = m.userData.over ? 0.10 + pulse * 0.22 : 0.08;
    let ei = base;
    if (m === td.selected) ei = 0.30 + pulse * 0.12;
    else if (m === td.hovered) ei = 0.34;
    m.material.emissiveIntensity = ei;
  });
  if (td.selected) {
    td.selRing.visible = true;
    td.selRing.position.set(td.selected.position.x, 0.02, 0);
    const s = 1 + pulse * 0.05;
    td.selRing.scale.set(s, s, s);
  } else {
    td.selRing.visible = false;
  }
  if (td.cgMarker) {
    const s = 1 + pulse * 0.12;
    td.cgMarker.scale.y = s;
    if (td.cgMarker.material) td.cgMarker.material.emissiveIntensity = 0.5 + pulse * 0.5;
  }
}

// Called by selectPosition() so a 2D-editor selection also lights up in 3D.
function highlight3DPosition(i) {
  if (!td) return;
  const m = td.pickables.find((p) => p.userData.posIndex === i);
  td.selected = m || null;
}

function clearGroup(group) {
  for (let i = group.children.length - 1; i >= 0; i--) {
    const obj = group.children[i];
    obj.traverse((o) => {
      if (o.userData && o.userData.dispose) o.userData.dispose();
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
          if (m.map) m.map.dispose(); m.dispose();
        });
      }
    });
    group.remove(obj);
  }
}

function buildFuselage(deckLen) {
  const g = new THREE.Group();

  // Barrel: extrude the loadable cross-section along the aircraft length.
  const shape = new THREE.Shape(contourPoints());
  const geo = new THREE.ExtrudeGeometry(shape, { depth: deckLen, bevelEnabled: false, steps: 1 });
  geo.translate(0, 0, -deckLen / 2);
  geo.rotateY(-Math.PI / 2); // local +Z (length) → world +X

  const skin = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: 0xaebccb, metalness: 0.5, roughness: 0.42,
    transparent: true, opacity: 0.09, side: THREE.DoubleSide, depthWrite: false,
  }));
  g.add(skin);

  // Long blueprint edges (the barrel silhouette).
  const skinEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo, 25),
    new THREE.LineBasicMaterial({ color: 0x6f8db3, transparent: true, opacity: 0.35 })
  );
  g.add(skinEdges);

  // Structural frames (rings) every ~2.9 m — this is what reads as "aircraft".
  const ringPts = contourPoints();
  const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
  const ringMat = new THREE.LineBasicMaterial({ color: 0x9fb6d6, transparent: true, opacity: 0.5 });
  const nRings = Math.round(deckLen / 2.9);
  for (let i = 0; i <= nRings; i++) {
    const ring = new THREE.LineLoop(ringGeo, ringMat);
    ring.rotation.y = Math.PI / 2;
    ring.position.x = -deckLen / 2 + (i / nRings) * deckLen;
    g.add(ring);
  }
  g.userData.dispose = () => { ringGeo.dispose(); ringMat.dispose(); };

  // ── Nose cone (sleek taper forward) and tail cone (up-swept), lofted from
  //    the same contour so they blend seamlessly with the barrel ──
  g.add(buildTaperedEnd(-deckLen / 2, -1, 5.6, 0.2));   // nose
  g.add(buildTaperedEnd(deckLen / 2, 1, 4.4, 1.7));     // tail (rises aft)

  // ── Vertical tail fin — the defining aircraft silhouette, in brand red ──
  g.add(buildTailFin(deckLen / 2));
  return g;
}

// A wireframe loft: scaled contour rings marching toward a tip, plus
// longitudinal stringers — reads as a nose/tail cone without heavy geometry.
function buildTaperedEnd(endX, dir, len, sweepUp) {
  const grp = new THREE.Group();
  const cy = 1.0; // section centroid height to taper toward
  const base = contourPoints();
  const mat = new THREE.LineBasicMaterial({ color: 0x8fb0d8, transparent: true, opacity: 0.5 });
  const tip = new THREE.Vector3(endX + dir * len, cy + sweepUp, 0);

  const stations = 4;
  for (let s = 1; s <= stations; s++) {
    const k = s / (stations + 1);
    const scale = 1 - k;
    const x = endX + dir * k * len;
    const lift = sweepUp * k * k;
    const pts = base.map((p) => new THREE.Vector3(x, cy + (p.y - cy) * scale + lift, p.x * scale));
    pts.push(pts[0].clone());
    grp.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
  }
  const stringers = [];
  for (let i = 0; i < base.length; i += 2) {
    stringers.push(new THREE.Vector3(endX, base[i].y, base[i].x), tip.clone());
  }
  grp.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(stringers), mat));
  grp.userData.dispose = () => mat.dispose();
  return grp;
}

function buildTailFin(tailX) {
  const grp = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(2.7, 0);
  shape.lineTo(2.25, 2.3);
  shape.lineTo(1.1, 2.3);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: false });
  geo.translate(0, 0, -0.07);
  const fin = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: 0xe02230, metalness: 0.3, roughness: 0.45,
    transparent: true, opacity: 0.9, side: THREE.DoubleSide,
  }));
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: 0xffd7db, transparent: true, opacity: 0.6 })
  );
  const finGrp = new THREE.Group();
  finGrp.add(fin); finGrp.add(edges);
  // Sit the fin on top of the up-swept tail.
  finGrp.position.set(tailX - 1.6, 1.85, 0);
  grp.add(finGrp);
  grp.userData.dispose = () => { fin.material.dispose(); edges.material.dispose(); geo.dispose(); };
  return grp;
}

function cssHex(n) { return '#' + n.toString(16).padStart(6, '0'); }

function draw3DDeck() {
  if (!td) return;
  const { deckGroup } = td;
  clearGroup(deckGroup);
  td.pickables = [];
  td.hovered = null; td.selected = null; td.cgMarker = null;
  td.selRing.visible = false;

  const n = BU_POSITIONS.length;
  const deckLen = n * SCALE.spacing + 1.4;
  const halfLen = deckLen / 2;
  td.deckLen = deckLen;
  const posX = (i) => -halfLen + 0.7 + (i + 0.5) * SCALE.spacing;

  // Pallet real heights from the last engine run, keyed by position code.
  const palletByPos = {};
  if (lastPlanData && Array.isArray(lastPlanData.pallets)) {
    lastPlanData.pallets.forEach((p) => { if (p.position) palletByPos[p.position] = p; });
  }

  // ── Grounding surface so the deck doesn't float in a void ──
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(deckLen * 2.6, deckLen * 1.5),
    new THREE.MeshStandardMaterial({ color: 0x0a0d12, metalness: 0.7, roughness: 0.75 })
  );
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02;
  ground.receiveShadow = true;
  deckGroup.add(ground);

  // ── Deck floor ──
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(deckLen, 3.4),
    new THREE.MeshStandardMaterial({ color: 0x141a22, metalness: 0.6, roughness: 0.55 })
  );
  floor.rotation.x = -Math.PI / 2; floor.position.y = 0.001;
  floor.receiveShadow = true;
  deckGroup.add(floor);

  const track = new THREE.Mesh(
    new THREE.PlaneGeometry(deckLen, 0.12),
    new THREE.MeshBasicMaterial({ color: 0x2a3543 })
  );
  track.rotation.x = -Math.PI / 2; track.position.y = 0.004;
  deckGroup.add(track);

  // ── Fuselage barrel ──
  deckGroup.add(buildFuselage(deckLen));

  const ribTex = ribbedTexture();
  const animItems = [];
  let animOrder = 0;

  BU_POSITIONS.forEach((p, i) => {
    const x = posX(i);
    const pct = p.limit ? (p.load / p.limit) * 100 : 0;
    const isP12 = p.id === 'P12';
    const wid = isP12 ? 1.5 : SCALE.uldWid;
    const len = isP12 ? 1.5 : SCALE.uldLen;
    const loaded = p.load > 0;

    // Position pad.
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(len, wid),
      new THREE.MeshBasicMaterial({ color: loaded ? 0x1d2733 : 0x161d26 })
    );
    pad.rotation.x = -Math.PI / 2; pad.position.set(x, 0.006, 0);
    deckGroup.add(pad);

    const padEdge = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-len / 2, 0, -wid / 2), new THREE.Vector3(len / 2, 0, -wid / 2),
        new THREE.Vector3(len / 2, 0, wid / 2), new THREE.Vector3(-len / 2, 0, wid / 2),
      ]),
      new THREE.LineBasicMaterial({ color: loaded ? 0x3a5170 : 0x2a3646 })
    );
    padEdge.position.set(x, 0.007, 0);
    deckGroup.add(padEdge);

    // Floor placard: slot name + its structural limit (informative even empty).
    const floorLabel = infoPanelSprite(
      loaded
        ? [{ text: p.id, size: 26, weight: 800, color: '#ffffff' },
           { text: `max ${p.limit.toLocaleString()} kg`, size: 15, color: '#93a4b8' }]
        : [{ text: p.id, size: 24, weight: 800, color: '#8296ad' },
           { text: `max ${p.limit.toLocaleString()} kg`, size: 14, color: '#5f7089' }],
      { accent: loaded ? cssHex(utilHex(pct)) : '#33465a', worldH: 0.62 }
    );
    floorLabel.position.set(x, 0.42, wid / 2 + 0.92);
    deckGroup.add(floorLabel);

    if (loaded) {
      const pal = palletByPos[p.id];
      const hCm = pal && pal.height ? pal.height : 150;
      const h = Math.max(0.4, Math.min(hCm / 100, isP12 ? 1.6 : 2.0));
      const col = utilHex(pct);
      const over = p.load > p.limit;

      const map = ribTex.clone(); map.needsUpdate = true;
      map.repeat.set(Math.max(2, Math.round(len * 2)), 1);
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(len, h, wid),
        new THREE.MeshStandardMaterial({
          color: col, map, metalness: 0.62, roughness: 0.32,
          emissive: col, emissiveIntensity: 0.08, envMapIntensity: 1.15,
        })
      );
      box.position.set(x, h / 2 + 0.01, 0);
      box.castShadow = true; box.receiveShadow = true;
      box.userData = {
        posIndex: i, posId: p.id, load: p.load, limit: p.limit, pct,
        heightCm: hCm, boxCount: pal && pal.boxes ? pal.boxes.length : 1,
        over, cssColor: cssHex(col),
      };
      deckGroup.add(box);
      td.pickables.push(box);

      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(box.geometry),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 })
      );
      edges.position.copy(box.position);
      deckGroup.add(edges);

      // Informative floating placard above each pallet.
      const placard = infoPanelSprite([
        { text: p.id, size: 26, weight: 800, color: '#ffffff' },
        { text: `${p.load.toLocaleString()} / ${p.limit.toLocaleString()} kg`, size: 17, color: '#dbe6f2' },
        { text: `${Math.round(pct)}% util · ${hCm} cm`, size: 15, weight: 700, color: cssHex(col) },
      ], { accent: cssHex(col), worldH: 0.98 });
      placard.position.set(x, h + 0.72, 0);
      deckGroup.add(placard);

      animItems.push({ box, edges, tag: placard, h, delay: animOrder++ * 70 });
    }
  });

  // Kick off the staggered rise (nose → tail).
  if (animItems.length) {
    animItems.forEach((it) => { it.box.scale.y = 0.02; it.edges.scale.y = 0.02; });
    td.anim = { items: animItems, start: performance.now(), dur: 700 };
  } else {
    td.anim = null;
  }

  // ── FWD / AFT section zones on the deck floor ──
  const zoneFor = (set) => {
    const idxs = (set || []).map((id) => BU_POSITIONS.findIndex((p) => p.id === id)).filter((k) => k >= 0);
    if (!idxs.length) return null;
    const l = Math.min(...idxs), r = Math.max(...idxs);
    return { x0: posX(l), x1: posX(r), cx: (posX(l) + posX(r)) / 2 };
  };
  [[FWD_POS[buFamily], FWD_TINT, 'FWD · NOSE'], [AFT_POS[buFamily], AFT_TINT, 'AFT · TAIL']]
    .forEach(([set, tint, label]) => {
      const z = zoneFor(set); if (!z) return;
      const w = (z.x1 - z.x0) + SCALE.uldLen + 0.5;
      const strip = new THREE.Mesh(
        new THREE.PlaneGeometry(w, 3.15),
        new THREE.MeshBasicMaterial({ color: tint.hex, transparent: true, opacity: 0.12, depthWrite: false })
      );
      strip.rotation.x = -Math.PI / 2; strip.position.set(z.cx, 0.008, 0);
      deckGroup.add(strip);
      const stripEdge = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-w / 2, 0, -1.58), new THREE.Vector3(w / 2, 0, -1.58),
          new THREE.Vector3(w / 2, 0, 1.58), new THREE.Vector3(-w / 2, 0, 1.58)]),
        new THREE.LineDashedMaterial({ color: tint.hex, dashSize: 0.25, gapSize: 0.2, transparent: true, opacity: 0.7 })
      );
      stripEdge.computeLineDistances();
      stripEdge.position.set(z.cx, 0.009, 0);
      deckGroup.add(stripEdge);
      // Bold, raised billboard so the section reads clearly from any angle.
      const lab = infoPanelSprite([{ text: label, size: 30, weight: 800, color: tint.css }],
        { accent: tint.css, worldH: 0.86 });
      lab.position.set(z.cx, 2.9, -2.4);
      deckGroup.add(lab);
      // A drop line from the label down to the deck zone.
      const drop = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(z.cx, 2.55, -2.4), new THREE.Vector3(z.cx, 0.05, -1.65)]),
        new THREE.LineBasicMaterial({ color: tint.hex, transparent: true, opacity: 0.5 })
      );
      deckGroup.add(drop);
    });

  // ── CG balance beam: envelope band + target + live CG marker along deck ──
  buildCGBeam(halfLen);

  // Nose / tail orientation labels, out beyond the cones.
  const nose = labelSprite('◀ NOSE · FWD', { size: 32, weight: 800, color: FWD_TINT.css, bg: 'rgba(90,140,208,0.14)' });
  nose.position.set(-halfLen - 4.8, 0.42, 0);
  deckGroup.add(nose);
  const tail = labelSprite('AFT · TAIL ▶', { size: 32, weight: 800, color: AFT_TINT.css, bg: 'rgba(224,150,80,0.14)' });
  tail.position.set(halfLen + 4.0, 0.42, 0);
  deckGroup.add(tail);

  // First reveal → cinematic camera fly-in; afterwards keep the user's view.
  if (!td.introDone) {
    td.controls.target.set(0, 1.15, 0);
    td.camera.position.set(-halfLen * 1.15, halfLen * 0.95 + 10, halfLen * 1.4 + 12);
    td.camera.lookAt(td.controls.target);
    startCamTween(
      new THREE.Vector3(-halfLen * 0.62, halfLen * 0.52 + 4, halfLen * 0.98 + 7),
      new THREE.Vector3(0, 1.15, 0), 1600, { autoRotate: true }
    );
    td.introDone = true;
  }

  updateReadout();
}

// A longitudinal "balance beam" along the deck: the CG envelope (fwd→aft
// limits) as a translucent band, the trim target as a tick, and the actual
// computed CG as a glowing marker. Positions are mapped proportionally across
// a central band of the deck — an indicative balance view (the certified
// protection remains the cumulative-load curve). Only shown when a plan exists.
function buildCGBeam(halfLen) {
  const { deckGroup } = td;
  const cg = lastPlanData && lastPlanData.cg;
  td.cglegend.style.display = cg ? 'flex' : 'none';
  if (!cg) return;

  const xFwd = -halfLen * 0.42, xAft = halfLen * 0.66;
  const span = (cg.aft_limit - cg.fwd_limit) || 1;
  const mapArm = (v) => THREE.MathUtils.lerp(xFwd, xAft, (v - cg.fwd_limit) / span);
  const yBeam = 0.015;
  const inEnv = cg.arm >= cg.fwd_limit && cg.arm <= cg.aft_limit;

  // Envelope band.
  const band = new THREE.Mesh(
    new THREE.PlaneGeometry(xAft - xFwd, 0.6),
    new THREE.MeshBasicMaterial({ color: 0x1fa34a, transparent: true, opacity: 0.16, depthWrite: false })
  );
  band.rotation.x = -Math.PI / 2;
  band.position.set((xFwd + xAft) / 2, yBeam, 0);
  deckGroup.add(band);

  const beamLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(xFwd, yBeam, 0), new THREE.Vector3(xAft, yBeam, 0)]),
    new THREE.LineBasicMaterial({ color: 0x2f9e57, transparent: true, opacity: 0.7 })
  );
  deckGroup.add(beamLine);

  const tick = (x, color, label) => {
    const t = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, yBeam, -0.35), new THREE.Vector3(x, yBeam, 0.35)]),
      new THREE.LineBasicMaterial({ color })
    );
    deckGroup.add(t);
    if (label) {
      const s = labelSprite(label, { size: 22, color: cssHex(color), bg: 'rgba(13,16,19,0.7)' });
      s.scale.multiplyScalar(0.7);
      s.position.set(x, 0.12, -0.95);
      deckGroup.add(s);
    }
  };
  tick(xFwd, 0x9fb6d6, 'FWD');
  tick(xAft, 0x9fb6d6, 'AFT');
  tick(mapArm(cg.target), 0xf5c518, null);

  // Live CG marker — a glowing pillar the eye is drawn to.
  const xCg = THREE.MathUtils.clamp(mapArm(cg.arm), xFwd - 1.2, xAft + 1.2);
  const markColor = inEnv ? 0x22c55e : 0xe02230;
  const marker = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.09, 2.2, 16),
    new THREE.MeshStandardMaterial({ color: markColor, emissive: markColor, emissiveIntensity: 0.7, metalness: 0.2, roughness: 0.3 })
  );
  marker.position.set(xCg, 1.1, 0);
  deckGroup.add(marker);
  td.cgMarker = marker;

  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(0.34, 24),
    new THREE.MeshBasicMaterial({ color: markColor, transparent: true, opacity: 0.4, depthWrite: false })
  );
  disc.rotation.x = -Math.PI / 2; disc.position.set(xCg, 0.02, 0);
  deckGroup.add(disc);

  const cgLabel = infoPanelSprite([
    { text: `CG ${Number(cg.arm).toFixed(1)} in`, size: 22, weight: 800, color: inEnv ? '#dff7e6' : '#ffd7db' },
    { text: inEnv ? 'within envelope' : 'OUT OF ENVELOPE', size: 14, weight: 700, color: inEnv ? '#22c55e' : '#e02230' },
  ], { accent: cssHex(markColor), worldH: 0.7 });
  cgLabel.position.set(xCg, 2.7, 0);
  deckGroup.add(cgLabel);
}

function updateReadout() {
  if (!td) return;
  const d = lastPlanData;
  if (!d || !d.totals) { td.readout.innerHTML = ''; return; }
  const t = d.totals;
  const cg = d.cg ? `${Number(d.cg.arm).toFixed(1)} in` : '—';
  const ok = d.validation && d.validation.ok;
  td.readout.innerHTML =
    `<b>${(t.packed_weight || 0).toLocaleString()} kg</b> payload<br>` +
    `CG <b>${cg}</b>${ok ? '' : ' ⚠'}<br>` +
    `<b>${t.pallets_built || 0}</b> pallets · <b>${t.positions_used || 0}</b> positions`;
}

function updateBuildup3D() {
  const card = document.getElementById('bu3DCard');
  if (!card || card.hidden) return; // lazy: only render while the 3D tab is visible
  ensure3D();
  draw3DDeck();
  const hasLoad = BU_POSITIONS.some((p) => p.load > 0);
  document.getElementById('bu3DHint').classList.toggle('hidden', hasLoad);
}
