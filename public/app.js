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
