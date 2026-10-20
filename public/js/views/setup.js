/**
 * Guided Setup Wizard: Courses → Deadlines → Availability → generate schedule.
 * Gets a new student from empty account to a live plan in ~2 minutes.
 */
Views.setup = async (el) => {
  const S = (Views.setup._state ||= { step: 1 });
  const [{ courses }, { deadlines }, { slots }] = await Promise.all([
    API.get('/api/courses'), API.get('/api/deadlines'), API.get('/api/availability'),
  ]);

  const dot = (n, label) => `
    <div class="flex items-center gap-2 ${S.step === n ? '' : 'opacity-50'}">
      <span class="w-9 h-9 rounded-full grid place-items-center text-sm font-bold shrink-0
        ${S.step > n ? 'bg-emerald-500 text-white' : S.step === n ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30' : 'bg-slate-200 text-slate-500'}">
        ${S.step > n ? '✓' : n}</span>
      <span class="text-xs font-semibold text-slate-600 hidden sm:block">${label}</span>
    </div>`;

  el.innerHTML = `
    <div class="max-w-2xl mx-auto">
      <div class="text-center mb-6">
        <h2 class="text-xl sm:text-2xl font-bold text-slate-900">Let's set up your semester</h2>
        <p class="text-sm text-slate-500 mt-1.5">Three quick steps and EduFlex builds your first study schedule.</p>
      </div>
      <div class="flex items-center justify-center gap-3 sm:gap-6 mb-6">
        ${dot(1, 'Courses')}<div class="w-6 sm:w-10 h-px bg-slate-200"></div>
        ${dot(2, 'Deadlines')}<div class="w-6 sm:w-10 h-px bg-slate-200"></div>
        ${dot(3, 'Free time')}
      </div>
      <div class="card p-5 sm:p-6" id="stepBody"></div>
      <p class="text-center mt-4"><a href="#/dashboard" class="text-xs text-slate-400 hover:text-slate-600">Skip setup for now →</a></p>
    </div>`;

  const body = document.getElementById('stepBody');

  /* ---- Step 1: courses ---- */
  if (S.step === 1) {
    body.innerHTML = `
      <h3 class="font-bold text-slate-900 mb-1">Step 1 — Add your courses</h3>
      <p class="text-xs text-slate-500 mb-4">Type a course and tap <strong>Add</strong> — repeat for each unit.</p>
      <div class="space-y-2">
        <input id="w_title" class="inp" placeholder="Course title">
        <div class="grid grid-cols-2 gap-2">
          <input id="w_code" class="inp" placeholder="Course code">
          <select id="w_diff" class="inp"><option>Easy</option><option selected>Moderate</option><option>Hard</option></select>
        </div>
        <button id="w_add" class="btn btn-primary btn-block">+ Add course</button>
      </div>
      <div class="mt-4 space-y-2">
        ${courses.map(c => `
          <div class="flex items-center justify-between gap-2 bg-slate-50 rounded-xl px-4 py-2.5 text-sm">
            <span class="min-w-0 truncate"><strong>${esc(c.code)}</strong> — ${esc(c.title)}</span>
            <button data-del="${c.id}" class="text-rose-400 hover:text-rose-600 text-xs shrink-0">Remove</button>
          </div>`).join('')}
      </div>
      <button id="w_next" ${courses.length === 0 ? 'disabled' : ''} class="btn btn-primary btn-block mt-5">Continue → Deadlines</button>`;

    const add = async () => {
      const title = document.getElementById('w_title').value.trim();
      const code = document.getElementById('w_code').value.trim();
      if (!title) return toast('Enter a course title.', 'error');
      if (!code) return toast('Enter a course code.', 'error');
      try {
        await API.post('/api/courses', { title, code, difficulty: document.getElementById('w_diff').value, description: '' });
        Views.setup(el);
      } catch (err) { toast(err.message, 'error'); }
    };
    document.getElementById('w_add').onclick = add;
    ['w_title', 'w_code'].forEach(id => document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); add(); }
    }));
    body.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      await API.del(`/api/courses/${b.dataset.del}`); Views.setup(el);
    });
    document.getElementById('w_next').onclick = () => { S.step = 2; Views.setup(el); };
    document.getElementById('w_title').focus();
    return;
  }

  /* ---- Step 2: deadlines ---- */
  if (S.step === 2) {
    const TYPES = ['Assignment', 'CAT/Test', 'Exam', 'Project', 'Presentation', 'Other'];
    body.innerHTML = `
      <h3 class="font-bold text-slate-900 mb-1">Step 2 — What's due soon?</h3>
      <p class="text-xs text-slate-500 mb-4">Estimated hours are pre-filled per type — adjust if needed.</p>
      <div class="space-y-2">
        <select id="w_course" class="inp">
          ${courses.map(c => `<option value="${c.id}">${esc(c.code)} — ${esc(c.title)}</option>`).join('')}
        </select>
        <input id="w_dtitle" class="inp" placeholder="Deadline title">
        <div class="grid grid-cols-2 gap-2">
          <select id="w_type" class="inp">${TYPES.map(t => `<option>${t}</option>`).join('')}</select>
          <select id="w_prio" class="inp"><option>Low</option><option selected>Medium</option><option>High</option></select>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <input id="w_due" type="datetime-local" class="inp">
          <input id="w_hours" type="number" min="0.5" step="0.5" class="inp" value="${DEFAULT_HOURS['Assignment']}" title="Estimated hours">
        </div>
        <button id="w_add" class="btn btn-primary btn-block">+ Add deadline</button>
      </div>
      <div class="mt-4 space-y-2">
        ${deadlines.filter(d => d.status === 'Pending').map(d => `
          <div class="flex items-center justify-between gap-2 bg-slate-50 rounded-xl px-4 py-2.5 text-sm">
            <span class="min-w-0 truncate"><strong>${esc(d.course_code)}</strong> — ${esc(d.title)} · ${fmtDate(d.due_date)} · ${d.estimated_hours}h</span>
            <button data-del="${d.id}" class="text-rose-400 hover:text-rose-600 text-xs shrink-0">Remove</button>
          </div>`).join('')}
      </div>
      <div class="flex gap-2 mt-5">
        <button id="w_back" class="btn btn-ghost flex-1">← Back</button>
        <button id="w_next" class="btn btn-primary flex-1">Continue →</button>
      </div>`;

    let touched = false;
    document.getElementById('w_hours').oninput = () => { touched = true; };
    document.getElementById('w_type').onchange = (e) => {
      if (!touched) document.getElementById('w_hours').value = DEFAULT_HOURS[e.target.value] || 2;
    };
    document.getElementById('w_add').onclick = async () => {
      const title = document.getElementById('w_dtitle').value.trim();
      const due = document.getElementById('w_due').value;
      if (!title) return toast('Enter a deadline title.', 'error');
      if (!due) return toast('Pick the due date.', 'error');
      try {
        await API.post('/api/deadlines', {
          course_id: Number(document.getElementById('w_course').value),
          title, type: document.getElementById('w_type').value,
          due_date: due, priority: document.getElementById('w_prio').value,
          estimated_hours: Number(document.getElementById('w_hours').value) || 2,
        });
        Views.setup(el);
      } catch (err) { toast(err.message, 'error'); }
    };
    body.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      await API.del(`/api/deadlines/${b.dataset.del}`); Views.setup(el);
    });
    document.getElementById('w_back').onclick = () => { S.step = 1; Views.setup(el); };
    document.getElementById('w_next').onclick = () => { S.step = 3; Views.setup(el); };
    return;
  }

  /* ---- Step 3: availability + finish ---- */
  const dayOrder = [1, 2, 3, 4, 5, 6, 0];
  body.innerHTML = `
    <h3 class="font-bold text-slate-900 mb-1">Step 3 — When are you free?</h3>
    <p class="text-xs text-slate-500 mb-4">Pick a preset (editable later) or add custom slots.</p>
    <div class="grid sm:grid-cols-3 gap-3">
      ${AVAIL_PRESETS.map((p, i) => `
        <button data-preset="${i}" class="border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/50 rounded-2xl p-4 text-left transition active:scale-[.98]">
          <span class="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 grid place-items-center shrink-0 [&_svg]:w-5 [&_svg]:h-5">${icon(p.icon)}</span>
          <div class="text-sm font-semibold text-slate-800 mt-1">${p.name}</div>
          <div class="text-xs text-slate-400 mt-0.5">${p.desc}</div>
        </button>`).join('')}
    </div>

    <details class="mt-4">
      <summary class="text-xs font-semibold text-slate-500 cursor-pointer py-2">+ Add a custom slot</summary>
      <div class="space-y-2 mt-2">
        <select id="w_day" class="inp">${dayOrder.map(dd => `<option value="${dd}">${DAYS[dd]}</option>`).join('')}</select>
        <div class="grid grid-cols-2 gap-2">
          <input id="w_start" type="time" class="inp" value="19:00">
          <input id="w_end" type="time" class="inp" value="21:00">
        </div>
        <select id="w_int" class="inp"><option>Light</option><option selected>Normal</option><option>Deep Focus</option></select>
        <button id="w_addslot" class="btn btn-ghost btn-block">+ Add slot</button>
      </div>
    </details>

    <div class="mt-4 space-y-1.5" id="slotList">
      ${slots.map(s => `
        <div class="flex items-center justify-between gap-2 bg-slate-50 rounded-xl px-4 py-2 text-sm">
          <span>${DAYS[s.day_of_week]} · ${s.start_time}–${s.end_time} · ${esc(s.study_intensity)}</span>
          <button data-del="${s.id}" class="text-rose-400 hover:text-rose-600 text-xs shrink-0">Remove</button>
        </div>`).join('')}
    </div>

    <div class="flex flex-col sm:flex-row gap-2 mt-6">
      <button id="w_back" class="btn btn-ghost sm:w-auto">← Back</button>
      <button id="w_finish" ${slots.length === 0 ? 'disabled' : ''} class="btn btn-success flex-1">Finish &amp; generate my schedule</button>
    </div>`;

  body.querySelectorAll('[data-preset]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    try { await applyAvailPreset(AVAIL_PRESETS[Number(b.dataset.preset)]); toast('Availability added.'); Views.setup(el); }
    catch (err) { toast(err.message, 'error'); b.disabled = false; }
  });
  document.getElementById('w_addslot').onclick = async () => {
    try {
      await API.post('/api/availability', {
        day_of_week: Number(document.getElementById('w_day').value),
        start_time: document.getElementById('w_start').value,
        end_time: document.getElementById('w_end').value,
        study_intensity: document.getElementById('w_int').value,
      });
      Views.setup(el);
    } catch (err) { toast(err.message, 'error'); }
  };
  body.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    await API.del(`/api/availability/${b.dataset.del}`); Views.setup(el);
  });
  document.getElementById('w_back').onclick = () => { S.step = 2; Views.setup(el); };
  document.getElementById('w_finish').onclick = async () => {
    const btn = document.getElementById('w_finish');
    btn.disabled = true; btn.textContent = 'Building your schedule…';
    try {
      const r = await API.post('/api/sessions/generate');
      Views.setup._state = { step: 1 };
      toast(r.created > 0 ? `Setup complete — ${r.created} session${r.created === 1 ? '' : 's'} planned!` : 'Setup complete!');
      location.hash = '#/dashboard';
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false; btn.textContent = 'Finish & generate my schedule';
    }
  };
};
