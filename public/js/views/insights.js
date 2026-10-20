/** Smart Insights: weekly summary, academic risk prediction, study recommendations. */
Views.insights = async (el) => {
  if (!App.isPlus()) {
    el.innerHTML = `<div class="max-w-2xl mx-auto">${lockedCard('Smart Insights',
      'See which deadlines you are at risk of missing and why, get smart picks for what to study next, and track your weekly trends.')}</div>`;
    return;
  }
  const [{ risks }, recs, weekly] = await Promise.all([
    API.get('/api/smart/risk'),
    API.get('/api/smart/recommendations'),
    API.get('/api/smart/weekly'),
  ]);

  const wStat = (value, label) => `
    <div class="bg-white/15 rounded-2xl px-4 py-3">
      <div class="text-xl font-extrabold">${value}</div>
      <div class="text-[11px] text-indigo-100">${label}</div>
    </div>`;

  el.innerHTML = `
    <div class="rounded-3xl p-5 sm:p-6 text-white bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-700 shadow-xl shadow-indigo-500/20">
      <h2 class="font-bold text-lg">This week at a glance</h2>
      <p class="text-indigo-100 text-sm mt-2 leading-relaxed">${esc(weekly.insight_text)}</p>
      <p class="text-white text-sm mt-2 font-medium">${esc(weekly.suggestion)}</p>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
        ${wStat(`${weekly.completion_pct}%`, 'Completion')}
        ${wStat(`${weekly.completed_hours}h`, 'Studied')}
        ${wStat(`${weekly.focus_minutes}m`, 'Focus time')}
        ${wStat(`${weekly.streak}d`, 'Streak')}
      </div>
    </div>

    <section class="mt-6">
      <h3 class="font-bold text-slate-900 mb-3">Academic risk prediction</h3>
      ${risks.length === 0
        ? emptyState('insights', 'No risk data yet', 'Add courses and pending deadlines — EduFlex will watch your academic risk.')
        : `<div class="grid md:grid-cols-2 gap-3 sm:gap-4">${risks.map(riskCard).join('')}</div>`}
    </section>

    <section class="mt-6">
      <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h3 class="font-bold text-slate-900">Smart study recommendations</h3>
        <button id="genRecBtn" class="btn btn-primary btn-sm">Generate</button>
      </div>
      <div id="recList">${renderRecs(recs)}</div>
    </section>`;

  function riskCard(r) {
    const pct = r.estimated_hours > 0 ? Math.min(100, Math.round((r.completed_hours / r.estimated_hours) * 100)) : 100;
    return `
      <div class="border rounded-2xl p-5 ${RISK_BORDER[r.risk_level]}">
        <div class="flex items-start justify-between gap-2">
          <span class="font-semibold text-slate-900 text-sm leading-snug">${esc(r.course_code)} — ${esc(r.deadline_title)}</span>
          ${badge(`${r.risk_level} Risk`, RISK_BADGE[r.risk_level])}
        </div>
        <p class="text-xs text-slate-600 mt-2 leading-relaxed">${esc(r.reason)}</p>
        <div class="flex justify-between text-[11px] text-slate-500 mt-3 mb-1.5">
          <span>${r.completed_hours}h / ${r.estimated_hours}h studied</span><span>${pct}%</span>
        </div>
        ${progressBar(pct, r.risk_level === 'High' ? 'bg-rose-500' : r.risk_level === 'Medium' ? 'bg-amber-500' : 'bg-emerald-500')}
        <div class="flex flex-wrap gap-3 mt-3 text-[11px] text-slate-500">
          <span>${r.days_left}d left</span><span>${r.missed_sessions} missed</span><span>${r.available_hours}h free</span>
        </div>
        ${r.risk_level !== 'Low' ? `<a href="#/schedule?generate=1" class="inline-block mt-3 text-xs font-semibold text-indigo-700">Schedule extra time →</a>` : ''}
      </div>`;
  }

  function renderRecs(data) {
    if (!data.recommendations.length) {
      return `<div class="card p-5 text-sm text-slate-500">
        ${esc(data.message || 'No recommendations right now.')}
        ${(data.message || '').includes('availability') ? ' <a href="#/availability?add=1" class="text-indigo-600 font-semibold">Add availability →</a>' : ''}
      </div>`;
    }
    return `<div class="space-y-3">${data.recommendations.map((r, i) => `
      <div class="card p-5 flex flex-wrap items-center justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-semibold text-slate-900 text-sm">${esc(r.course_code)} — ${esc(r.course_title)}</span>
            ${badge(`${r.risk_level} Risk`, RISK_BADGE[r.risk_level])}
            ${badge(`${r.suggested_duration_minutes} min`, 'bg-indigo-100 text-indigo-700')}
          </div>
          <p class="text-xs text-slate-500 mt-1.5 leading-relaxed">${esc(r.reason)}</p>
          <p class="text-xs font-medium text-slate-600 mt-1">${fmtDT(r.suggested_start)} → ${r.suggested_end.slice(11)}</p>
        </div>
        <button data-accept="${i}" class="btn btn-success btn-sm shrink-0">Add to schedule</button>
      </div>`).join('')}</div>`;
  }

  function wireAccepts(data) {
    el.querySelectorAll('[data-accept]').forEach(b => b.onclick = async () => {
      const r = data.recommendations[Number(b.dataset.accept)];
      b.disabled = true;
      try {
        await API.post('/api/smart/recommendations/accept', {
          course_id: r.course_id, deadline_id: r.deadline_id,
          start_datetime: r.suggested_start, end_datetime: r.suggested_end,
          intensity: r.intensity, title: `${r.course_code}: study for ${r.deadline_title}`,
        });
        toast('Session added to your schedule.');
        Views.insights(el);
      } catch (err) { toast(err.message, 'error'); b.disabled = false; }
    });
  }
  wireAccepts(recs);

  document.getElementById('genRecBtn').onclick = async () => {
    const btn = document.getElementById('genRecBtn');
    btn.disabled = true; btn.textContent = 'Thinking…';
    try {
      const fresh = await API.get('/api/smart/recommendations?limit=5');
      document.getElementById('recList').innerHTML = renderRecs(fresh);
      wireAccepts(fresh);
      toast(fresh.recommendations.length ? 'Recommendations updated.' : 'Nothing new to recommend.', 'info');
    } catch (err) { toast(err.message, 'error'); }
    btn.disabled = false; btn.textContent = 'Generate';
  };
};
