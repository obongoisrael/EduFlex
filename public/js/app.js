/**
 * EduFlex app shell: hash router (supports sub-routes like #/roadmaps/12/edit),
 * shared UI helpers (modal, toast, badges, form fields), offline support,
 * and the alarm-reminder loop.
 *
 * Each view registers itself on window.Views, e.g. Views.dashboard = async (el, args) => {...}
 */
const Views = {};

const App = {
  user: null,
  upcomingReminders: [],

  async init() {
    // Route guard — never leave the screen silently blank.
    try {
      let user;
      try {
        ({ user } = await API.get('/api/auth/me'));
      } catch {
        document.getElementById('view').innerHTML =
          '<div class="text-center py-20 text-sm text-slate-500">Redirecting to login… ' +
          '<a href="/login.html" class="text-indigo-600 font-semibold hover:underline">Click here</a> if nothing happens.</div>';
        window.location.replace('/login.html');
        return;
      }
      App.user = user;
      App.renderUserChrome();
      window.addEventListener('hashchange', App.route);
      App.initOffline();
      App.startReminderLoop();
      App.route();
    } catch (err) {
      console.error('EduFlex startup error:', err);
      document.getElementById('view').innerHTML = `
        <div class="max-w-md mx-auto mt-16 card p-6 text-center border-rose-200 bg-rose-50">
          <div class="text-3xl mb-2">⚠️</div>
          <h2 class="font-bold text-rose-800">Something went wrong while starting EduFlex</h2>
          <p class="text-xs text-rose-600 mt-2">${esc(err.message || 'Unknown error')}</p>
          <button onclick="location.reload()" class="btn btn-primary mt-5">🔄 Reload the app</button>
        </div>`;
    }
  },

  renderUserChrome() {
    document.getElementById('topAvatar').textContent = App.user.public_username;
    document.getElementById('topInstitution').textContent = App.user.institution;
    if (App.user.role === 'admin') document.getElementById('adminNavWrap').classList.remove('hidden');
  },

  async logout() {
    try { await API.post('/api/auth/logout'); } catch { /* leaving anyway */ }
    location.href = '/login.html';
  },

  titles: {
    dashboard: 'Dashboard', courses: 'Courses', deadlines: 'Deadlines',
    availability: 'Availability', schedule: 'Study Schedule', calendar: 'Calendar',
    focus: 'Focus Mode', resources: 'Resource Library', progress: 'Progress',
    profile: 'Profile', insights: 'Smart Insights', peers: 'Peer Study',
    setup: 'Get Started', roadmaps: 'Learning Roadmaps', admin: 'Admin',
  },

  async route() {
    const path = (location.hash.replace('#/', '') || 'dashboard').split('?')[0];
    const segments = path.split('/').filter(Boolean);
    const name = segments[0] || 'dashboard';

    // Client-side admin guard (the server enforces this too)
    if (name === 'admin' && App.user.role !== 'admin') {
      document.getElementById('view').innerHTML =
        '<div class="card p-6 text-sm text-rose-700 bg-rose-50 border-rose-200">Admin access required.</div>';
      return;
    }

    const view = Views[name] || Views.dashboard;
    document.getElementById('pageTitle').textContent = App.titles[name] || 'Dashboard';

    document.querySelectorAll('.nav-link').forEach(a => a.classList.toggle('active', a.dataset.route === name));
    document.querySelectorAll('.tab').forEach(a => a.classList.toggle('active', a.dataset.tab === name));
    toggleSidebar(false);

    const el = document.getElementById('view');
    el.innerHTML = '<div class="text-slate-400 text-sm py-16 text-center">Loading…</div>';
    try {
      await view(el, segments.slice(1));
      el.classList.remove('view-enter'); void el.offsetWidth; el.classList.add('view-enter');
      window.scrollTo(0, 0);
    } catch (err) {
      if (err.message !== 'Not authenticated') {
        el.innerHTML = `<div class="card p-5 text-sm text-rose-700 bg-rose-50 border-rose-200">${esc(err.message)}</div>`;
      }
    }
  },

  /* ---------- offline support ---------- */
  offline: !navigator.onLine,

  initOffline() {
    const banner = document.getElementById('offlineBanner');
    const apply = () => {
      App.offline = !navigator.onLine;
      banner.classList.toggle('hidden', !App.offline);
      if (!App.offline) App.syncFocusQueue();
    };
    window.addEventListener('online', () => { apply(); toast('Back online — syncing. ✅'); App.route(); });
    window.addEventListener('offline', () => { apply(); toast('You are offline. Saved study plan still available.', 'info'); });
    apply();
  },

  /** Push offline-completed focus sessions to the server on reconnect. */
  async syncFocusQueue() {
    let queue = [];
    try { queue = JSON.parse(localStorage.getItem('ef_focus_queue') || '[]'); } catch { queue = []; }
    if (queue.length === 0) return;
    try {
      const r = await API.post('/api/focus/sync', { sessions: queue });
      localStorage.removeItem('ef_focus_queue');
      if (r.synced > 0) toast(`Synced ${r.synced} offline focus session${r.synced === 1 ? '' : 's'}. 🔄`);
    } catch { /* still offline — keep the queue */ }
  },

  /* ---------- alarm reminders ---------- */
  _reminderTimer: null,
  _reminderState: {},

  startReminderLoop() {
    try { App._reminderState = JSON.parse(localStorage.getItem('ef_reminders') || '{}'); } catch { App._reminderState = {}; }
    const tick = () => App.checkReminders().catch(() => {});
    App._reminderTimer = setInterval(tick, 30000);
    tick();
  },

  async checkReminders() {
    if (App.offline) return;
    const { reminders } = await API.get('/api/smart/reminders');
    App.upcomingReminders = reminders;
    const now = new Date();
    for (const r of reminders) {
      const key = `${r.kind}-${r.id}`;
      const st = App._reminderState[key] || {};
      if (st.dismissed || st.fired) continue;
      if (st.snoozedUntil && new Date(st.snoozedUntil) > now) continue;
      if (new Date(r.remind_at) <= now && new Date(r.at) >= now) App.fireReminder(r, key);
    }
  },

  fireReminder(r, key) {
    App._reminderState[key] = { ...(App._reminderState[key] || {}), fired: true };
    App.saveReminderState();
    const msg = r.kind === 'deadline'
      ? `Deadline: ${r.title.replace(' (deadline)', '')} is due ${fmtDT(r.at)}.`
      : `${r.title} starts ${r.minutes_before === 0 ? 'now' : 'in ' + r.minutes_before + ' minutes'}.`;

    const prefs = App.user.notification_preferences || {};
    if (prefs.browser && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('EduFlex', { body: msg });
    }
    if (prefs.sound !== false) App.playBeep();

    openModal('⏰ Reminder', `
      <p class="text-sm text-slate-700">${esc(msg)}</p>
      <div class="flex flex-wrap justify-end gap-2 mt-6">
        ${[5, 10, 15].map(m => `<button data-snooze="${m}" class="btn btn-ghost btn-sm">Snooze ${m}m</button>`).join('')}
        <button id="remDismiss" class="btn btn-primary btn-sm">Dismiss</button>
      </div>`);
    document.querySelectorAll('[data-snooze]').forEach(b => b.onclick = () => {
      App._reminderState[key] = { snoozedUntil: new Date(Date.now() + Number(b.dataset.snooze) * 60000).toISOString() };
      App.saveReminderState(); closeModal();
      toast(`Snoozed ${b.dataset.snooze} minutes.`, 'info');
    });
    document.getElementById('remDismiss').onclick = () => {
      App._reminderState[key] = { dismissed: true }; App.saveReminderState(); closeModal();
    };
  },

  saveReminderState() { localStorage.setItem('ef_reminders', JSON.stringify(App._reminderState)); },

  playBeep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880; gain.gain.value = 0.06;
      osc.start(); osc.stop(ctx.currentTime + 0.4);
    } catch { /* no audio available */ }
  },

  async enableBrowserNotifications() {
    if (!('Notification' in window)) { toast('This browser does not support notifications.', 'error'); return false; }
    const perm = await Notification.requestPermission();
    if (perm === 'granted') { toast('Browser notifications enabled. 🔔'); return true; }
    toast('Not enabled — you will still get in-app reminders.', 'info');
    return false;
  },
};

/* ==================== shared helpers ==================== */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function fmtDT(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d)) return s;
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) +
    ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}
function fmtDate(s) {
  const d = new Date(s);
  return isNaN(d) ? s : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
function daysUntil(s) { return Math.ceil((new Date(s) - new Date()) / 86400000); }
function dueLabel(s) {
  const d = daysUntil(s);
  if (d < 0) return { text: `${-d}d overdue`, cls: 'text-rose-600' };
  if (d === 0) return { text: 'due today', cls: 'text-rose-600' };
  if (d === 1) return { text: 'due tomorrow', cls: 'text-amber-600' };
  if (d <= 3) return { text: `in ${d} days`, cls: 'text-amber-600' };
  return { text: `in ${d} days`, cls: 'text-slate-500' };
}

const STATUS_BADGE = {
  Planned: 'bg-indigo-100 text-indigo-700', Completed: 'bg-emerald-100 text-emerald-700',
  Missed: 'bg-rose-100 text-rose-700', Rescheduled: 'bg-violet-100 text-violet-700',
  Pending: 'bg-amber-100 text-amber-700',
};
const PRIORITY_BADGE = { High: 'bg-rose-100 text-rose-700', Medium: 'bg-amber-100 text-amber-700', Low: 'bg-slate-100 text-slate-600' };
const DIFFICULTY_BADGE = { Hard: 'bg-rose-100 text-rose-700', Moderate: 'bg-amber-100 text-amber-700', Easy: 'bg-emerald-100 text-emerald-700' };
const RISK_BADGE = { Low: 'bg-emerald-100 text-emerald-700', Medium: 'bg-amber-100 text-amber-700', High: 'bg-rose-100 text-rose-700' };
const RISK_BORDER = { Low: 'border-emerald-200 bg-emerald-50', Medium: 'border-amber-200 bg-amber-50', High: 'border-rose-200 bg-rose-50' };

function badge(text, cls) {
  return `<span class="inline-block text-[11px] font-semibold px-2.5 py-1 rounded-full ${cls || 'bg-slate-100 text-slate-600'}">${esc(text)}</span>`;
}
function qualityBadge(score, label) {
  const cls = score >= 80 ? 'bg-emerald-100 text-emerald-700' : score >= 60 ? 'bg-indigo-100 text-indigo-700'
    : score >= 40 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500';
  return `<span class="inline-block text-[11px] font-semibold px-2.5 py-1 rounded-full ${cls}" title="Resource quality score">⭐ ${score}% · ${esc(label)}</span>`;
}
function progressBar(pct, color) {
  const c = color || (pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-indigo-500' : 'bg-amber-500');
  return `<div class="h-2 bg-slate-100 rounded-full overflow-hidden"><div class="h-full ${c} rounded-full transition-all" style="width:${Math.min(100, pct)}%"></div></div>`;
}

/* ---------- modal / toast ---------- */

function openModal(title, bodyHTML, { wide = false } = {}) {
  document.getElementById('modalRoot').innerHTML = `
    <div class="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4">
      <div class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onclick="closeModal()"></div>
      <div class="relative bg-white w-full ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'} rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto view-enter">
        <div class="sticky top-0 bg-white flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100 rounded-t-3xl sm:rounded-t-2xl">
          <h3 class="font-bold text-slate-900">${esc(title)}</h3>
          <button onclick="closeModal()" class="text-slate-400 hover:text-slate-600 text-2xl leading-none p-1 -mr-1">&times;</button>
        </div>
        <div class="px-5 py-5" style="padding-bottom:calc(1.25rem + var(--safe-b))">${bodyHTML}</div>
      </div>
    </div>`;
}
function closeModal() { document.getElementById('modalRoot').innerHTML = ''; }

function confirmModal(message, confirmText = 'Delete') {
  return new Promise((resolve) => {
    openModal('Please confirm', `
      <p class="text-sm text-slate-600">${esc(message)}</p>
      <div class="flex justify-end gap-3 mt-6">
        <button class="btn btn-ghost" id="cfNo">Cancel</button>
        <button class="btn btn-danger" id="cfYes">${esc(confirmText)}</button>
      </div>`);
    document.getElementById('cfNo').onclick = () => { closeModal(); resolve(false); };
    document.getElementById('cfYes').onclick = () => { closeModal(); resolve(true); };
  });
}

function toast(msg, type = 'success') {
  const colors = { success: 'bg-emerald-600', error: 'bg-rose-600', info: 'bg-indigo-600' };
  const el = document.createElement('div');
  el.className = `${colors[type]} text-white text-sm font-medium px-4 py-3 rounded-2xl shadow-xl view-enter pointer-events-auto sm:max-w-xs`;
  el.textContent = msg;
  document.getElementById('toastRoot').appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

/* ---------- layout helpers ---------- */

function toggleSidebar(force) {
  const sb = document.getElementById('sidebar');
  const bd = document.getElementById('backdrop');
  const open = force !== undefined ? force : !sb.classList.contains('open');
  sb.classList.toggle('open', open);
  bd.classList.toggle('hidden', !open);
  // Lock background scroll only while the mobile drawer is open
  document.body.style.overflow = open && window.innerWidth < 1024 ? 'hidden' : '';
}

const INPUT_CLS = 'inp';
function field(label, inputHTML) {
  return `<div><label class="block text-sm font-medium text-slate-700 mb-1.5">${label}</label>${inputHTML}</div>`;
}
function emptyState(icon, title, hint, actionHTML = '') {
  return `
    <div class="text-center py-14 px-5 card border-dashed">
      <div class="text-4xl mb-3">${icon}</div>
      <h3 class="font-semibold text-slate-700">${esc(title)}</h3>
      <p class="text-sm text-slate-400 mt-1 max-w-sm mx-auto">${esc(hint)}</p>
      ${actionHTML ? `<div class="mt-5">${actionHTML}</div>` : ''}
    </div>`;
}

/* ---------- efficiency helpers ---------- */

const AVAIL_PRESETS = [
  { id: 'evenings', icon: '🌆', name: 'Weekday evenings', desc: 'Mon–Fri · 7–9 pm · Normal',
    slots: [1, 2, 3, 4, 5].map(d => ({ day_of_week: d, start_time: '19:00', end_time: '21:00', study_intensity: 'Normal' })) },
  { id: 'weekend', icon: '🌤️', name: 'Weekend mornings', desc: 'Sat & Sun · 9 am–12 pm · Deep Focus',
    slots: [6, 0].map(d => ({ day_of_week: d, start_time: '09:00', end_time: '12:00', study_intensity: 'Deep Focus' })) },
  { id: 'early', icon: '🌅', name: 'Early bird', desc: 'Mon–Fri · 6–8 am · Deep Focus',
    slots: [1, 2, 3, 4, 5].map(d => ({ day_of_week: d, start_time: '06:00', end_time: '08:00', study_intensity: 'Deep Focus' })) },
];
async function applyAvailPreset(preset) {
  for (const s of preset.slots) await API.post('/api/availability', s);
}

const DEFAULT_HOURS = { 'Assignment': 3, 'CAT/Test': 4, 'Exam': 8, 'Project': 10, 'Presentation': 2, 'Other': 2 };

/** Silently refresh the study plan after deadlines/availability change. */
async function autoRegenerate() {
  try {
    const r = await API.post('/api/sessions/generate');
    if (r.created > 0) toast(`Schedule updated — ${r.created} new session${r.created === 1 ? '' : 's'}. 🗓️`, 'info');
  } catch { /* non-blocking */ }
}
