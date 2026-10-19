/** Calendar: month / week / day views with status colors, reminders and session actions. */
Views.calendar = async (el) => {
  const state = (Views.calendar._state ||= { mode: window.innerWidth < 640 ? 'day' : 'month', anchor: new Date() });

  const CHIP = { Planned: 'bg-indigo-500', Completed: 'bg-emerald-500', Missed: 'bg-rose-500', Rescheduled: 'bg-violet-500' };
  const pad = (n) => String(n).padStart(2, '0');
  const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  function rangeFor() {
    const a = state.anchor;
    if (state.mode === 'month') {
      const first = new Date(a.getFullYear(), a.getMonth(), 1);
      const gridStart = new Date(first); gridStart.setDate(1 - ((first.getDay() + 6) % 7));
      const gridEnd = new Date(gridStart); gridEnd.setDate(gridStart.getDate() + 41);
      return { from: gridStart, to: gridEnd };
    }
    if (state.mode === 'week') {
      const start = new Date(a); start.setDate(a.getDate() - ((a.getDay() + 6) % 7));
      const end = new Date(start); end.setDate(start.getDate() + 6);
      return { from: start, to: end };
    }
    // Day view loads its whole week so the week strip can show which days have plans
    const start = new Date(a); start.setDate(a.getDate() - ((a.getDay() + 6) % 7));
    const end = new Date(start); end.setDate(start.getDate() + 6);
    return { from: start, to: end };
  }

  const { from, to } = rangeFor();
  const [{ sessions }, { deadlines }] = await Promise.all([
    API.get(`/api/sessions?from=${key(from)}&to=${key(to)}`),
    API.get('/api/deadlines'),
  ]);
  const byDay = {};
  for (const s of sessions) (byDay[s.start_datetime.slice(0, 10)] ||= []).push(s);
  const dlByDay = {};
  for (const dl of deadlines) if (dl.status === 'Pending') (dlByDay[dl.due_date.slice(0, 10)] ||= []).push(dl);

  const header = state.mode === 'month'
    ? state.anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : state.mode === 'week' ? `${fmtDate(key(from))} – ${fmtDate(key(to))}`
    : state.anchor.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  el.innerHTML = `
    <div class="card p-3 sm:p-5">
      <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div class="flex items-center gap-1">
          <button id="prevBtn" class="btn btn-ghost btn-sm !px-3">‹</button>
          <button id="todayBtn" class="btn btn-ghost btn-sm">Today</button>
          <button id="nextBtn" class="btn btn-ghost btn-sm !px-3">›</button>
        </div>
        <h2 class="font-bold text-slate-900 text-sm sm:text-base order-3 sm:order-none w-full sm:w-auto">${header}</h2>
        <div class="flex rounded-xl border border-slate-200 overflow-hidden text-xs font-semibold">
          ${['day', 'week', 'month'].map(m => `
            <button data-mode="${m}" class="px-3 py-2 capitalize transition ${state.mode === m ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600'}">${m}</button>`).join('')}
        </div>
      </div>

      <div class="flex flex-wrap gap-3 text-[11px] text-slate-500 mb-4">
        ${Object.entries(CHIP).map(([s, c]) => `<span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full ${c}"></span>${s}</span>`).join('')}
        <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-amber-500"></span>Deadline</span>
      </div>

      <div id="calBody">${renderBody()}</div>
    </div>`;

  function chip(s, full = false) {
    return `<button data-session="${s.id}"
      class="w-full text-left ${CHIP[s.status]} text-white rounded-lg px-1.5 py-1 text-[10px] sm:text-[11px] leading-tight truncate active:opacity-80"
      title="${esc(s.title)} (${s.status})">
      ${s.reminder_enabled ? '🔔' : ''}${s.start_datetime.slice(11)} ${esc(full ? s.title : (s.course_code || ''))}
    </button>`;
  }

  function renderBody() {
    const todayKey = key(new Date());

    if (state.mode === 'month') {
      const cells = [];
      const cur = new Date(from);
      for (let i = 0; i < 42; i++) {
        const k = key(cur);
        const inMonth = cur.getMonth() === state.anchor.getMonth();
        const items = byDay[k] || [];
        cells.push(`
          <div class="min-h-[70px] sm:min-h-[92px] border border-slate-100 rounded-xl p-1 sm:p-1.5 ${inMonth ? 'bg-white' : 'bg-slate-50/60'} ${k === todayKey ? 'ring-2 ring-indigo-400' : ''}">
            <div class="text-[10px] sm:text-[11px] font-semibold ${inMonth ? 'text-slate-600' : 'text-slate-300'} mb-1">${cur.getDate()}</div>
            <div class="space-y-1">
              ${items.slice(0, 2).map(s => chip(s)).join('')}
              ${items.length > 2 ? `<div class="text-[9px] text-slate-400 pl-1">+${items.length - 2}</div>` : ''}
            </div>
          </div>`);
        cur.setDate(cur.getDate() + 1);
      }
      return `<div class="grid grid-cols-7 gap-1 text-center text-[10px] sm:text-[11px] font-bold text-slate-400 mb-1">
          ${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => `<div><span class="hidden sm:inline">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i]}</span><span class="sm:hidden">${d}</span></div>`).join('')}
        </div><div class="grid grid-cols-7 gap-1">${cells.join('')}</div>`;
    }

    if (state.mode === 'week') {
      const cols = [];
      const cur = new Date(from);
      for (let i = 0; i < 7; i++) {
        const k = key(cur);
        const items = byDay[k] || [];
        cols.push(`
          <div class="border border-slate-100 rounded-xl p-2 ${k === todayKey ? 'ring-2 ring-indigo-400' : 'bg-white'}">
            <div class="text-xs font-bold ${k === todayKey ? 'text-indigo-600' : 'text-slate-500'} mb-2">
              ${cur.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}
            </div>
            <div class="space-y-1.5">
              ${items.length === 0 ? '<div class="text-[10px] text-slate-300">—</div>' : items.map(s => chip(s, true)).join('')}
            </div>
          </div>`);
        cur.setDate(cur.getDate() + 1);
      }
      return `<div class="grid grid-cols-1 sm:grid-cols-4 lg:grid-cols-7 gap-2">${cols.join('')}</div>`;
    }

    // Day view: week strip + hourly timeline with sessions, deadlines and a "now" line
    const dayKey = key(state.anchor);
    const strip = [...Array(7)].map((_, i) => {
      const dd = new Date(from); dd.setDate(from.getDate() + i);
      const k = key(dd);
      const has = (byDay[k] || []).length || (dlByDay[k] || []).length;
      const sel = k === dayKey;
      return `
        <button data-day="${k}" class="flex flex-col items-center gap-0.5 py-2 rounded-2xl transition
          ${sel ? 'bg-indigo-500 text-white shadow-md shadow-indigo-500/30' : k === todayKey ? 'text-indigo-600' : 'text-slate-700 hover:bg-slate-50'}">
          <span class="text-[10px] font-semibold ${sel ? 'text-white/80' : 'text-slate-400'}">${'SMTWTFS'[dd.getDay()]}</span>
          <span class="text-base font-bold">${dd.getDate()}</span>
          <span class="w-1.5 h-1.5 rounded-full ${has ? (sel ? 'bg-white' : 'bg-indigo-400') : 'bg-transparent'}"></span>
        </button>`;
    }).join('');

    const items = byDay[dayKey] || [];
    const dls = dlByDay[dayKey] || [];
    const mins = (s) => { const [h, m] = s.slice(11, 16).split(':').map(Number); return h * 60 + m; };
    let startH = 7, endH = 22;
    for (const s of items) { startH = Math.min(startH, Math.floor(mins(s.start_datetime) / 60)); endH = Math.max(endH, Math.ceil(mins(s.end_datetime) / 60)); }
    for (const dl of dls) { startH = Math.min(startH, Math.floor(mins(dl.due_date) / 60)); endH = Math.max(endH, Math.ceil(mins(dl.due_date) / 60) + 1); }
    endH = Math.min(24, endH);
    const PX = 56;
    const y = (m) => (m - startH * 60) * PX / 60;
    const hourLabel = (h) => new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' });

    const rows = [];
    for (let h = startH; h < endH; h++) {
      rows.push(`<div class="relative border-t border-slate-100" style="height:${PX}px">
        <span class="absolute -top-2 left-0 w-12 text-[10px] text-slate-400 bg-white">${hourLabel(h)}</span></div>`);
    }
    const blocks = items.map(s => {
      const t = y(mins(s.start_datetime)), b = y(mins(s.end_datetime));
      return `<button data-session="${s.id}" class="absolute left-14 right-1 rounded-xl px-3 py-1.5 text-left text-white ${CHIP[s.status]} shadow-sm overflow-hidden active:opacity-90"
        style="top:${t}px;height:${Math.max(28, b - t - 2)}px">
        <div class="text-xs font-semibold truncate">${s.reminder_enabled ? '🔔 ' : ''}${esc(s.title)}</div>
        <div class="text-[10px] opacity-80">${s.start_datetime.slice(11)} – ${s.end_datetime.slice(11)}</div>
      </button>`;
    }).join('');
    const markers = dls.map(dl => `
      <a href="#/deadlines" class="absolute left-14 right-1 rounded-lg px-3 py-1 bg-amber-50 text-amber-800 text-[11px] font-semibold border-l-4 border-amber-500 truncate"
        style="top:${Math.max(0, y(mins(dl.due_date)) - 12)}px">⏰ ${esc(dl.type)} due: ${esc(dl.title)} · ${dl.due_date.slice(11)}</a>`).join('');
    const nowM = new Date().getHours() * 60 + new Date().getMinutes();
    const nowLine = dayKey === todayKey && nowM >= startH * 60 && nowM <= endH * 60 ? `
      <div class="absolute left-12 right-0 h-0.5 bg-indigo-500 pointer-events-none" style="top:${y(nowM)}px">
        <span class="absolute -left-1 -top-1 w-2.5 h-2.5 rounded-full bg-indigo-500"></span></div>` : '';
    const empty = items.length || dls.length ? '' : `
      <div class="absolute inset-x-0 top-24 text-center pointer-events-none">
        <div class="w-12 h-12 mx-auto rounded-2xl bg-indigo-50 text-indigo-500 grid place-items-center [&_svg]:w-6 [&_svg]:h-6">${icon('calendar')}</div>
        <div class="font-semibold text-slate-800 text-sm mt-3">Nothing scheduled</div>
        <div class="text-xs text-slate-400 mt-0.5">Enjoy the free day.</div>
      </div>`;

    return `<div class="grid grid-cols-7 gap-1 mb-4">${strip}</div>
      <div class="relative mt-3">${rows.join('')}${blocks}${markers}${nowLine}${empty}</div>`;
  }

  const step = { month: (d, n) => d.setMonth(d.getMonth() + n), week: (d, n) => d.setDate(d.getDate() + 7 * n), day: (d, n) => d.setDate(d.getDate() + n) };
  document.getElementById('prevBtn').onclick = () => { step[state.mode](state.anchor, -1); Views.calendar(el); };
  document.getElementById('nextBtn').onclick = () => { step[state.mode](state.anchor, +1); Views.calendar(el); };
  document.getElementById('todayBtn').onclick = () => { state.anchor = new Date(); Views.calendar(el); };
  el.querySelectorAll('[data-day]').forEach(b => b.onclick = () => {
    const [y, m, dd] = b.dataset.day.split('-').map(Number);
    state.anchor = new Date(y, m - 1, dd); Views.calendar(el);
  });
  el.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { state.mode = b.dataset.mode; Views.calendar(el); });
  el.querySelectorAll('[data-session]').forEach(b =>
    b.onclick = () => showSession(sessions.find(s => s.id === Number(b.dataset.session))));

  function showSession(s) {
    if (!s) return;
    openModal('Study Session', `
      <div class="space-y-2 text-sm">
        <div class="font-bold text-slate-900 text-base">${esc(s.title)}</div>
        <div class="flex flex-wrap items-center gap-2">${badge(s.status, STATUS_BADGE[s.status])} ${badge(s.study_intensity, 'bg-slate-100 text-slate-600')}</div>
        <p class="text-slate-500">📘 ${esc(s.course_code)} — ${esc(s.course_title)}</p>
        <p class="text-slate-500">🕒 ${fmtDT(s.start_datetime)} → ${s.end_datetime.slice(11)}</p>
        ${s.deadline_title ? `<p class="text-slate-500">🎯 ${esc(s.deadline_title)}</p>` : ''}
        ${s.roadmap_id ? `<p class="text-slate-500">🗺️ <a href="#/roadmaps/${s.roadmap_id}" onclick="closeModal()" class="text-indigo-600 font-medium">Open roadmap</a></p>` : ''}
        ${s.notes ? `<p class="text-slate-400 text-xs bg-slate-50 rounded-xl p-3">${esc(s.notes)}</p>` : ''}
      </div>

      ${s.status === 'Missed' && !s.recovery_status ? `
        <div class="mt-4 bg-violet-50 border border-violet-200 rounded-xl px-4 py-3 text-xs text-violet-900">
          ↻ Missed. <a href="#/schedule" class="font-semibold underline" onclick="closeModal()">See recovery slots →</a>
        </div>` : ''}

      <div class="mt-4 border border-slate-200 rounded-2xl px-4 py-3">
        <label class="flex items-center justify-between text-sm font-semibold text-slate-700 cursor-pointer">
          <span>🔔 Remind me</span>
          <input type="checkbox" id="msRemind" ${s.reminder_enabled ? 'checked' : ''} class="w-5 h-5 rounded border-slate-300 text-indigo-600">
        </label>
        <select id="msRemindWhen" class="inp mt-2.5 ${s.reminder_enabled ? '' : 'hidden'}">
          ${[[0, 'At start time'], [5, '5 min before'], [15, '15 min before'], [30, '30 min before'], [60, '1 hour before']]
            .map(([v, t]) => `<option value="${v}" ${s.reminder_minutes_before === v ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>

      <div class="grid grid-cols-2 gap-2 mt-4">
        <button id="msDone" class="btn btn-success">✓ Completed</button>
        <button id="msMiss" class="btn btn-danger">✗ Missed</button>
      </div>

      <details class="mt-3 border border-slate-200 rounded-2xl overflow-hidden">
        <summary class="text-sm font-semibold px-4 py-3 cursor-pointer text-slate-700">↻ Reschedule</summary>
        <div class="px-4 pb-4 space-y-3">
          ${field('New start', `<input type="datetime-local" class="inp" id="rsStart" value="${s.start_datetime}">`)}
          ${field('New end', `<input type="datetime-local" class="inp" id="rsEnd" value="${s.end_datetime}">`)}
          <button id="msResched" class="btn btn-block bg-violet-600 text-white">Save new time</button>
        </div>
      </details>

      <button id="msDelete" class="btn btn-block mt-3 border border-rose-200 text-rose-600 bg-white">Delete session</button>`);

    const act = async (fn, msg) => {
      try { await fn(); closeModal(); toast(msg); Views.calendar(el); }
      catch (err) { toast(err.message, 'error'); }
    };
    const remToggle = document.getElementById('msRemind');
    const remWhen = document.getElementById('msRemindWhen');
    remToggle.onchange = async () => {
      remWhen.classList.toggle('hidden', !remToggle.checked);
      try {
        await API.patch(`/api/sessions/${s.id}`, { status: s.status, reminder_enabled: remToggle.checked, reminder_minutes_before: Number(remWhen.value) });
        toast(remToggle.checked ? 'Reminder set. 🔔' : 'Reminder removed.', 'info');
      } catch (err) { toast(err.message, 'error'); }
    };
    remWhen.onchange = async () => {
      try {
        await API.patch(`/api/sessions/${s.id}`, { status: s.status, reminder_enabled: true, reminder_minutes_before: Number(remWhen.value) });
        toast('Reminder updated. 🔔', 'info');
      } catch (err) { toast(err.message, 'error'); }
    };
    document.getElementById('msDone').onclick = () => act(() => API.patch(`/api/sessions/${s.id}`, { status: 'Completed' }), 'Session completed. 🎉');
    document.getElementById('msMiss').onclick = () => act(() => API.patch(`/api/sessions/${s.id}`, { status: 'Missed' }), 'Marked missed.');
    document.getElementById('msResched').onclick = () => {
      const start = document.getElementById('rsStart').value, end = document.getElementById('rsEnd').value;
      if (!start || !end || end <= start) return toast('End must be after start.', 'error');
      act(() => API.patch(`/api/sessions/${s.id}`, { start_datetime: start, end_datetime: end, status: 'Rescheduled' }), 'Session rescheduled.');
    };
    document.getElementById('msDelete').onclick = async () => {
      closeModal();
      if (!await confirmModal('Delete this study session?')) return;
      act(() => API.del(`/api/sessions/${s.id}`), 'Session deleted.');
    };
  }
};
