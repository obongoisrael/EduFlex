/** Progress: weekly insight, totals, completion ring, 7-day chart, risk + per-course breakdown. */
Views.progress = async (el) => {
  const plus = App.isPlus();
  const [p, weekly, { risks }] = await Promise.all([
    API.get('/api/stats/progress'),
    plus ? API.get('/api/smart/weekly') : null,
    plus ? API.get('/api/smart/risk') : { risks: [] },
  ]);
  const maxDaily = Math.max(1, ...p.daily.map(d => d.hours));

  const card = (ic, value, label, color) => `
    <div class="card p-4">
      <div class="[&_svg]:w-5 [&_svg]:h-5 ${color}">${icon(ic)}</div>
      <div class="text-xl sm:text-2xl font-extrabold ${color} mt-1.5">${value}</div>
      <div class="text-[11px] text-slate-400">${label}</div>
    </div>`;

  el.innerHTML = `
    ${!weekly ? `
      <a href="#/premium" class="card flex items-center gap-3 p-4">
        ${tintIcon('insights', 'fuchsia')}
        <span class="flex-1 min-w-0"><span class="flex items-center gap-2 font-semibold text-slate-800 text-sm">Weekly insights & risk by deadline ${proBadge()}</span></span>
      </a>` : `
    <div class="rounded-3xl p-5 sm:p-6 text-white bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-700 shadow-xl shadow-indigo-500/20">
      <h3 class="font-bold">Weekly progress insight</h3>
      <p class="text-indigo-100 text-sm mt-2 leading-relaxed">${esc(weekly.insight_text)}</p>
      <p class="text-white text-sm mt-2 font-medium">${esc(weekly.suggestion)}</p>
      <div class="flex flex-wrap gap-2 mt-4 text-xs">
        <span class="bg-white/15 rounded-lg px-3 py-1.5">${weekly.streak}-day streak</span>
        ${weekly.best_day ? `<span class="bg-white/15 rounded-lg px-3 py-1.5">Best: ${esc(weekly.best_day)}</span>` : ''}
        ${weekly.most_studied ? `<span class="bg-white/15 rounded-lg px-3 py-1.5">${esc(weekly.most_studied.code)} (${weekly.most_studied.hours}h)</span>` : ''}
        <span class="bg-white/15 rounded-lg px-3 py-1.5">${weekly.focus_minutes} focus min</span>
      </div>
    </div>`}

    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
      ${card('check', p.totals.Completed, 'Completed', 'text-emerald-600')}
      ${card('calendar', p.totals.Planned + p.totals.Rescheduled, 'Planned', 'text-indigo-600')}
      ${card('xcircle', p.totals.Missed, 'Missed', 'text-rose-600')}
      ${card('timer', `${p.weekly_hours}h`, 'This week', 'text-violet-600')}
    </div>

    ${weekly && (risks.length || weekly.needs_attention.length) ? `
      <div class="grid lg:grid-cols-2 gap-4 mt-4">
        <section class="card p-5">
          <h3 class="font-bold text-slate-900 text-sm sm:text-base mb-3">Risk by deadline</h3>
          ${risks.length === 0 ? '<p class="text-sm text-slate-400 py-3">No pending deadlines.</p>'
            : risks.map(r => `
              <div class="flex items-center justify-between gap-3 py-2.5 border-b border-slate-50 last:border-0">
                <div class="min-w-0">
                  <div class="text-sm font-medium text-slate-800 truncate">${esc(r.course_code)} — ${esc(r.deadline_title)}</div>
                  <div class="text-xs text-slate-400">${r.completed_hours}/${r.estimated_hours}h · in ${r.days_left}d · ${r.missed_sessions} missed</div>
                </div>
                ${badge(`${r.risk_level} (${r.risk_score})`, RISK_BADGE[r.risk_level])}
              </div>`).join('')}
          <a href="#/insights" class="inline-block mt-3 text-xs font-semibold text-indigo-600">Full analysis →</a>
        </section>
        <section class="card p-5">
          <h3 class="font-bold text-slate-900 text-sm sm:text-base mb-3">Needs attention</h3>
          ${weekly.needs_attention.length === 0 ? '<p class="text-sm text-slate-400 py-3">All courses on track.</p>'
            : weekly.needs_attention.map(c => `
              <div class="flex items-center justify-between gap-3 py-2.5 border-b border-slate-50 last:border-0">
                <span class="text-sm font-medium text-slate-800 truncate">${esc(c.code)} — ${esc(c.title)}</span>
                ${badge(`${c.pct}%`, 'bg-amber-100 text-amber-700')}
              </div>`).join('')}
        </section>
      </div>` : ''}

    <div class="grid lg:grid-cols-2 gap-4 mt-4">
      <section class="card p-5">
        <h3 class="font-bold text-slate-900 text-sm sm:text-base mb-5">Overall completion</h3>
        <div class="flex items-center gap-6">
          <div class="relative w-28 h-28 shrink-0">
            <svg viewBox="0 0 36 36" class="w-28 h-28 -rotate-90">
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e2e8f0" stroke-width="3.5"/>
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="#10b981" stroke-width="3.5"
                stroke-dasharray="${p.completion_pct} 100" stroke-linecap="round"/>
            </svg>
            <div class="absolute inset-0 grid place-items-center">
              <span class="text-2xl font-extrabold text-slate-900">${p.completion_pct}%</span>
            </div>
          </div>
          <div class="text-sm text-slate-500 space-y-1.5 min-w-0">
            <p><strong class="text-slate-800">${p.totals.Completed}</strong> of <strong class="text-slate-800">${p.total_sessions}</strong> sessions completed.</p>
            <p>${p.focus_minutes_total} focus minutes total.</p>
          </div>
        </div>
      </section>

      <section class="card p-5">
        <h3 class="font-bold text-slate-900 text-sm sm:text-base mb-5">Study hours — last 7 days</h3>
        <div class="flex items-end gap-1.5 sm:gap-2 h-36">
          ${p.daily.map(d => `
            <div class="flex-1 flex flex-col items-center gap-1.5">
              <span class="text-[10px] font-semibold text-slate-500">${d.hours || ''}</span>
              <div class="w-full rounded-t-lg transition-all ${d.hours > 0 ? 'bg-gradient-to-t from-indigo-600 to-indigo-400' : 'bg-slate-200'}"
                   style="height:${Math.round((d.hours / maxDaily) * 100)}%; min-height:${d.hours > 0 ? 6 : 3}px"></div>
              <span class="text-[10px] text-slate-400">${new Date(d.date).toLocaleDateString(undefined, { weekday: 'narrow' })}</span>
            </div>`).join('')}
        </div>
      </section>
    </div>

    <section class="card p-5 mt-4">
      <h3 class="font-bold text-slate-900 text-sm sm:text-base mb-4">Progress by course</h3>
      ${p.by_course.length === 0
        ? '<p class="text-sm text-slate-400">No courses yet — <a href="#/courses" class="text-indigo-600">add your courses</a>.</p>'
        : p.by_course.map(c => {
            const pct = c.total_sessions ? Math.round((c.completed_sessions / c.total_sessions) * 100) : 0;
            return `<div class="py-3 border-b border-slate-50 last:border-0">
              <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">${esc(c.code)}</span>
                  <span class="font-medium text-sm text-slate-800 truncate">${esc(c.title)}</span>
                </div>
                <span class="text-[11px] text-slate-400">${c.completed_sessions}/${c.total_sessions} · ${c.completed_hours.toFixed(1)}h${c.missed_sessions ? ` · <span class="text-rose-500">${c.missed_sessions} missed</span>` : ''}</span>
              </div>
              ${progressBar(pct)}
            </div>`;
          }).join('')}
    </section>`;
};
