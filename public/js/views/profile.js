/** Profile: public identity card, personal details, notification/peer/offline settings. */
Views.profile = async (el) => {
  const u = App.user;
  const prefs = u.notification_preferences || {};

  el.innerHTML = `
    <div class="grid lg:grid-cols-3 gap-4">
      <!-- Public identity -->
      <div class="card p-6 text-center h-fit">
        <div class="w-20 h-20 mx-auto rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white grid place-items-center text-2xl font-extrabold shadow-lg shadow-indigo-500/30">
          ${esc(u.public_username)}
        </div>
        <h3 class="font-bold text-slate-900 mt-4">${esc(u.public_username)}</h3>
        <p class="text-sm text-slate-500">${esc(u.institution)}</p>
        <p class="text-xs text-slate-400 mt-1">${esc(u.programme)}</p>
        ${u.role === 'admin' ? `<div class="mt-3">${badge('Administrator', 'bg-violet-100 text-violet-700')}</div>` : ''}
        <div class="mt-5 text-xs bg-indigo-50 text-indigo-800 border border-indigo-100 rounded-2xl p-3.5 text-left leading-relaxed">
          <strong>This is your public identity.</strong> Other students see only your initials and institution —
          your full name (${esc(u.first_name)} ${esc(u.last_name)}) stays private.
        </div>
        <p class="text-[11px] text-slate-300 mt-4">Member since ${fmtDate(u.created_at)}</p>
      </div>

      <!-- Settings -->
      <div class="lg:col-span-2 space-y-4">
        <a href="#/premium" class="card flex items-center gap-3 p-4">
          ${tintIcon('crown', 'gold')}
          <span class="flex-1 min-w-0">
            <span class="block text-xs text-slate-400">Your plan</span>
            <span class="block font-semibold text-slate-800">${App.isPlus() ? `EduFlex Plus${u.role === 'admin' ? ' · included with admin' : u.plan_expires_at ? ` · until ${fmtDate(u.plan_expires_at)}` : ''}` : 'Free'}</span>
          </span>
          ${App.isPlus() ? '' : '<span class="btn btn-primary btn-sm">Go Premium</span>'}
        </a>

        <div class="card p-5 sm:p-6">
          <h3 class="font-bold text-slate-900">Profile settings</h3>
          <form id="profileForm" class="space-y-4">
            <div class="grid sm:grid-cols-2 gap-3">
              ${field('First name', `<input class="inp" id="pf_first" required value="${esc(u.first_name)}">`)}
              ${field('Last name', `<input class="inp" id="pf_last" required value="${esc(u.last_name)}">`)}
            </div>
            ${field('Email <span class="text-slate-400 font-normal">(cannot be changed)</span>',
              `<input class="inp bg-slate-50 text-slate-400" value="${esc(u.email)}" disabled>`)}
            <div class="grid sm:grid-cols-2 gap-3">
              ${field('Institution', `<input class="inp" id="pf_inst" required value="${esc(u.institution)}">`)}
              ${field('Programme', `<input class="inp" id="pf_prog" required value="${esc(u.programme)}">`)}
            </div>
            <div class="grid sm:grid-cols-2 gap-3">
              ${field(u.has_password ? 'New password <span class="text-slate-400 font-normal">(leave blank to keep)</span>'
                : 'Set a password <span class="text-slate-400 font-normal">(optional — you sign in with Google)</span>',
                `<input type="password" class="inp" id="pf_pass" minlength="8" autocomplete="new-password">`)}
              ${u.has_password ? field('Current password <span class="text-slate-400 font-normal">(to change it)</span>',
                `<input type="password" class="inp" id="pf_current" autocomplete="current-password">`) : ''}
            </div>
            <div class="flex justify-end">
              <button type="submit" class="btn btn-primary btn-block sm:w-auto">Save changes</button>
            </div>
          </form>
        </div>

        <div class="card p-5 sm:p-6 space-y-4">
          <h3 class="font-bold text-slate-900 text-sm">Notifications &amp; privacy</h3>
          <label class="flex items-center justify-between gap-3 text-sm text-slate-700 cursor-pointer">
            <span>Browser notifications for reminders ${App.isPlus() ? '' : proBadge()}</span>
            <input type="checkbox" id="np_browser" ${prefs.browser && App.isPlus() ? 'checked' : ''} class="w-5 h-5 rounded border-slate-300 text-indigo-600 shrink-0">
          </label>
          <label class="flex items-center justify-between gap-3 text-sm text-slate-700 cursor-pointer">
            <span>Alarm sound with reminders ${App.isPlus() ? '' : proBadge()}</span>
            <input type="checkbox" id="np_sound" ${prefs.sound !== false && App.isPlus() ? 'checked' : ''} class="w-5 h-5 rounded border-slate-300 text-indigo-600 shrink-0">
          </label>
          <label class="flex items-start justify-between gap-3 text-sm text-slate-700 cursor-pointer">
            <span>Allow Peer Study Matching<br><span class="text-xs text-slate-400">Shows only your initials + institution</span></span>
            <input type="checkbox" id="np_peers" ${u.peer_matching_enabled ? 'checked' : ''} class="w-5 h-5 rounded border-slate-300 text-indigo-600 shrink-0 mt-0.5">
          </label>
          <div class="flex items-center justify-between gap-3 text-sm text-slate-700 bg-slate-50 rounded-2xl px-4 py-3">
            <span>Offline sync status</span>
            <span id="syncStatus" class="text-xs font-semibold"></span>
          </div>
        </div>
      </div>
    </div>`;

  document.getElementById('profileForm').onsubmit = async (e) => {
    e.preventDefault();
    const body = {
      first_name: document.getElementById('pf_first').value.trim(),
      last_name: document.getElementById('pf_last').value.trim(),
      institution: document.getElementById('pf_inst').value.trim(),
      programme: document.getElementById('pf_prog').value.trim(),
    };
    const pass = document.getElementById('pf_pass').value;
    if (pass) {
      body.password = pass;
      const cur = document.getElementById('pf_current');
      if (cur) body.current_password = cur.value;
    }
    if (!body.first_name || !body.last_name || !body.institution || !body.programme)
      return toast('All fields are required.', 'error');
    if (pass && (pass.length < 8 || !/[a-z]/i.test(pass) || !/\d/.test(pass)))
      return toast('New password needs at least 8 characters, with letters and numbers.', 'error');
    if (pass && u.has_password && !body.current_password) return toast('Enter your current password to change it.', 'error');
    try {
      const { user } = await API.put('/api/auth/profile', body);
      App.user = user; App.renderUserChrome();
      toast('Profile updated.');
      Views.profile(el);
    } catch (err) { toast(err.message, 'error'); }
  };

  const savePrefs = async () => {
    try {
      const { user } = await API.put('/api/auth/profile', {
        notification_preferences: {
          browser: document.getElementById('np_browser').checked,
          sound: document.getElementById('np_sound').checked,
        },
      });
      App.user = user;
      toast('Preferences saved.', 'info');
    } catch (err) { toast(err.message, 'error'); }
  };
  // Browser notifications + alarm sound are Plus; free users get in-app reminders
  for (const id of ['np_browser', 'np_sound']) {
    if (!App.isPlus()) document.getElementById(id).addEventListener('change', (e) => {
      e.stopImmediatePropagation(); e.target.checked = false;
      showUpgrade('Alarm sounds and phone notifications are EduFlex Plus features. Free reminders appear inside the app.');
    });
  }
  document.getElementById('np_browser').onchange = async (e) => {
    if (e.target.checked && !(await App.enableBrowserNotifications())) { e.target.checked = false; return; }
    savePrefs();
  };
  document.getElementById('np_sound').onchange = savePrefs;
  document.getElementById('np_peers').onchange = async (e) => {
    try {
      await API.put('/api/peers/preferences', { enabled: e.target.checked });
      App.user.peer_matching_enabled = e.target.checked;
      toast(e.target.checked ? 'Peer matching enabled.' : 'Peer matching disabled.', 'info');
    } catch (err) { toast(err.message, 'error'); }
  };

  const queue = JSON.parse(localStorage.getItem('ef_focus_queue') || '[]');
  document.getElementById('syncStatus').innerHTML = queue.length === 0
    ? '<span class="text-emerald-600">✓ All synced</span>'
    : `<span class="text-amber-600">${queue.length} waiting</span>`;
};
