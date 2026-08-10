/**
 * Dashboard: welcome, smart cards (risk, recommendation, recovery, roadmap),
 * quick actions, stats, deadlines, today's sessions, weekly insight,
 * reminders and recommended resources. Falls back to a cached plan offline.
 */
Views.dashboard = async (el) => {
  let d, smart, roadmaps = [];
  try {
    const [dd, ss, rr] = await Promise.all([
      API.get('/api/stats/dashboard'),
      API.get('/api/smart/dashboard'),
      API.get('/api/roadmaps').catch(() => ({ roadmaps: [] })),
    ]);
    d = dd; smart = ss; roadmaps = rr.roadmaps || [];
    localStorage.setItem('ef_plan', JSON.stringify({
      saved_at: new Date().toISOString(),
      today_sessions: d.today_sessions,
      upcoming_deadlines: d.upcoming_deadlines,
      roadmaps: roadmaps.filter(r => r.status !== 'Completed').slice(0, 2)
        .map(r => ({ title: r.title, progress: r.progress_percentage, next_topic: r.next_topic })),
    }));
  } catch (err) {
    if (err.message === 'Not authenticated') throw err;
    return renderOfflineDashboard(el);
  }

  const u = App.user;
  const weeklyPct = d.weekly.total_hours > 0 ? Math.round((d.weekly.completed_hours / d.weekly.total_hours) * 100) : 0;
  const rec = smart.recommendation.recommendations[0] || null;
  const activeRoadmap = roadmaps.find(r => r.status === 'In Progress') || roadmaps.find(r => r.status === 'Not Started');

  el.innerHTML = `
    <!-- Welcome -->
    <div class="rounded-3xl p-5 sm:p-7 text-white bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-700 shadow-xl shadow-indigo-500/20">
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <h2 class="text-xl sm:text-2xl font-bold truncate">Hi ${esc(u.first_name)} 👋</h2>
          <p class="text-indigo-100 text-xs sm:text-sm mt-1 truncate">
            <span class="font-semibold">${esc(u.public_username)}</span> · ${esc(u.institution)}
          </p>
        </div>
        <div class="text-right shrink-0">
          <div class="text-3xl font-extrabold leading-none">${weeklyPct}%</div>
          <div class="text-indigo-200 text-[10px] mt-1">week complete</div>
        </div>
      </div>
      ${smart.weekly.streak >= 1 ? `<div class="mt-4 inline-flex items-center gap-1.5 bg-white/15 rounded-full px-3 py-1.5 text-xs font-semibold">🔥 ${smart.weekly.streak}-day streak</div>` : ''}
    </div>

    ${d.course_count === 0 ? `
      <a href="#/setup" class="mt-4 block rounded-2xl px-5 py-4 text-white bg-gradient-to-r from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/25 active:scale-[.99] transition">
        <div class="flex items-center justify-between gap-3">
          <div><div class="font-bold text-sm">🚀 Finish your 2-minute setup</div>
          <div class="text-xs text-emerald-50 mt-0.5">Add courses & free time — we'll build your first schedule.</div></div>
          <span class="text-xl shrink-0">→</span>
        </div>
      </a>` : ''}

    <!-- Risk alerts -->
    ${smart.risks.length ? `
      <div class="card p-4 sm:p-5 mt-4">
        <div class="flex items-center justify-between mb-2">
          <h3 class="font-bold text-slate-900 text-sm sm:text-base">⚠️ Needs your attention</h3>
          <a href="#/insights" class="text-xs font-semibold text-indigo-600">Details →</a>
        </div>
        ${smart.risks.map(r => {
          const pct = r.estimated_hours > 0 ? Math.min(100, Math.round((r.completed_hours / r.estimated_hours) * 100)) : 100;
          return `
          <div class="flex items-center gap-3 py-2.5 border-b border-slate-50 last:border-0">
            ${badge(r.risk_level, RISK_BADGE[r.risk_level])}
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium text-slate-800 truncate">${esc(r.course_code)} · ${esc(r.deadline_title)}</div>
              <div class="mt-1.5 max-w-[12rem]">${progressBar(pct, r.risk_level === 'High' ? 'bg-rose-500' : r.risk_level === 'Medium' ? 'bg-amber-500' : 'bg-emerald-500')}</div>
            </div>
            <div class="text-right text-[11px] text-slate-500 shrink-0 leading-tight">
              in ${r.days_left}d<br>${r.completed_hours}/${r.estimated_hours}h
            </div>
          </div>`;
        }).join('')}
      </div>` : ''}

    <!-- Recovery -->
    ${smart.recovery.length ? `
      <div class="mt-4 bg-violet-50 border border-violet-200 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
        <p class="text-sm text-violet-900 min-w-0 truncate">↻ ${smart.recovery.length} missed session${smart.recovery.length === 1 ? '' : 's'} — recovery slots found</p>
        <a href="#/schedule" class="text-xs font-semibold text-violet-700 shrink-0">Recover →</a>
      </div>` : ''}

    <!-- Smart recommendation -->
    <div class="card p-4 sm:p-5 mt-4 border-indigo-200">
      ${rec ? `
        <div class="flex items-center gap-3 sm:gap-4">
          <span class="text-2xl shrink-0">✨</span>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-semibold text-slate-800 truncate">Next: ${esc(rec.course_code)} — ${esc(rec.course_title)}</div>
            <div class="text-xs text-slate-500 mt-0.5 truncate">🕒 ${fmtDT(rec.suggested_start)} · ${rec.suggested_duration_minutes} min</div>
          </div>
          <button id="dashAcceptRec" class="btn btn-success btn-sm shrink-0">➕ Add</button>
        </div>`
      : `<div class="flex items-center gap-3">
          <span class="text-2xl shrink-0">✨</span>
          <p class="text-sm text-slate-500 flex-1">${esc(smart.recommendation.message || "You're all caught up!")}</p>
        </div>`}
    </div>

    <!-- Active roadmap -->
    ${activeRoadmap ? `
      <a href="#/roadmaps/${activeRoadmap.id}" class="card p-4 sm:p-5 mt-4 block active:scale-[.99] transition">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 min-w-0">
              <span class="text-lg shrink-0">🗺️</span>
              <span class="text-sm font-semibold text-slate-800 truncate">${esc(activeRoadmap.title)}</span>
              ${activeRoadmap.behind_schedule ? badge('⚠ Behind', 'bg-amber-100 text-amber-700') : ''}
            </div>
            ${activeRoadmap.next_topic ? `<div class="text-xs text-slate-400 mt-1 truncate">➡️ ${esc(activeRoadmap.next_topic)}</div>` : ''}
          </div>
          <div class="text-right shrink-0 w-20 sm:w-28">
            <div class="text-xs font-bold text-slate-700 mb-1">${activeRoadmap.progress_percentage}%</div>
            ${progressBar(activeRoadmap.progress_percentage)}
          </div>
        </div>
      </a>` : ''}

    <!-- Quick actions -->
    <div class="grid grid-cols-3 sm:grid-cols-6 gap-2 sm:gap-3 mt-4">
      ${qa('#/courses?add=1', '📘', 'Course')}
      ${qa('#/deadlines?add=1', '⏰', 'Deadline')}
      ${qa('#/availability?add=1', '🕒', 'Free time')}
      ${qa('#/schedule?generate=1', '⚡', 'Generate')}
      ${qa('#/resources?upload=1', '📤', 'Upload')}
      ${qa('#/focus', '🎯', 'Focus')}
    </div>

    <!-- Stats -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
      ${stat('📘', d.course_count, 'Courses', 'text-indigo-600')}
      ${stat('⏰', d.upcoming_deadlines.length, 'Deadlines', 'text-amber-600')}
      ${stat('🗓️', d.today_sessions.length, 'Today', 'text-violet-600')}
      ${stat('✅', `${d.weekly.completed_hours.toFixed(1)}h`, 'This week', 'text-emerald-600')}
    </div>

    <div class="grid lg:grid-cols-2 gap-4 mt-4">
      <!-- Deadlines -->
      <section class="card p-4 sm:p-5">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-bold text-slate-900 text-sm sm:text-base">Upcoming deadlines</h3>
          <a href="#/deadlines" class="text-xs font-semibold text-indigo-600">All →</a>
        </div>
        ${d.upcoming_deadlines.length === 0
          ? '<p class="text-sm text-slate-400 py-6 text-center">No upcoming deadlines 🎉</p>'
          : d.upcoming_deadlines.map(dl => {
              const due = dueLabel(dl.due_date);
              return `<div class="flex items-center justify-between gap-3 py-2.5 border-b border-slate-50 last:border-0">
                <div class="min-w-0">
                  <div class="font-medium text-sm text-slate-800 truncate">${dl.reminder_enabled ? '🔔 ' : ''}${esc(dl.title)}</div>
                  <div class="text-xs text-slate-400">${esc(dl.course_code)} · ${esc(dl.type)}</div>
                </div>
                <div class="text-right shrink-0">
                  ${badge(dl.priority, PRIORITY_BADGE[dl.priority])}
                  <div class="text-[11px] font-medium mt-1 ${due.cls}">${due.text}</div>
                </div></div>`;
            }).join('')}
      </section>

      <!-- Today -->
      <section class="card p-4 sm:p-5">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-bold text-slate-900 text-sm sm:text-base">Today's sessions</h3>
          <a href="#/calendar" class="text-xs font-semibold text-indigo-600">Calendar →</a>
        </div>
        ${d.today_sessions.length === 0
          ? `<p class="text-sm text-slate-400 py-6 text-center">Nothing today. <a class="text-indigo-600 font-medium" href="#/schedule?generate=1">Generate a plan?</a></p>`
          : d.today_sessions.map(s => `
            <div class="flex items-center justify-between gap-3 py-2.5 border-b border-slate-50 last:border-0">
              <div class="min-w-0">
                <div class="font-medium text-sm text-slate-800 truncate">${s.reminder_enabled ? '🔔 ' : ''}${esc(s.title)}</div>
                <div class="text-xs text-slate-400">${s.start_datetime.slice(11)} – ${s.end_datetime.slice(11)}</div>
              </div>
              ${badge(s.status, STATUS_BADGE[s.status])}
            </div>`).join('')}
      </section>
    </div>

    <div class="grid lg:grid-cols-2 gap-4 mt-4">
      <!-- Weekly -->
      <section class="card p-4 sm:p-5">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-bold text-slate-900 text-sm sm:text-base">📊 This week</h3>
          <a href="#/progress" class="text-xs font-semibold text-indigo-600">Progress →</a>
        </div>
        <div class="flex justify-between text-sm mb-1.5">
          <span class="text-slate-500">${d.weekly.completed_hours.toFixed(1)}h of ${d.weekly.total_hours.toFixed(1)}h planned</span>
          <span class="font-bold text-slate-700">${weeklyPct}%</span>
        </div>
        ${progressBar(weeklyPct, 'bg-emerald-500')}
        <div class="flex flex-wrap gap-2 mt-4 text-[11px]">
          ${smart.weekly.best_day ? `<span class="bg-indigo-50 text-indigo-700 rounded-lg px-2.5 py-1 font-medium">⭐ ${esc(smart.weekly.best_day)}</span>` : ''}
          <span class="bg-slate-50 text-slate-600 rounded-lg px-2.5 py-1 font-medium">🎯 ${d.focus_minutes_week} focus min</span>
        </div>
        <p class="text-xs text-slate-500 mt-3 line-clamp-2">💡 ${esc(smart.weekly.suggestion)}</p>
      </section>

      <!-- Reminders -->
      <section class="card p-4 sm:p-5">
        <h3 class="font-bold text-slate-900 text-sm sm:text-base mb-3">🔔 Upcoming reminders</h3>
        ${(App.upcomingReminders || []).length === 0
          ? `<p class="text-sm text-slate-400 py-4 text-center">No reminders set. Turn them on for <a href="#/calendar" class="text-indigo-600 font-medium">sessions</a> or <a href="#/deadlines" class="text-indigo-600 font-medium">deadlines</a>.</p>`
          : App.upcomingReminders.slice(0, 4).map(r => `
            <div class="py-2 border-b border-slate-50 last:border-0">
              <div class="font-medium text-sm text-slate-700 truncate">${r.kind === 'deadline' ? '⏰' : '🗓️'} ${esc(r.title)}</div>
              <div class="text-xs text-slate-400">reminds ${fmtDT(r.remind_at)}</div>
            </div>`).join('')}
        ${('Notification' in window) && Notification.permission !== 'granted'
          ? `<button id="enableNotifBtn" class="btn btn-soft btn-sm btn-block mt-3">🔔 Enable notifications</button>` : ''}
      </section>
    </div>

    <!-- Recommended resources -->
    <section class="card p-4 sm:p-5 mt-4">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-bold text-slate-900 text-sm sm:text-base">📚 Recommended for you</h3>
        <a href="#/resources" class="text-xs font-semibold text-indigo-600">Library →</a>
      </div>
      ${smart.resource_recs.length === 0
        ? '<p class="text-sm text-slate-400 py-4 text-center">No matching resources yet.</p>'
        : `<div class="grid sm:grid-cols-3 gap-3">
            ${smart.resource_recs.map(r => `
              <a href="#/resources" class="border border-slate-100 rounded-2xl p-4 hover:border-indigo-300 transition block">
                <div class="text-sm font-semibold text-slate-800 leading-snug line-clamp-2">${esc(r.title)}</div>
                <div class="text-xs text-slate-400 mt-1 truncate">${esc(r.category)} · ${esc(r.course_name)}</div>
                <div class="mt-2">${qualityBadge(r.quality_score, r.quality_label)}</div>
              </a>`).join('')}
          </div>`}
    </section>`;

  if (rec) document.getElementById('dashAcceptRec').onclick = async (e) => {
    e.currentTarget.disabled = true;
    try {
      await API.post('/api/smart/recommendations/accept', {
        course_id: rec.course_id, deadline_id: rec.deadline_id,
        start_datetime: rec.suggested_start, end_datetime: rec.suggested_end,
        intensity: rec.intensity, title: `${rec.course_code}: study for ${rec.deadline_title}`,
      });
      toast('Session added to your schedule. 🗓️');
      Views.dashboard(el);
    } catch (err) { toast(err.message, 'error'); }
  };
  const enableBtn = document.getElementById('enableNotifBtn');
  if (enableBtn) enableBtn.onclick = async () => {
    if (await App.enableBrowserNotifications()) {
      try {
        await API.put('/api/auth/profile', { notification_preferences: { browser: true, sound: true } });
        App.user.notification_preferences = { browser: true, sound: true };
      } catch { /* preference save is best-effort */ }
      enableBtn.remove();
    }
  };

  function qa(href, icon, label) {
    return `<a href="${href}" class="card p-3 text-center active:scale-95 transition hover:border-indigo-300">
      <div class="text-xl sm:text-2xl">${icon}</div>
      <div class="text-[11px] sm:text-xs font-semibold text-slate-600 mt-1">${label}</div></a>`;
  }
  function stat(icon, value, label, color) {
    return `<div class="card p-4">
      <div class="text-lg">${icon}</div>
      <div class="text-xl sm:text-2xl font-extrabold ${color} mt-1.5">${value}</div>
      <div class="text-[11px] text-slate-400">${label}</div></div>`;
  }
};

/** Offline fallback using the cached plan. */
function renderOfflineDashboard(el) {
  let plan = null;
  try { plan = JSON.parse(localStorage.getItem('ef_plan') || 'null'); } catch { plan = null; }
  el.innerHTML = `
    <div class="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-900">
      📡 <strong>Offline mode.</strong> Showing your saved study plan. Changes sync when you reconnect.
    </div>
    ${!plan ? `<div class="mt-4">${emptyState('📡', 'No cached plan yet', 'Open the dashboard once while online and it will be available offline.')}</div>` : `
      <section class="card p-5 mt-4">
        <h3 class="font-bold text-slate-900 mb-1">Today's sessions (cached)</h3>
        <p class="text-xs text-slate-400 mb-3">Saved ${fmtDT(plan.saved_at.slice(0, 16))}</p>
        ${plan.today_sessions.length === 0 ? '<p class="text-sm text-slate-400 py-3 text-center">No sessions planned today.</p>'
          : plan.today_sessions.map(s => `
            <div class="flex items-center justify-between gap-3 py-2.5 border-b border-slate-50 last:border-0">
              <div class="min-w-0"><div class="font-medium text-sm text-slate-800 truncate">${esc(s.title)}</div>
              <div class="text-xs text-slate-400">${s.start_datetime.slice(11)} – ${s.end_datetime.slice(11)}</div></div>
              ${badge(s.status, STATUS_BADGE[s.status])}
            </div>`).join('')}
      </section>
      <section class="card p-5 mt-4">
        <h3 class="font-bold text-slate-900 mb-3">Upcoming deadlines (cached)</h3>
        ${plan.upcoming_deadlines.map(dl => `
          <div class="flex items-center justify-between gap-3 py-2.5 border-b border-slate-50 last:border-0">
            <div class="min-w-0"><div class="font-medium text-sm text-slate-800 truncate">${esc(dl.title)}</div>
            <div class="text-xs text-slate-400">${esc(dl.course_code)} · due ${fmtDT(dl.due_date)}</div></div>
            ${badge(dl.priority, PRIORITY_BADGE[dl.priority])}
          </div>`).join('')}
      </section>
      ${(plan.roadmaps || []).length ? `
        <section class="card p-5 mt-4">
          <h3 class="font-bold text-slate-900 mb-3">Active roadmaps (cached)</h3>
          ${plan.roadmaps.map(r => `
            <div class="py-2.5 border-b border-slate-50 last:border-0">
              <div class="flex items-center justify-between text-sm gap-2">
                <span class="font-medium text-slate-800 truncate">🗺️ ${esc(r.title)}</span>
                <span class="font-semibold text-slate-600 shrink-0">${r.progress}%</span>
              </div>
              ${r.next_topic ? `<div class="text-xs text-slate-400 mt-0.5 truncate">➡️ ${esc(r.next_topic)}</div>` : ''}
            </div>`).join('')}
        </section>` : ''}
      <p class="text-xs text-slate-400 mt-4 text-center">🎯 Focus mode works offline — sessions sync automatically.</p>`}`;
}
