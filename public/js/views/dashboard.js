/**
 * Home: greeting, Go Premium strip, today's plan (or "all caught up"), quick adds,
 * plan + focus shortcuts, and compact smart cards (risk, recovery, roadmap, resources).
 * Plus users also get the next smart recommendation and an offline copy of the plan.
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
    if (App.isPlus()) {
      // Offline mode (Plus): keep a copy of today's plan for when there's no data
      localStorage.setItem('ef_plan', JSON.stringify({
        saved_at: new Date().toISOString(),
        today_sessions: d.today_sessions,
        upcoming_deadlines: d.upcoming_deadlines,
        roadmaps: roadmaps.filter(r => r.status !== 'Completed').slice(0, 2)
          .map(r => ({ title: r.title, progress: r.progress_percentage, next_topic: r.next_topic })),
      }));
    }
  } catch (err) {
    if (err.message === 'Not authenticated') throw err;
    return renderOfflineDashboard(el);
  }

  const plus = App.isPlus();
  const rec = plus ? (smart.recommendation.recommendations[0] || null) : null;
  const activeRoadmap = roadmaps.find(r => r.status === 'In Progress') || roadmaps.find(r => r.status === 'Not Started');
  const soon = d.upcoming_deadlines.filter(dl => daysUntil(dl.due_date) <= 3);
  const caughtUp = d.today_sessions.length === 0 && soon.length === 0;
  const recoveryCount = plus ? smart.recovery.length : (smart.recovery_count || 0);

  const SESSION_DOT = { Planned: 'bg-indigo-500', Completed: 'bg-emerald-500', Missed: 'bg-rose-500', Rescheduled: 'bg-violet-500' };

  el.innerHTML = `
    <div class="max-w-2xl mx-auto space-y-4">
      ${greetingHeader()}
      ${smart.weekly.streak >= 1 ? `<div class="inline-flex items-center gap-1.5 bg-orange-50 text-orange-700 border border-orange-100 rounded-full px-3 py-1 text-xs font-semibold -mt-1">🔥 ${smart.weekly.streak}-day study streak</div>` : ''}

      ${plus ? '' : `
        <a href="#/premium" class="card flex items-center gap-3 p-3 pr-4 bg-gradient-to-r from-amber-50 to-white active:scale-[.99] transition">
          <span class="w-12 h-12 rounded-2xl grid place-items-center text-white bg-gradient-to-br from-amber-400 to-orange-500 shadow-md shadow-amber-500/30 shrink-0 [&_svg]:w-6 [&_svg]:h-6">${icon('crown')}</span>
          <span class="flex-1 min-w-0">
            <span class="block text-[10px] font-bold tracking-wider text-amber-600">👑 PREMIUM</span>
            <span class="block text-sm font-semibold text-slate-800 truncate">Unlock Smart Insights & unlimited roadmaps</span>
          </span>
          <span class="w-8 h-8 rounded-full bg-white border border-slate-200 grid place-items-center text-slate-500 shrink-0 [&_svg]:w-4 [&_svg]:h-4">${icon('chevron')}</span>
        </a>`}

      ${d.course_count === 0 ? `
        <a href="#/setup" class="block rounded-3xl px-5 py-4 text-white bg-gradient-to-r from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/25 active:scale-[.99] transition">
          <div class="flex items-center justify-between gap-3">
            <div><div class="font-bold text-sm">🚀 Finish your 2-minute setup</div>
            <div class="text-xs text-emerald-50 mt-0.5">Add courses & free time — we'll build your first schedule.</div></div>
            <span class="text-xl shrink-0">→</span>
          </div>
        </a>` : ''}

      ${caughtUp ? `
        <div class="text-center py-6">
          <div class="text-5xl">🎉</div>
          <h3 class="font-bold text-slate-900 text-lg mt-3">You're all caught up</h3>
          <p class="text-sm text-slate-400 mt-1 max-w-xs mx-auto">Nothing due today. Add something to your planner or enjoy the free time.</p>
        </div>` : `
        <section class="card p-4">
          <div class="flex items-center justify-between mb-1">
            <h3 class="font-bold text-slate-900">Today</h3>
            <a href="#/calendar" class="text-xs font-semibold text-indigo-600">Calendar →</a>
          </div>
          ${d.today_sessions.map(s => `
            <a href="#/calendar" class="flex items-center gap-3 py-2.5 border-b border-slate-50 last:border-0">
              <span class="text-xs font-semibold text-slate-500 w-11 shrink-0">${s.start_datetime.slice(11)}</span>
              <span class="w-1 self-stretch rounded-full ${SESSION_DOT[s.status] || 'bg-slate-300'}"></span>
              <span class="flex-1 min-w-0">
                <span class="block text-sm font-medium text-slate-800 truncate">${s.reminder_enabled ? '🔔 ' : ''}${esc(s.title)}</span>
                <span class="block text-[11px] text-slate-400">${s.start_datetime.slice(11)} – ${s.end_datetime.slice(11)} · ${esc(s.status)}</span>
              </span>
            </a>`).join('')}
          ${soon.map(dl => {
            const due = dueLabel(dl.due_date);
            return `
            <a href="#/deadlines" class="flex items-center gap-3 py-2.5 border-b border-slate-50 last:border-0">
              ${tintIcon(dl.type === 'Exam' ? 'exam' : 'deadlines', 'amber', '2.25rem')}
              <span class="flex-1 min-w-0">
                <span class="block text-sm font-medium text-slate-800 truncate">${esc(dl.title)}</span>
                <span class="block text-[11px] text-slate-400">${esc(dl.course_code)} · ${esc(dl.type)}</span>
              </span>
              <span class="text-[11px] font-semibold ${due.cls} shrink-0">${due.text}</span>
            </a>`;
          }).join('')}
        </section>`}

      <div class="grid grid-cols-2 gap-3">
        <button onclick="openCreate('deadline')" class="card p-4 flex flex-col items-center gap-2 active:scale-[.97] transition">
          ${tintIcon('deadlines', 'amber')}<span class="text-sm font-medium text-slate-700">Add deadline</span>
        </button>
        <button onclick="openCreate('course')" class="card p-4 flex flex-col items-center gap-2 active:scale-[.97] transition">
          ${tintIcon('courses', 'teal')}<span class="text-sm font-medium text-slate-700">Add course</span>
        </button>
      </div>

      <a href="#/schedule?generate=1" class="flex items-center gap-3 rounded-3xl p-4 text-white bg-gradient-to-r from-[#2f4579] to-[#4c6aab] shadow-lg shadow-indigo-900/25 active:scale-[.99] transition">
        <span class="w-11 h-11 rounded-2xl bg-[#f6c453] text-[#1c2745] grid place-items-center shrink-0 [&_svg]:w-5 [&_svg]:h-5">${icon('bolt')}</span>
        <span class="flex-1 min-w-0">
          <span class="block font-semibold">Generate my study plan</span>
        </span>
        <span class="shrink-0 [&_svg]:w-5 [&_svg]:h-5">${icon('chevron')}</span>
      </a>

      <a href="#/focus" class="card flex items-center gap-3 p-4 active:scale-[.99] transition">
        <span class="text-2xl w-11 text-center shrink-0">🍅</span>
        <span class="flex-1 min-w-0">
          <span class="block font-semibold text-slate-800">Got some free time?</span>
        </span>
        <span class="text-slate-300 shrink-0 [&_svg]:w-5 [&_svg]:h-5">${icon('chevron')}</span>
      </a>

      ${rec ? `
        <section class="card p-4 border-indigo-100">
          <div class="flex items-center gap-3">
            ${tintIcon('sparkle', 'fuchsia')}
            <div class="flex-1 min-w-0">
              <div class="text-[10px] font-bold tracking-wider text-fuchsia-600">NEXT UP · SMART PICK</div>
              <div class="text-sm font-semibold text-slate-800 truncate">${esc(rec.course_code)} — ${esc(rec.course_title)}</div>
              <div class="text-[11px] text-slate-400 truncate">${fmtDT(rec.suggested_start)} · ${rec.suggested_duration_minutes} min</div>
            </div>
            <button id="dashAcceptRec" class="btn btn-primary btn-sm shrink-0">Add</button>
          </div>
        </section>` : ''}

      ${smart.risks.length ? `
        <section class="card p-4">
          <div class="flex items-center justify-between mb-1">
            <h3 class="font-bold text-slate-900">Needs your attention</h3>
            ${plus ? '<a href="#/insights" class="text-xs font-semibold text-indigo-600">Details →</a>'
                   : `<a href="#/premium" class="text-xs font-semibold text-amber-600">See why ${proBadge()}</a>`}
          </div>
          ${smart.risks.map(r => `
            <div class="flex items-center gap-3 py-2.5 border-b border-slate-50 last:border-0">
              ${badge(r.risk_level, RISK_BADGE[r.risk_level])}
              <span class="flex-1 min-w-0 text-sm font-medium text-slate-800 truncate">${esc(r.course_code)} · ${esc(r.deadline_title)}</span>
              <span class="text-[11px] text-slate-400 shrink-0">in ${r.days_left}d</span>
            </div>`).join('')}
        </section>` : ''}

      ${recoveryCount ? `
        <a href="${plus ? '#/schedule' : '#/premium'}" class="flex items-center gap-3 bg-violet-50 border border-violet-100 rounded-2xl px-4 py-3">
          ${tintIcon('recovery', 'violet', '2.25rem')}
          <span class="flex-1 min-w-0 text-sm text-violet-900">
            <span class="font-semibold">${recoveryCount} missed session${recoveryCount === 1 ? '' : 's'}</span>
            <span class="block text-xs text-violet-600">${plus ? 'Recovery slots found — tap to reschedule' : 'Auto-recover them with EduFlex Plus'}</span>
          </span>
          ${plus ? `<span class="text-violet-400 [&_svg]:w-5 [&_svg]:h-5">${icon('chevron')}</span>` : proBadge()}
        </a>` : ''}

      ${activeRoadmap ? `
        <a href="#/roadmaps/${activeRoadmap.id}" class="card p-4 flex items-center gap-3 active:scale-[.99] transition">
          ${tintIcon('roadmaps', 'blue')}
          <span class="flex-1 min-w-0">
            <span class="flex items-center gap-2 min-w-0">
              <span class="text-sm font-semibold text-slate-800 truncate">${esc(activeRoadmap.title)}</span>
              ${activeRoadmap.behind_schedule ? badge('Behind', 'bg-amber-100 text-amber-700') : ''}
            </span>
            ${activeRoadmap.next_topic ? `<span class="block text-[11px] text-slate-400 truncate mt-0.5">Next: ${esc(activeRoadmap.next_topic)}</span>` : ''}
            <span class="block mt-2">${progressBar(activeRoadmap.progress_percentage)}</span>
          </span>
          <span class="text-xs font-bold text-slate-600 shrink-0">${activeRoadmap.progress_percentage}%</span>
        </a>` : ''}

      ${smart.resource_recs.length ? `
        <section>
          <div class="flex items-center justify-between mb-2 px-1">
            <h3 class="font-bold text-slate-900">Recommended for you</h3>
            <a href="#/resources" class="text-xs font-semibold text-indigo-600">Library →</a>
          </div>
          <div class="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4 snap-x">
            ${smart.resource_recs.map(r => `
              <a href="/api/resources/${r.id}/view" target="_blank" rel="noopener" class="card p-4 min-w-[14rem] max-w-[14rem] snap-start">
                <div class="text-sm font-semibold text-slate-800 leading-snug line-clamp-2">${esc(r.title)}</div>
                <div class="text-[11px] text-slate-400 mt-1 truncate">${esc(r.category)} · ${esc(r.course_name)}</div>
                <div class="mt-2">${qualityBadge(r.quality_score, r.quality_label)}</div>
              </a>`).join('')}
          </div>
        </section>` : ''}
    </div>`;

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
    } catch (err) { if (!err.premium) toast(err.message, 'error'); }
  };
};

/** Offline fallback using the cached plan (Offline mode is an EduFlex Plus feature). */
function renderOfflineDashboard(el) {
  let plan = null;
  try { plan = JSON.parse(localStorage.getItem('ef_plan') || 'null'); } catch { plan = null; }
  if (!App.isPlus()) {
    el.innerHTML = `<div class="max-w-2xl mx-auto">${lockedCard('Offline mode',
      "You're offline. With EduFlex Plus your study plan stays available without data. The focus timer still works — sessions sync when you're back online.")}</div>`;
    return;
  }
  el.innerHTML = `
    <div class="max-w-2xl mx-auto space-y-4">
      <div class="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-900">
        📡 <strong>Offline mode.</strong> Showing your saved study plan. Changes sync when you reconnect.
      </div>
      ${!plan ? emptyState('📡', 'No saved plan yet', 'Open Home once while online and it will be available offline.') : `
        <section class="card p-5">
          <h3 class="font-bold text-slate-900 mb-1">Today's sessions</h3>
          <p class="text-xs text-slate-400 mb-3">Saved ${fmtDT(plan.saved_at.slice(0, 16))}</p>
          ${plan.today_sessions.length === 0 ? '<p class="text-sm text-slate-400 py-3 text-center">No sessions planned today.</p>'
            : plan.today_sessions.map(s => `
              <div class="flex items-center justify-between gap-3 py-2.5 border-b border-slate-50 last:border-0">
                <div class="min-w-0"><div class="font-medium text-sm text-slate-800 truncate">${esc(s.title)}</div>
                <div class="text-xs text-slate-400">${s.start_datetime.slice(11)} – ${s.end_datetime.slice(11)}</div></div>
                ${badge(s.status, STATUS_BADGE[s.status])}
              </div>`).join('')}
        </section>
        <section class="card p-5">
          <h3 class="font-bold text-slate-900 mb-3">Upcoming deadlines</h3>
          ${plan.upcoming_deadlines.map(dl => `
            <div class="flex items-center justify-between gap-3 py-2.5 border-b border-slate-50 last:border-0">
              <div class="min-w-0"><div class="font-medium text-sm text-slate-800 truncate">${esc(dl.title)}</div>
              <div class="text-xs text-slate-400">${esc(dl.course_code)} · due ${fmtDT(dl.due_date)}</div></div>
              ${badge(dl.priority, PRIORITY_BADGE[dl.priority])}
            </div>`).join('')}
        </section>
        ${(plan.roadmaps || []).length ? `
          <section class="card p-5">
            <h3 class="font-bold text-slate-900 mb-3">Active roadmaps</h3>
            ${plan.roadmaps.map(r => `
              <div class="py-2.5 border-b border-slate-50 last:border-0">
                <div class="flex items-center justify-between text-sm gap-2">
                  <span class="font-medium text-slate-800 truncate">🗺️ ${esc(r.title)}</span>
                  <span class="font-semibold text-slate-600 shrink-0">${r.progress}%</span>
                </div>
                ${r.next_topic ? `<div class="text-xs text-slate-400 mt-0.5 truncate">Next: ${esc(r.next_topic)}</div>` : ''}
              </div>`).join('')}
          </section>` : ''}
        <p class="text-xs text-slate-400 text-center">🎯 Focus mode works offline — sessions sync automatically.</p>`}
    </div>`;
}
