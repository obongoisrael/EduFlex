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
        try { localStorage.setItem('ef_user', JSON.stringify(user)); } catch { /* storage unavailable */ }
      } catch (err) {
        // No connection (not "logged out"): open with the account saved on this device,
        // so offline mode can show the saved study plan.
        const noNetwork = err instanceof TypeError || !navigator.onLine;
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem('ef_user') || 'null'); } catch { saved = null; }
        if (!noNetwork || !saved) {
          document.getElementById('view').innerHTML =
            '<div class="text-center py-20 text-sm text-slate-500">Redirecting to login… ' +
            '<a href="/login.html" class="text-indigo-600 font-semibold hover:underline">Click here</a> if nothing happens.</div>';
          window.location.replace('/login.html');
          return;
        }
        user = saved;
      }
      App.user = user;
      App.renderUserChrome();
      // Accounts created with Google don't have an institution/programme yet — ask once first
      if (!user.profile_complete && navigator.onLine) await App.completeProfile();
      window.addEventListener('hashchange', App.route);
      App.initOffline();
      App.startReminderLoop();
      App.route();
    } catch (err) {
      console.error('EduFlex startup error:', err);
      document.getElementById('view').innerHTML = `
        <div class="max-w-md mx-auto mt-16 card p-6 text-center border-rose-200 bg-rose-50">
          <div class="w-12 h-12 mx-auto mb-3 rounded-2xl bg-rose-100 text-rose-600 grid place-items-center [&_svg]:w-6 [&_svg]:h-6">${icon('alert')}</div>
          <h2 class="font-bold text-rose-800">Something went wrong while starting EduFlex</h2>
          <p class="text-xs text-rose-600 mt-2">${esc(err.message || 'Unknown error')}</p>
          <button onclick="location.reload()" class="btn btn-primary mt-5">Reload the app</button>
        </div>`;
    }
  },

  renderUserChrome() {
    document.getElementById('topAvatar').textContent = App.user.public_username;
    document.getElementById('topInstitution').textContent = App.user.institution;
    App.renderNav();
  },

  /** Desktop sidebar (mobile uses the bottom bar + the #/more features page). */
  renderNav() {
    const items = [
      { route: 'dashboard', label: 'Home' },
      { route: 'calendar', label: 'Calendar' },
      ...NAV_SECTIONS.flatMap(sec => sec.items).filter(n => n.route && n.route !== 'calendar' && navVisible(n)),
    ];
    document.getElementById('nav').innerHTML = items.map(n => `
      <a href="#/${n.route}" data-route="${n.route}" class="nav-link">
        <span class="nav-ic">${icon(n.icon || n.route)}</span>
        <span class="flex-1 truncate">${esc(n.label)}</span>
        ${n.pro && !App.isPlus() ? proBadge() : ''}
      </a>`).join('');
    document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
  },

  /**
   * One-time "finish your profile" step (new Google sign-ups). Resolves once saved.
   * Navigation is hidden until then, so the app never runs with a half-made profile.
   */
  completeProfile() {
    const u = App.user;
    const nav = [document.getElementById('tabbar'), document.getElementById('sidebar')];
    nav.forEach(n => n && n.classList.add('!hidden'));
    document.getElementById('pageTitle').textContent = 'Welcome';
    return new Promise((resolve) => {
      document.getElementById('view').innerHTML = `
        <div class="max-w-md mx-auto card p-6 sm:p-7 mt-2">
          <h2 class="text-xl font-bold text-slate-900 mt-3">Welcome to EduFlex, ${esc(u.first_name)}!</h2>
          <p class="text-sm text-slate-500 mt-1">One last step: where do you study?</p>
          <form id="cpForm" class="space-y-4 mt-5" novalidate>
            <div class="grid grid-cols-2 gap-3">
              ${field('First name', `<input class="inp" id="cp_first" value="${esc(u.first_name)}" required>`)}
              ${field('Last name', `<input class="inp" id="cp_last" value="${esc(u.last_name)}" required>`)}
            </div>
            ${field('Institution', `<input class="inp" id="cp_inst" required>`)}
            ${field('Programme / course of study', `<input class="inp" id="cp_prog" required>`)}
            <button type="submit" id="cp_save" class="btn btn-primary btn-block">Continue</button>
          </form>
        </div>`;
      document.getElementById('cpForm').onsubmit = async (e) => {
        e.preventDefault();
        const body = {
          first_name: document.getElementById('cp_first').value.trim(),
          last_name: document.getElementById('cp_last').value.trim(),
          institution: document.getElementById('cp_inst').value.trim(),
          programme: document.getElementById('cp_prog').value.trim(),
        };
        if (!body.first_name || !body.last_name || !body.institution || !body.programme) {
          return toast('Please fill in all the fields.', 'error');
        }
        const btn = document.getElementById('cp_save');
        btn.disabled = true;
        try {
          const { user } = await API.put('/api/auth/profile', body);
          App.user = user;
          App.renderUserChrome();
          nav.forEach(n => n && n.classList.remove('!hidden'));
          if (!location.hash || location.hash === '#/dashboard') location.hash = '#/setup';
          resolve();
        } catch (err) {
          toast(err.message, 'error');
          btn.disabled = false;
        }
      };
    });
  },

  /** EduFlex Plus active? (admins always are — computed server-side) */
  isPlus() { return !!(App.user && App.user.is_plus); },

  async logout() {
    try { await API.post('/api/auth/logout'); } catch { /* leaving anyway */ }
    // Don't leave this account's details or study plan behind on a shared device
    try { ['ef_user', 'ef_plan', 'ef_roadmaps_cache'].forEach(k => localStorage.removeItem(k)); } catch { /* ignore */ }
    location.href = '/login.html';
  },

  titles: {
    dashboard: 'Home', courses: 'Courses', deadlines: 'Deadlines',
    availability: 'Availability', schedule: 'Study Schedule', calendar: 'Calendar',
    focus: 'Focus Mode', resources: 'Resource Library', progress: 'Progress',
    profile: 'Profile', insights: 'Smart Insights', peers: 'Peer Study',
    setup: 'Get Started', roadmaps: 'Learning Roadmaps', admin: 'Admin',
    more: 'Menu', premium: 'EduFlex Plus',
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

    document.querySelectorAll('[data-route]').forEach(a => a.classList.toggle('active', a.dataset.route === name));
    // Bottom bar: Home / Calendar / Insights are their own tabs; everything else lives under the grid (More)
    const tab = ['dashboard', 'calendar', 'resources'].includes(name) ? name : 'more';
    document.querySelectorAll('.tab').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
    // Home and the features page carry their own greeting header on phones
    document.getElementById('topbar').classList.toggle('mobile-hide', name === 'dashboard' || name === 'more');
    closeCreate();

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
    window.addEventListener('online', () => { apply(); toast('Back online — syncing.'); App.route(); });
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
      if (r.synced > 0) toast(`Synced ${r.synced} offline focus session${r.synced === 1 ? '' : 's'}.`);
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
    if (App.isPlus() && prefs.browser && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('EduFlex', { body: msg });
    }
    if (App.isPlus() && prefs.sound !== false) App.playBeep(); // free plan: in-app reminder only

    openModal('Reminder', `
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
    if (perm === 'granted') { toast('Browser notifications enabled.'); return true; }
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
  return `<span class="inline-block text-[11px] font-semibold px-2.5 py-1 rounded-full ${cls}" title="Resource quality score">${score}% · ${esc(label)}</span>`;
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

/* ---------- navigation icons + items ---------- */

// Line icons (24×24, stroke-based) so navigation looks crisp and consistent on every device.
const ICONS = {
  dashboard: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
  roadmaps: '<path d="M9 4 3 6.5V20l6-2.5 6 2.5 6-2.5V4l-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>',
  courses: '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5z"/><path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H20v-3"/><path d="M8 7h8M8 11h5"/>',
  deadlines: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M5 3 2 6M19 3l3 3"/>',
  exam: '<path d="M9 3h6l1 3H8z"/><rect x="5" y="5" width="14" height="16" rx="2"/><path d="m9 13 2 2 4-4"/>',
  availability: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  schedule: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18M9 15.5l2 2 4-4"/>',
  calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
  insights: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  focus: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  resources: '<path d="M4 3h4v18H4zM10 3h4v18h-4z"/><path d="m15.5 4.2 3.7-1 3.3 16.8-3.7 1z"/>',
  peers: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
  progress: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-6"/><path d="M15 8h5v5"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  admin: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  menu: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.3 3.3M6.6 6.6C3.8 8.3 2 12 2 12s3.5 7 10 7c1.9 0 3.6-.6 5-1.5"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M2 2l20 20"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  flag: '<path d="M4 22V4M4 4h13l-2 4 2 4H4"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  sunrise: '<path d="M17 18a5 5 0 0 0-10 0M12 2v7M4.2 10.2l1.4 1.4M1 18h2M21 18h2M18.4 11.6l1.4-1.4M23 22H1M8 6l4-4 4 4"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
  xcircle: '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4M10 2h4"/>',
  cap: '<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/><path d="M22 10v6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  crown: '<path d="m3 8 4 4 5-7 5 7 4-4-2 11H5z"/><path d="M5 21h14"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  recovery: '<path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/>',
  offline: '<path d="M2 2l20 20"/><path d="M8.5 16.5a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 5.2-2.8M19 12.9a10 10 0 0 0-2.3-1.6M2 8.8a15 15 0 0 1 4.2-2.7M22 8.8A15 15 0 0 0 11 5M12 20h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  upload: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
};
function icon(name) {
  return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

// Tinted icon squares for the features page (background, foreground).
const TINTS = {
  amber: ['#fef3c7', '#d97706'], sky: ['#e0f2fe', '#0284c7'], violet: ['#ede9fe', '#7c3aed'],
  emerald: ['#d1fae5', '#059669'], blue: ['#dbeafe', '#2563eb'], rose: ['#ffe4e6', '#e11d48'],
  teal: ['#ccfbf1', '#0d9488'], orange: ['#ffedd5', '#ea580c'], fuchsia: ['#fae8ff', '#c026d3'],
  slate: ['#f1f5f9', '#475569'], gold: ['#fef9c3', '#ca8a04'],
};
function tintIcon(name, tint, size = '2.5rem') {
  const [bg, fg] = TINTS[tint] || TINTS.slate;
  return `<span class="tint-ic" style="width:${size};height:${size};background:${bg};color:${fg}">${icon(name)}</span>`;
}

/**
 * Single source for the features page (#/more) and the desktop sidebar.
 * pro: EduFlex Plus feature · plusHref: where Plus users go when the item has no page of its own.
 */
const NAV_SECTIONS = [
  { title: 'Your studies', items: [
    { route: 'resources', label: 'Resource Library', desc: 'Shared notes & past papers', tint: 'teal' },
    { route: 'deadlines', label: 'Deadlines', desc: 'Assignments, CATs, exams & projects', tint: 'amber' },
    { route: 'courses', label: 'Courses', desc: 'Your units and how hard they are', tint: 'sky' },
    { route: 'schedule', label: 'Schedule', desc: 'Your auto-built study plan', tint: 'violet' },
    { route: 'availability', label: 'Availability', desc: 'When you are free to study', tint: 'emerald' },
    { route: 'calendar', label: 'Calendar', desc: 'Day, week and month views', tint: 'blue' },
  ] },
  { title: 'Tools', items: [
    { route: 'insights', label: 'Smart Insights', desc: 'Risk prediction & what to study next', tint: 'fuchsia', pro: true },
    { route: 'roadmaps', label: 'Roadmaps', desc: 'Step-by-step learning paths · 1 free', tint: 'blue', freeTag: '1 FREE' },
    { route: 'focus', label: 'Focus Timer', desc: 'Pomodoro sessions that count', tint: 'rose' },
    { route: 'peers', label: 'Peer Study', desc: 'Find classmates to study with', tint: 'orange' },
    { route: 'progress', label: 'Progress', desc: 'Hours, streaks & completion', tint: 'emerald' },
    { key: 'recovery', icon: 'recovery', label: 'Missed-Session Recovery', desc: 'Auto-reschedule what you missed', tint: 'violet', pro: true, plusHref: '#/schedule' },
    { key: 'offline', icon: 'offline', label: 'Offline Mode', desc: 'Your plan and timer without data', tint: 'slate', pro: true, plusHref: '#/profile' },
  ] },
  { title: 'Account', items: [
    { route: 'premium', icon: 'crown', label: 'EduFlex Plus', desc: 'Plans, benefits & your subscription', tint: 'gold' },
    { route: 'profile', label: 'Profile & Settings', desc: 'Details, notifications & privacy', tint: 'slate' },
    { route: 'admin', label: 'Admin', desc: 'Manage users, resources & plans', tint: 'violet', admin: true },
  ] },
];
function navVisible(n) { return !n.admin || (App.user && App.user.role === 'admin'); }

/* ---------- premium (EduFlex Plus) ---------- */

// Where students write for Plus activation and support (same as the Privacy Policy contact).
const SUPPORT_EMAIL = 'israelmusk00@gmail.com';

// Display prices — payments are not connected yet (admins grant Plus manually).
// Monthly price per country, set for local spending power rather than a straight
// currency conversion. The 4-month plan is always 4 months less SEMESTER_DISCOUNT.
const SEMESTER_DISCOUNT = 0.15;
const PRICE_REGIONS = [
  { code: 'KE', name: 'Kenya', cur: 'KES', monthly: 99, pay: 'M-Pesa' },
  { code: 'UG', name: 'Uganda', cur: 'UGX', monthly: 2900, pay: 'MTN MoMo or Airtel Money' },
  { code: 'TZ', name: 'Tanzania', cur: 'TZS', monthly: 2000, pay: 'M-Pesa, Airtel Money or Tigo Pesa' },
  { code: 'RW', name: 'Rwanda', cur: 'RWF', monthly: 1000, pay: 'MTN MoMo or Airtel Money' },
  { code: 'NG', name: 'Nigeria', cur: 'NGN', monthly: 1200, pay: 'card, bank transfer or USSD' },
  { code: 'GH', name: 'Ghana', cur: 'GHS', monthly: 10, pay: 'MTN MoMo, Telecel Cash or card' },
  { code: 'ZA', name: 'South Africa', cur: 'ZAR', monthly: 19, pay: 'card or instant EFT' },
  { code: 'ET', name: 'Ethiopia', cur: 'ETB', monthly: 100, pay: 'telebirr' },
  { code: 'EG', name: 'Egypt', cur: 'EGP', monthly: 40, pay: 'card or mobile wallet' },
  { code: 'ZM', name: 'Zambia', cur: 'ZMW', monthly: 20, pay: 'MTN MoMo or Airtel Money' },
  { code: 'AF', name: 'Other African countries', cur: 'USD', monthly: 0.99, pay: 'mobile money or card' },
  { code: 'WW', name: 'Rest of the world', cur: 'USD', monthly: 2.99, pay: 'card' },
];
// Time zone → country, so students see their own currency without being asked.
const TZ_REGION = {
  'Africa/Nairobi': 'KE', 'Africa/Kampala': 'UG', 'Africa/Dar_es_Salaam': 'TZ', 'Africa/Kigali': 'RW',
  'Africa/Lagos': 'NG', 'Africa/Accra': 'GH', 'Africa/Johannesburg': 'ZA', 'Africa/Addis_Ababa': 'ET',
  'Africa/Cairo': 'EG', 'Africa/Lusaka': 'ZM',
};
function priceRegion() {
  let saved = null;
  try { saved = localStorage.getItem('ef_region'); } catch {}
  let code = PRICE_REGIONS.some(r => r.code === saved) ? saved : null;
  if (!code) {
    let tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch {}
    code = TZ_REGION[tz] || (tz.startsWith('Africa/') ? 'AF' : 'WW');
  }
  return PRICE_REGIONS.find(r => r.code === code);
}
function setPriceRegion(code) { try { localStorage.setItem('ef_region', code); } catch {} }
function fmtMoney(cur, n) {
  const whole = Number.isInteger(n) && cur !== 'USD';
  return `${cur} ${n.toLocaleString('en', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 })}`;
}
function plansFor(region) {
  const { cur, monthly } = region;
  const decimals = cur === 'USD' ? 100 : 1;
  const semester = Math.round(monthly * 4 * (1 - SEMESTER_DISCOUNT) * decimals) / decimals;
  return [
    { id: 'monthly', name: 'Monthly', price: fmtMoney(cur, monthly), per: 'per month' },
    { id: 'semester', name: '4 months', price: fmtMoney(cur, semester), per: 'per 4 months',
      note: `Save ${Math.round(SEMESTER_DISCOUNT * 100)}%`, sub: `${fmtMoney(cur, Math.round(semester / 4 * decimals) / decimals)} a month`, best: true },
  ];
}
// [icon, title, what it does, where it lives] — keep descriptions true to what the code does.
const PLUS_FEATURES = [
  ['insights', 'Smart Insights', 'See which deadlines you are at risk of missing and why, plus a weekly report: hours studied, sessions completed, best study day and streak.', '#/insights'],
  ['sparkle', 'Smart recommendations', 'EduFlex suggests what to study next and a free time slot to do it in. Add it to your schedule in one tap.', '#/insights'],
  ['roadmaps', 'Unlimited roadmaps', 'Create a learning roadmap for every unit you take (free plan: 1). Includes up to 30 AI-built roadmaps a month (free plan: 3).', '#/roadmaps'],
  ['recovery', 'Missed-session recovery', 'Missed a study session? EduFlex finds free slots in the next 7 days and reschedules it in one tap.', '#/schedule'],
  ['bell', 'Alarm reminders', 'Reminders play a sound and show a phone notification while EduFlex is open (free plan: in-app message only).', '#/profile'],
  ['offline', 'Offline mode', 'Open your saved study plan and upcoming deadlines without internet or data.', '#/dashboard'],
  ['resources', 'Library quality filters', 'Show only "Highly recommended" notes and past papers, or sort the library by quality score.', '#/resources'],
];

function proBadge() { return '<span class="pro-badge">PRO</span>'; }

/** Blue "Go Premium" strip (hidden for Plus users). */
function premiumBanner() {
  if (App.isPlus()) return '';
  return `
    <a href="#/premium" class="premium-banner">
      <span class="w-11 h-11 rounded-2xl bg-white/20 grid place-items-center shrink-0 text-amber-300">${icon('crown')}</span>
      <span class="flex-1 min-w-0">
        <span class="block font-bold text-white">Go Premium</span>
      </span>
      <span class="text-white/80 shrink-0">${icon('chevron')}</span>
    </a>`;
}

/** Full-card lock shown in place of a Plus feature. */
function lockedCard(title, desc) {
  return `
    <div class="card p-6 sm:p-8 text-center">
      <div class="w-14 h-14 mx-auto rounded-2xl grid place-items-center text-white bg-gradient-to-br from-amber-400 to-orange-500 shadow-lg shadow-amber-500/30">${icon('crown')}</div>
      <div class="mt-3">${proBadge()}</div>
      <h3 class="font-bold text-slate-900 text-lg mt-2">${esc(title)}</h3>
      <p class="text-sm text-slate-500 mt-1.5 max-w-sm mx-auto leading-relaxed">${esc(desc)}</p>
      <a href="#/premium" class="btn btn-primary mt-5 inline-flex">Unlock with EduFlex Plus</a>
    </div>`;
}

/** Upgrade prompt (called automatically when the server answers 402). */
function showUpgrade(message) {
  openModal('EduFlex Plus', `
    <div class="text-center">
      <div class="w-14 h-14 mx-auto rounded-2xl grid place-items-center text-white bg-gradient-to-br from-amber-400 to-orange-500 shadow-lg shadow-amber-500/30">${icon('crown')}</div>
      <p class="text-sm text-slate-600 mt-4">${esc(message || 'This is an EduFlex Plus feature.')}</p>
    </div>
    <ul class="mt-5 space-y-2.5">
      ${PLUS_FEATURES.slice(0, 4).map(([ic, t]) => `
        <li class="flex items-center gap-3 text-sm text-slate-700">${tintIcon(ic, 'sky', '2rem')}<span>${esc(t)}</span></li>`).join('')}
    </ul>
    <div class="grid grid-cols-2 gap-2 mt-6">
      <button class="btn btn-ghost" onclick="closeModal()">Not now</button>
      <a href="#/premium" class="btn btn-primary" onclick="closeModal()">See plans</a>
    </div>`);
}

const INPUT_CLS = 'inp';
function field(label, inputHTML) {
  return `<div><label class="block text-sm font-medium text-slate-700 mb-1.5">${label}</label>${inputHTML}</div>`;
}
function emptyState(ic, title, hint, actionHTML = '') {
  return `
    <div class="text-center py-14 px-5 card border-dashed">
      <div class="w-14 h-14 mx-auto mb-4 rounded-2xl bg-indigo-50 text-indigo-500 grid place-items-center [&_svg]:w-7 [&_svg]:h-7">${icon(ic)}</div>
      <h3 class="font-semibold text-slate-700">${esc(title)}</h3>
      <p class="text-sm text-slate-400 mt-1 max-w-sm mx-auto">${esc(hint)}</p>
      ${actionHTML ? `<div class="mt-5">${actionHTML}</div>` : ''}
    </div>`;
}

/* ---------- efficiency helpers ---------- */

const AVAIL_PRESETS = [
  { id: 'evenings', icon: 'moon', name: 'Weekday evenings', desc: 'Mon–Fri · 7–9 pm · Normal',
    slots: [1, 2, 3, 4, 5].map(d => ({ day_of_week: d, start_time: '19:00', end_time: '21:00', study_intensity: 'Normal' })) },
  { id: 'weekend', icon: 'sun', name: 'Weekend mornings', desc: 'Sat & Sun · 9 am–12 pm · Deep Focus',
    slots: [6, 0].map(d => ({ day_of_week: d, start_time: '09:00', end_time: '12:00', study_intensity: 'Deep Focus' })) },
  { id: 'early', icon: 'sunrise', name: 'Early bird', desc: 'Mon–Fri · 6–8 am · Deep Focus',
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
    if (r.created > 0) toast(`Schedule updated — ${r.created} new session${r.created === 1 ? '' : 's'}.`, 'info');
  } catch { /* non-blocking */ }
}
