/**
 * Admin module (admin role only — the server enforces this too).
 * Tabs: dashboard · users · resources · courses · reports · settings.
 * Admins may see full names here; student-facing views never show them.
 */
Views.admin = async (el, args = []) => {
  const tab = args[0] || 'dashboard';
  const TABS = [
    ['dashboard', '📊 Overview'], ['users', '👥 Users'], ['resources', '📚 Resources'],
    ['courses', '📘 Courses'], ['reports', '🚩 Reports'], ['settings', '⚙️ Settings'],
  ];

  el.innerHTML = `
    <div class="rounded-3xl p-5 text-white bg-gradient-to-br from-slate-800 to-slate-900 shadow-xl">
      <div class="flex items-center gap-3">
        <span class="text-2xl">🛡️</span>
        <div class="min-w-0">
          <h2 class="font-bold">Admin Console</h2>
          <p class="text-xs text-slate-400 truncate">Signed in as ${esc(App.user.email)}</p>
        </div>
      </div>
    </div>

    <div class="flex gap-2 overflow-x-auto py-3 -mx-3 px-3 sm:mx-0 sm:px-0">
      ${TABS.map(([k, label]) => `
        <a href="#/admin/${k}" class="btn btn-sm shrink-0 ${tab === k ? 'btn-primary' : 'btn-ghost'}">${label}</a>`).join('')}
    </div>

    <div id="adminBody"><div class="text-slate-400 text-sm py-10 text-center">Loading…</div></div>`;

  const body = document.getElementById('adminBody');
  try {
    if (tab === 'users') await adminUsers(body);
    else if (tab === 'resources') await adminResources(body);
    else if (tab === 'courses') await adminCourses(body);
    else if (tab === 'reports') await adminReports(body);
    else if (tab === 'settings') adminSettings(body);
    else await adminOverview(body);
  } catch (err) {
    body.innerHTML = `<div class="card p-5 text-sm text-rose-700 bg-rose-50 border-rose-200">${esc(err.message)}</div>`;
  }
};

const fullName = (u) => `${u.first_name || ''} ${u.last_name || ''}`.trim() || '—';

async function adminOverview(body) {
  const d = await API.get('/api/admin/stats');
  const s = d.stats;
  const stat = (icon, value, label, color) => `
    <div class="card p-4">
      <div class="text-lg">${icon}</div>
      <div class="text-2xl font-extrabold ${color} mt-1.5">${value}</div>
      <div class="text-[11px] text-slate-400">${label}</div>
    </div>`;

  body.innerHTML = `
    <div class="grid grid-cols-2 lg:grid-cols-5 gap-3">
      ${stat('👥', s.total_users, 'Total users', 'text-indigo-600')}
      ${stat('✅', s.active_users, 'Active users', 'text-emerald-600')}
      ${stat('📚', s.total_resources, 'Resources', 'text-violet-600')}
      ${stat('📘', s.total_courses, 'Courses', 'text-amber-600')}
      ${stat('🗓️', s.total_sessions, 'Study sessions', 'text-slate-700')}
      ${stat('👑', s.plus_users, 'Plus subscribers', 'text-amber-600')}
    </div>

    <div class="grid lg:grid-cols-2 gap-4 mt-4">
      <section class="card p-5">
        <h3 class="font-bold text-slate-900 text-sm mb-3">🆕 Recent registrations</h3>
        ${d.recent_registrations.length === 0 ? '<p class="text-sm text-slate-400 py-3">No users yet.</p>'
          : d.recent_registrations.map(u => `
            <div class="flex items-center justify-between gap-3 py-2.5 border-b border-slate-50 last:border-0">
              <div class="min-w-0">
                <div class="text-sm font-medium text-slate-800 truncate">${esc(fullName(u))}</div>
                <div class="text-xs text-slate-400 truncate">${esc(u.email)} · ${esc(u.institution || '—')}</div>
              </div>
              <div class="text-right shrink-0">
                ${badge(u.role, u.role === 'admin' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600')}
                <div class="text-[10px] text-slate-400 mt-1">${fmtDate(u.created_at)}</div>
              </div>
            </div>`).join('')}
      </section>

      <section class="card p-5">
        <h3 class="font-bold text-slate-900 text-sm mb-3">📤 Recent uploads</h3>
        ${d.recent_resources.length === 0 ? '<p class="text-sm text-slate-400 py-3">No resources yet.</p>'
          : d.recent_resources.map(r => `
            <div class="flex items-center justify-between gap-3 py-2.5 border-b border-slate-50 last:border-0">
              <div class="min-w-0">
                <div class="text-sm font-medium text-slate-800 truncate">${esc(r.title)}</div>
                <div class="text-xs text-slate-400 truncate">${esc(r.category)} · ${esc(r.public_username)} · ${esc(r.institution)}</div>
              </div>
              ${badge(r.moderation_status, r.moderation_status === 'Approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')}
            </div>`).join('')}
      </section>
    </div>

    <section class="card p-5 mt-4">
      <h3 class="font-bold text-slate-900 text-sm mb-3">🚩 Moderation queue</h3>
      ${d.moderation_list.length === 0
        ? '<p class="text-sm text-slate-400 py-3">Nothing awaiting moderation. 🎉</p>'
        : d.moderation_list.map(r => `
          <div class="flex items-center justify-between gap-3 py-2.5 border-b border-slate-50 last:border-0">
            <div class="min-w-0">
              <div class="text-sm font-medium text-slate-800 truncate">${esc(r.title)}</div>
              <div class="text-xs text-slate-400 truncate">${esc(r.course_name)} · ${esc(r.public_username)}</div>
            </div>
            <a href="#/admin/resources" class="text-xs font-semibold text-indigo-600 shrink-0">Review →</a>
          </div>`).join('')}
    </section>`;
}

async function adminUsers(body) {
  const state = (Views.admin._users ||= { search: '' });
  const { users } = await API.get(`/api/admin/users?search=${encodeURIComponent(state.search)}`);

  body.innerHTML = `
    <div class="card p-4 mb-4">
      <input id="uSearch" class="inp" placeholder="Search by email, institution or programme…" value="${esc(state.search)}">
    </div>
    <p class="text-xs text-slate-400 mb-3">${users.length} user${users.length === 1 ? '' : 's'} · full names visible to admins only</p>
    <div class="space-y-3">
      ${users.map(u => `
        <div class="card p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-center gap-3 min-w-0">
              <span class="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white grid place-items-center text-xs font-bold shrink-0">${esc(u.public_username)}</span>
              <div class="min-w-0">
                <div class="text-sm font-semibold text-slate-800 truncate">${esc(fullName(u))}</div>
                <div class="text-xs text-slate-400 truncate">${esc(u.email)}</div>
                <div class="text-xs text-slate-400 truncate">${esc(u.institution || '—')} · ${esc(u.programme || '—')}</div>
              </div>
            </div>
            <div class="flex flex-col items-end gap-1 shrink-0">
              ${badge(u.role, u.role === 'admin' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600')}
              ${badge(u.account_status, u.account_status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700')}
              ${planActiveRow(u) ? badge(`👑 Plus${u.plan_expires_at ? ` · ${fmtDate(u.plan_expires_at)}` : ''}`, 'bg-amber-100 text-amber-700') : ''}
            </div>
          </div>
          <div class="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-50">
            ${u.id !== App.user.id ? `
            <button data-status="${u.id}" data-to="${u.account_status === 'active' ? 'inactive' : 'active'}"
              class="btn btn-sm ${u.account_status === 'active' ? 'btn-ghost' : 'btn-success'}">
              ${u.account_status === 'active' ? 'Deactivate' : 'Activate'}
            </button>
            <button data-role="${u.id}" data-to="${u.role === 'admin' ? 'student' : 'admin'}" class="btn btn-soft btn-sm">
              ${u.role === 'admin' ? 'Demote to student' : 'Promote to admin'}
            </button>
            ${planActiveRow(u)
              ? `<button data-plan-off="${u.id}" class="btn btn-sm btn-ghost">Remove Plus</button>`
              : `<button data-plan-on="${u.id}" class="btn btn-sm bg-amber-100 text-amber-800">👑 Grant Plus</button>`}
            <button data-del="${u.id}" class="btn btn-sm border border-rose-200 text-rose-600 bg-white">Delete</button>`
            : '<span class="text-[11px] text-slate-400 self-center">(you — your own account can\'t be changed here)</span>'}
          </div>
        </div>`).join('')}
    </div>`;

  let deb;
  document.getElementById('uSearch').oninput = (e) => {
    clearTimeout(deb); deb = setTimeout(() => { state.search = e.target.value.trim(); adminUsers(body); }, 400);
  };
  body.querySelectorAll('[data-status]').forEach(b => b.onclick = async () => {
    try { await API.patch(`/api/admin/users/${b.dataset.status}/status`, { status: b.dataset.to }); toast(`Account ${b.dataset.to}.`); adminUsers(body); }
    catch (err) { toast(err.message, 'error'); }
  });
  body.querySelectorAll('[data-role]').forEach(b => b.onclick = async () => {
    if (!await confirmModal(`Change this user's role to ${b.dataset.to}?`, 'Change role')) return;
    try { await API.patch(`/api/admin/users/${b.dataset.role}/role`, { role: b.dataset.to }); toast(`Role set to ${b.dataset.to}.`); adminUsers(body); }
    catch (err) { toast(err.message, 'error'); }
  });
  body.querySelectorAll('[data-plan-on]').forEach(b => b.onclick = () => {
    const u = users.find(x => x.id === Number(b.dataset.planOn));
    openModal('Grant EduFlex Plus', `
      <p class="text-sm text-slate-600">Activate Plus for <strong>${esc(u.email)}</strong> for:</p>
      <div class="grid grid-cols-2 gap-2 mt-4">
        ${[[30, '1 month'], [120, 'Semester (4 months)'], [365, '1 year'], [0, 'No expiry']]
          .map(([d, t]) => `<button data-days="${d}" class="btn btn-ghost">${t}</button>`).join('')}
      </div>`);
    document.querySelectorAll('#modalRoot [data-days]').forEach(x => x.onclick = async () => {
      try {
        await API.patch(`/api/admin/users/${u.id}/plan`, { plan: 'plus', days: Number(x.dataset.days) });
        closeModal(); toast('EduFlex Plus activated. 👑'); adminUsers(body);
      } catch (err) { toast(err.message, 'error'); }
    });
  });
  body.querySelectorAll('[data-plan-off]').forEach(b => b.onclick = async () => {
    if (!await confirmModal('Remove EduFlex Plus from this account?', 'Remove Plus')) return;
    try { await API.patch(`/api/admin/users/${b.dataset.planOff}/plan`, { plan: 'free' }); toast('Plus removed.'); adminUsers(body); }
    catch (err) { toast(err.message, 'error'); }
  });
  body.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!await confirmModal('Delete this user and all their data? This cannot be undone.')) return;
    try { await API.del(`/api/admin/users/${b.dataset.del}`); toast('User deleted.'); adminUsers(body); }
    catch (err) { toast(err.message, 'error'); }
  });
}

async function adminResources(body) {
  const state = (Views.admin._res ||= { search: '', status: '' });
  const q = new URLSearchParams();
  if (state.search) q.set('search', state.search);
  if (state.status) q.set('status', state.status);
  const { resources } = await API.get(`/api/admin/resources?${q}`);

  body.innerHTML = `
    <div class="card p-4 mb-4 grid sm:grid-cols-2 gap-2">
      <input id="rSearch" class="inp" placeholder="Search title, course or uploader email…" value="${esc(state.search)}">
      <select id="rStatus" class="inp">
        <option value="">All statuses</option>
        ${['Approved', 'Rejected', 'Pending'].map(s => `<option ${state.status === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>
    <p class="text-xs text-slate-400 mb-3">${resources.length} resource${resources.length === 1 ? '' : 's'}</p>
    <div class="space-y-3">
      ${resources.map(r => `
        <div class="card p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-sm font-semibold text-slate-800">${esc(r.title)}</div>
              <div class="text-xs text-slate-400 mt-0.5 truncate">${esc(r.category)} · ${esc(r.course_name)} · ${esc(r.institution)}</div>
              <div class="text-xs text-slate-400 truncate">Uploaded by ${esc(fullName(r))} (${esc(r.email || '—')}) · ${fmtDate(r.created_at)}</div>
              ${r.moderation_note ? `<div class="text-[11px] text-slate-400 mt-1 italic">Note: ${esc(r.moderation_note)}</div>` : ''}
            </div>
            ${badge(r.moderation_status, r.moderation_status === 'Approved' ? 'bg-emerald-100 text-emerald-700' : r.moderation_status === 'Rejected' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700')}
          </div>
          <div class="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-50">
            <a href="/api/resources/${r.id}/view" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">👁 View</a>
            ${r.moderation_status !== 'Approved' ? `<button data-approve="${r.id}" class="btn btn-success btn-sm">✓ Approve</button>` : ''}
            ${r.moderation_status !== 'Rejected' ? `<button data-reject="${r.id}" class="btn btn-sm bg-amber-500 text-white">✗ Reject</button>` : ''}
            <button data-del="${r.id}" class="btn btn-sm border border-rose-200 text-rose-600 bg-white">🗑 Delete</button>
          </div>
        </div>`).join('')}
      ${resources.length === 0 ? emptyState('📚', 'No resources found', 'Try a different search or status filter.') : ''}
    </div>`;

  let deb;
  document.getElementById('rSearch').oninput = (e) => {
    clearTimeout(deb); deb = setTimeout(() => { state.search = e.target.value.trim(); adminResources(body); }, 400);
  };
  document.getElementById('rStatus').onchange = (e) => { state.status = e.target.value; adminResources(body); };
  body.querySelectorAll('[data-approve]').forEach(b => b.onclick = async () => {
    try { await API.patch(`/api/admin/resources/${b.dataset.approve}/approve`, {}); toast('Resource approved.'); adminResources(body); }
    catch (err) { toast(err.message, 'error'); }
  });
  body.querySelectorAll('[data-reject]').forEach(b => b.onclick = async () => {
    if (!await confirmModal('Reject this resource? It will be hidden from students.', 'Reject')) return;
    try { await API.patch(`/api/admin/resources/${b.dataset.reject}/reject`, {}); toast('Resource rejected.', 'info'); adminResources(body); }
    catch (err) { toast(err.message, 'error'); }
  });
  body.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!await confirmModal('Permanently delete this resource?')) return;
    try { await API.del(`/api/admin/resources/${b.dataset.del}`); toast('Resource deleted.'); adminResources(body); }
    catch (err) { toast(err.message, 'error'); }
  });
}

async function adminCourses(body) {
  const [{ courses }, { sessions }] = await Promise.all([
    API.get('/api/admin/courses'), API.get('/api/admin/study-sessions'),
  ]);
  body.innerHTML = `
    <section class="card p-5">
      <h3 class="font-bold text-slate-900 text-sm mb-3">📘 All courses (${courses.length})</h3>
      <div class="overflow-x-auto -mx-5 px-5">
        <table class="w-full text-sm min-w-[520px]">
          <thead><tr class="text-left text-xs text-slate-400 border-b border-slate-100">
            <th class="py-2 pr-3 font-semibold">Course</th><th class="py-2 pr-3 font-semibold">Code</th>
            <th class="py-2 pr-3 font-semibold">Difficulty</th><th class="py-2 font-semibold">Owner</th>
          </tr></thead>
          <tbody>${courses.map(c => `
            <tr class="border-b border-slate-50 last:border-0">
              <td class="py-2.5 pr-3 font-medium text-slate-800">${esc(c.title)}</td>
              <td class="py-2.5 pr-3 text-slate-500">${esc(c.code)}</td>
              <td class="py-2.5 pr-3">${badge(c.difficulty, DIFFICULTY_BADGE[c.difficulty])}</td>
              <td class="py-2.5 text-slate-500 text-xs">${esc(fullName(c))}<br><span class="text-slate-400">${esc(c.email || '')}</span></td>
            </tr>`).join('')}</tbody>
        </table>
      </div>
    </section>

    <section class="card p-5 mt-4">
      <h3 class="font-bold text-slate-900 text-sm mb-3">🗓️ Recent study sessions (${sessions.length})</h3>
      <div class="space-y-2">
        ${sessions.slice(0, 25).map(s => `
          <div class="flex items-center justify-between gap-3 py-2 border-b border-slate-50 last:border-0">
            <div class="min-w-0">
              <div class="text-sm font-medium text-slate-800 truncate">${esc(s.title)}</div>
              <div class="text-xs text-slate-400 truncate">${esc(fullName(s))} · ${fmtDT(s.start_datetime)}</div>
            </div>
            ${badge(s.status, STATUS_BADGE[s.status])}
          </div>`).join('')}
        ${sessions.length === 0 ? '<p class="text-sm text-slate-400 py-3">No study sessions yet.</p>' : ''}
      </div>
    </section>`;
}

async function adminReports(body) {
  const { reports } = await API.get('/api/admin/reports');
  body.innerHTML = `
    <p class="text-xs text-slate-400 mb-3">Resources flagged or awaiting moderation.</p>
    ${reports.length === 0
      ? emptyState('🚩', 'No reported content', 'Everything in the library is approved. 🎉')
      : `<div class="space-y-3">${reports.map(r => `
          <div class="card p-4">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="text-sm font-semibold text-slate-800">${esc(r.title)}</div>
                <div class="text-xs text-slate-400 truncate">${esc(r.category)} · ${esc(r.course_name)}</div>
                <div class="text-xs text-slate-400 truncate">By ${esc(fullName(r))} (${esc(r.email || '—')}) · ${fmtDate(r.created_at)}</div>
                ${r.moderation_note ? `<div class="text-[11px] text-slate-400 mt-1 italic">${esc(r.moderation_note)}</div>` : ''}
              </div>
              ${badge(r.moderation_status, 'bg-amber-100 text-amber-700')}
            </div>
            <div class="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-50">
              <a href="/api/resources/${r.id}/view" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">👁 View</a>
              <button data-approve="${r.id}" class="btn btn-success btn-sm">✓ Approve</button>
              <button data-del="${r.id}" class="btn btn-sm border border-rose-200 text-rose-600 bg-white">🗑 Delete</button>
            </div>
          </div>`).join('')}</div>`}`;

  body.querySelectorAll('[data-approve]').forEach(b => b.onclick = async () => {
    try { await API.patch(`/api/admin/resources/${b.dataset.approve}/approve`, {}); toast('Approved.'); adminReports(body); }
    catch (err) { toast(err.message, 'error'); }
  });
  body.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!await confirmModal('Permanently delete this resource?')) return;
    try { await API.del(`/api/admin/resources/${b.dataset.del}`); toast('Deleted.'); adminReports(body); }
    catch (err) { toast(err.message, 'error'); }
  });
}

function adminSettings(body) {
  body.innerHTML = `
    <div class="card p-5 sm:p-6">
      <h3 class="font-bold text-slate-900 mb-4">System settings</h3>
      <dl class="space-y-3 text-sm">
        <div class="flex justify-between gap-3 py-2 border-b border-slate-50">
          <dt class="text-slate-500">Signed in as</dt><dd class="font-medium text-slate-800 text-right">${esc(App.user.email)}</dd>
        </div>
        <div class="flex justify-between gap-3 py-2 border-b border-slate-50">
          <dt class="text-slate-500">Role</dt><dd>${badge('admin', 'bg-violet-100 text-violet-700')}</dd>
        </div>
        <div class="flex justify-between gap-3 py-2 border-b border-slate-50">
          <dt class="text-slate-500">Upload policy</dt><dd class="font-medium text-slate-800 text-right">PDF only · max 20 MB</dd>
        </div>
        <div class="flex justify-between gap-3 py-2">
          <dt class="text-slate-500">Moderation</dt><dd class="font-medium text-slate-800 text-right">Auto-approve, admin can reject</dd>
        </div>
      </dl>

      <div class="mt-6 bg-slate-50 rounded-2xl p-4">
        <h4 class="font-semibold text-slate-800 text-sm">Creating another admin</h4>
        <ol class="text-xs text-slate-500 mt-2 space-y-1 list-decimal list-inside leading-relaxed">
          <li>Ask the person to register normally in the app.</li>
          <li>Find them under <a href="#/admin/users" class="text-indigo-600 font-medium">Users</a> and tap <strong>Promote to admin</strong>.</li>
        </ol>
        <p class="text-xs text-slate-400 mt-3">Or directly in the database:</p>
        <code class="block text-[11px] bg-slate-900 text-emerald-300 rounded-xl p-3 mt-1.5 overflow-x-auto">UPDATE users SET role = 'admin' WHERE email = 'admin@eduflex.com';</code>
      </div>

      <div class="mt-4 bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-800 leading-relaxed">
        🔒 <strong>Privacy reminder:</strong> full student names are visible only inside this admin console.
        Student-facing pages always show initials and institution only.
      </div>
    </div>`;
}

/** Plus active on an admin user-list row (mirrors the server rule, minus the admin shortcut). */
function planActiveRow(u) {
  return u.plan === 'plus' && (!u.plan_expires_at || new Date(u.plan_expires_at) > new Date());
}
