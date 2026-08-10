/** Schedule: generate plan, smart recommendations, missed-session recovery, upcoming list. */
Views.schedule = async (el) => {
  const today = new Date().toISOString().slice(0, 10);
  const [{ sessions }, recs, { suggestions: recovery }] = await Promise.all([
    API.get(`/api/sessions?from=${today}`),
    API.get('/api/smart/recommendations'),
    API.get('/api/smart/recovery'),
  ]);
  const upcoming = sessions.filter(s => s.status === 'Planned' || s.status === 'Rescheduled');

  el.innerHTML = `
    <div class="card p-5 sm:p-6">
      <h2 class="font-bold text-slate-900 text-base sm:text-lg">Adaptive Study Schedule</h2>
      <p class="text-sm text-slate-500 mt-1.5 leading-relaxed">
        Built from your <a href="#/availability" class="text-indigo-600 font-medium">availability</a>, course difficulty and
        <a href="#/deadlines" class="text-indigo-600 font-medium">deadline</a> urgency. Urgent work is scheduled first.
      </p>
      <button id="genBtn" class="btn btn-primary btn-block sm:w-auto mt-4">⚡ Generate Study Schedule</button>
      <div id="genResult" class="hidden mt-4 text-sm rounded-2xl px-4 py-3"></div>
    </div>

    ${recovery.length ? `
      <div class="bg-violet-50 border border-violet-200 rounded-2xl p-4 sm:p-5 mt-4">
        <h3 class="font-bold text-violet-900 text-sm mb-3">↻ Missed session recovery</h3>
        ${recovery.map((rc, ri) => `
          <div class="bg-white rounded-2xl p-4 mb-3 last:mb-0">
            <p class="text-sm text-slate-700 leading-relaxed">
              Missed <strong>${Math.round(rc.duration_minutes / 60 * 10) / 10}h ${esc(rc.course_title)}</strong> (${fmtDT(rc.missed_at)}).
              ${rc.options.length ? `Found ${rc.options.length} recovery slot${rc.options.length === 1 ? '' : 's'}:` : 'No free slots this week — pick a custom time.'}
            </p>
            <div class="flex flex-wrap gap-2 mt-3">
              ${rc.options.map((o, oi) => `<button data-recover="${ri}:${oi}" class="btn btn-sm bg-violet-600 text-white">${fmtDT(o.start_datetime)}</button>`).join('')}
              <button data-recover-custom="${ri}" class="btn btn-sm border border-violet-300 text-violet-700 bg-white">Custom…</button>
              <button data-recover-ignore="${ri}" class="btn btn-sm text-slate-400 bg-transparent">Ignore</button>
            </div>
          </div>`).join('')}
      </div>` : ''}

    ${recs.recommendations.length ? `
      <div class="card p-4 sm:p-5 mt-4 border-indigo-200">
        <div class="flex items-center justify-between mb-2">
          <h3 class="font-bold text-slate-900 text-sm sm:text-base">✨ Smart recommendations</h3>
          <a href="#/insights" class="text-xs font-semibold text-indigo-600">All →</a>
        </div>
        ${recs.recommendations.map((r, i) => `
          <div class="flex flex-wrap items-center justify-between gap-3 py-3 border-b border-slate-50 last:border-0">
            <p class="text-sm text-slate-700 flex-1 min-w-[12rem]">${esc(r.reason)}</p>
            <button data-rec-accept="${i}" class="btn btn-success btn-sm shrink-0">➕ Add</button>
          </div>`).join('')}
      </div>` : ''}

    <h3 class="font-bold text-slate-900 mt-6 mb-3" id="upcomingHeading">Upcoming sessions (${upcoming.length})</h3>
    <div id="sessionList">
      ${upcoming.length === 0
        ? emptyState('🗓️', 'No upcoming sessions', 'Tap "Generate Study Schedule" to build your adaptive plan.')
        : renderGroups(upcoming)}
    </div>`;

  function renderGroups(list) {
    const groups = {};
    for (const s of list) (groups[s.start_datetime.slice(0, 10)] ||= []).push(s);
    return Object.entries(groups).map(([date, items]) => `
      <div class="mb-5">
        <div class="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">
          ${new Date(date).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
        </div>
        <div class="space-y-2">
          ${items.map(s => `
            <div class="card px-4 py-3.5 flex flex-wrap items-center justify-between gap-2">
              <div class="min-w-0 flex-1">
                <div class="font-medium text-sm text-slate-800 truncate">${esc(s.title)}</div>
                <div class="text-xs text-slate-400 mt-0.5 truncate">
                  ${s.start_datetime.slice(11)} – ${s.end_datetime.slice(11)} · ${esc(s.study_intensity)}
                  ${s.deadline_title ? `· ${esc(s.deadline_title)}` : ''}
                </div>
              </div>
              ${badge(s.status, STATUS_BADGE[s.status])}
            </div>`).join('')}
        </div>
      </div>`).join('');
  }

  const genBtn = document.getElementById('genBtn');
  const resultBox = document.getElementById('genResult');

  async function generate() {
    genBtn.disabled = true; genBtn.textContent = 'Generating…';
    try {
      const r = await API.post('/api/sessions/generate');
      resultBox.className = `mt-4 text-sm rounded-2xl px-4 py-3 ${r.created > 0 ? 'bg-emerald-50 text-emerald-800 border border-emerald-100' : 'bg-amber-50 text-amber-800 border border-amber-100'}`;
      resultBox.innerHTML = r.messages.map(m => `<div>• ${esc(m)}</div>`).join('');
      resultBox.classList.remove('hidden');
      if (r.created > 0) {
        toast(`Created ${r.created} study session${r.created === 1 ? '' : 's'}.`);
        const { sessions: fresh } = await API.get(`/api/sessions?from=${today}`);
        const up = fresh.filter(s => s.status === 'Planned' || s.status === 'Rescheduled');
        document.getElementById('upcomingHeading').textContent = `Upcoming sessions (${up.length})`;
        document.getElementById('sessionList').innerHTML = up.length ? renderGroups(up)
          : emptyState('🗓️', 'No upcoming sessions', 'Add deadlines and availability first.');
      }
    } catch (err) { toast(err.message, 'error'); }
    genBtn.disabled = false; genBtn.textContent = '⚡ Generate Study Schedule';
  }
  genBtn.onclick = generate;
  if (location.hash.includes('generate=1')) { history.replaceState(null, '', '#/schedule'); generate(); }

  el.querySelectorAll('[data-recover]').forEach(b => b.onclick = async () => {
    const [ri, oi] = b.dataset.recover.split(':').map(Number);
    const rc = recovery[ri], o = rc.options[oi];
    try {
      await API.post(`/api/smart/recovery/${rc.session_id}/accept`, { start_datetime: o.start_datetime, end_datetime: o.end_datetime });
      toast('Recovery session scheduled. ↻'); Views.schedule(el);
    } catch (err) { toast(err.message, 'error'); }
  });
  el.querySelectorAll('[data-recover-custom]').forEach(b => b.onclick = () => {
    const rc = recovery[Number(b.dataset.recoverCustom)];
    openModal('Custom recovery time', `
      <p class="text-sm text-slate-600 mb-4">New time for your missed <strong>${esc(rc.course_title)}</strong> session (${rc.duration_minutes} min).</p>
      ${field('Start', `<input type="datetime-local" class="inp" id="rcStart">`)}
      <div class="mt-4">${field('End', `<input type="datetime-local" class="inp" id="rcEnd">`)}</div>
      <div class="flex flex-col-reverse sm:flex-row justify-end gap-2 mt-5">
        <button onclick="closeModal()" class="btn btn-ghost">Cancel</button>
        <button id="rcSave" class="btn btn-primary">Schedule recovery</button>
      </div>`);
    document.getElementById('rcSave').onclick = async () => {
      const start = document.getElementById('rcStart').value, end = document.getElementById('rcEnd').value;
      if (!start || !end || end <= start) return toast('End must be after start.', 'error');
      try {
        await API.post(`/api/smart/recovery/${rc.session_id}/accept`, { start_datetime: start, end_datetime: end });
        closeModal(); toast('Recovery session scheduled. ↻'); Views.schedule(el);
      } catch (err) { toast(err.message, 'error'); }
    };
  });
  el.querySelectorAll('[data-recover-ignore]').forEach(b => b.onclick = async () => {
    const rc = recovery[Number(b.dataset.recoverIgnore)];
    try { await API.post(`/api/smart/recovery/${rc.session_id}/ignore`); toast('Dismissed.', 'info'); Views.schedule(el); }
    catch (err) { toast(err.message, 'error'); }
  });
  el.querySelectorAll('[data-rec-accept]').forEach(b => b.onclick = async () => {
    const r = recs.recommendations[Number(b.dataset.recAccept)];
    try {
      await API.post('/api/smart/recommendations/accept', {
        course_id: r.course_id, deadline_id: r.deadline_id,
        start_datetime: r.suggested_start, end_datetime: r.suggested_end,
        intensity: r.intensity, title: `${r.course_code}: study for ${r.deadline_title}`,
      });
      toast('Session added. 🗓️'); Views.schedule(el);
    } catch (err) { toast(err.message, 'error'); }
  });
};
