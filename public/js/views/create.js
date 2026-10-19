/**
 * "+" create sheet — one place to add a Deadline, Exam, Course, Free time or Roadmap.
 * Full-screen on phones, a centered card on larger screens. Opened with openCreate(tab).
 */
const CREATE_TABS = [
  { id: 'deadline', label: 'Deadline', title: 'New Deadline' },
  { id: 'exam', label: 'Exam', title: 'New Exam' },
  { id: 'course', label: 'Course', title: 'New Course' },
  { id: 'free', label: 'Free time', title: 'New Free Time' },
  { id: 'roadmap', label: 'Roadmap', title: 'New Roadmap' },
];
const FREE_ROADMAPS = 1;

const Create = { tab: 'deadline', courses: [], roadmapCount: 0, returnTab: null, ai: null };

const ROADMAP_SOURCE_BADGE = { ai: '✨ AI-built', template: '📋 Template', custom: '🗺️ Custom' };

/** Can this student get an AI-built roadmap right now? (status from GET /api/roadmaps/ai) */
function aiRoadmapReady(ai) { return !!(ai && ai.configured && ai.remaining > 0); }

/** One-line status under the Generate buttons, e.g. "✨ Built by AI · 2 of 3 left this month". */
function aiRoadmapNote(ai) {
  if (!ai || !ai.configured) return '';
  if (ai.remaining > 0) return `✨ Built by AI · ${ai.remaining} of ${ai.limit} left this month`;
  return `You've used your ${ai.limit} AI builds this month — we'll use an expert template${App.isPlus() ? '' : ' (Plus gets 30 a month 👑)'}`;
}

/** Message after a roadmap is generated: says whether Claude built it, and if not, why. */
function roadmapSourceMessage(structure, ai, saved) {
  const done = saved ? 'created' : 'ready — edit it before saving';
  if (structure.source === 'ai') return `✨ AI roadmap ${done}.`;
  const why = ai && ai.reason === 'quota' ? 'AI limit reached this month. '
    : ai && ai.reason === 'error' ? 'AI is unavailable right now. ' : '';
  return `${why}${structure.source === 'template' ? 'Expert-template roadmap' : 'Custom roadmap'} ${done}. 🗺️`;
}

async function openCreate(tab = 'deadline') {
  Create.tab = tab;
  Create.returnTab = null;
  document.getElementById('createRoot').innerHTML = `
    <div class="fixed inset-0 z-[70] flex sm:items-center justify-center sm:p-4">
      <div class="absolute inset-0 bg-slate-900/50 backdrop-blur-sm hidden sm:block" onclick="closeCreate()"></div>
      <div id="createCard" role="dialog" aria-modal="true" aria-label="Create"
           class="relative bg-white w-full sm:max-w-lg sm:rounded-3xl shadow-2xl h-full sm:h-auto sm:max-h-[92vh] overflow-y-auto sheet-enter">
        <div class="text-center py-20 text-sm text-slate-400">Loading…</div>
      </div>
    </div>`;
  document.body.style.overflow = 'hidden';
  try {
    const [{ courses }, { roadmaps }, ai] = await Promise.all([
      API.get('/api/courses'), API.get('/api/roadmaps'), API.get('/api/roadmaps/ai').catch(() => null),
    ]);
    Create.courses = courses;
    Create.roadmapCount = roadmaps.length;
    Create.ai = ai;
  } catch (err) {
    closeCreate();
    if (err.message !== 'Not authenticated') toast(err.message, 'error');
    return;
  }
  renderCreate();
}

function closeCreate() {
  const root = document.getElementById('createRoot');
  if (root && root.innerHTML) { root.innerHTML = ''; document.body.style.overflow = ''; }
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCreate(); });

function roadmapLocked() { return !App.isPlus() && Create.roadmapCount >= FREE_ROADMAPS; }

function renderCreate() {
  const card = document.getElementById('createCard');
  if (!card) return;
  const t = CREATE_TABS.find(x => x.id === Create.tab);
  card.innerHTML = `
    <div class="sticky top-0 bg-white/95 backdrop-blur z-10 px-5 pt-4 pb-3">
      <div class="flex items-center justify-between">
        <button type="button" onclick="closeCreate()" class="w-10 h-10 -ml-2 grid place-items-center rounded-full text-slate-500 hover:bg-slate-100" aria-label="Close">
          <span class="w-5 h-5 block">${icon('close')}</span>
        </button>
        <h2 class="font-bold text-lg text-slate-900">${t.title}</h2>
        <span class="w-10"></span>
      </div>
      <div class="seg mt-3">
        ${CREATE_TABS.map(x => `
          <button type="button" data-ctab="${x.id}" class="${x.id === Create.tab ? 'on' : ''}">
            ${x.label}${x.id === 'roadmap' && roadmapLocked() ? ' 👑' : ''}
          </button>`).join('')}
      </div>
    </div>
    <form id="createForm" class="px-5 pb-8 pt-2 space-y-5" novalidate>${CREATE_FORMS[Create.tab]()}</form>`;

  card.querySelectorAll('[data-ctab]').forEach(b => b.onclick = () => { Create.tab = b.dataset.ctab; renderCreate(); });
  card.querySelectorAll('[data-ctab-go]').forEach(b => b.onclick = () => {
    Create.returnTab = Create.tab; Create.tab = b.dataset.ctabGo; renderCreate();
  });
  const onTab = card.querySelector('[data-ctab].on');
  if (onTab) onTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  wireChips(card);
  wireSteppers(card);
  const bind = CREATE_BIND[Create.tab];
  if (bind) bind(card);
}

/* ---------- small form helpers ---------- */

const lbl = (text, html) => `<div><label class="f-label">${text}</label>${html}</div>`;

function chips(name, options, selected, { multi = false, outline = false } = {}) {
  return `<div class="flex flex-wrap gap-2" data-chips="${name}" ${multi ? 'data-multi="1"' : ''}>
    ${options.map(o => {
      const [v, l] = Array.isArray(o) ? o.map(String) : [o, o];
      const on = multi ? selected.map(String).includes(v) : v === String(selected);
      return `<button type="button" class="chip ${outline ? 'chip-outline' : ''} ${on ? 'on' : ''}" data-val="${esc(v)}">${esc(l)}</button>`;
    }).join('')}
  </div>`;
}
function wireChips(root) {
  root.querySelectorAll('[data-chips]').forEach(g => g.querySelectorAll('.chip').forEach(c => c.onclick = () => {
    if (g.dataset.multi) c.classList.toggle('on');
    else { g.querySelectorAll('.chip').forEach(x => x.classList.remove('on')); c.classList.add('on'); }
    g.dispatchEvent(new CustomEvent('chipchange'));
  }));
}
const chipVal = (name) => (document.querySelector(`[data-chips="${name}"] .chip.on`) || {}).dataset?.val || '';
const chipVals = (name) => [...document.querySelectorAll(`[data-chips="${name}"] .chip.on`)].map(c => c.dataset.val);

function stepper(id, value, unit) {
  return `<div class="stepper" data-stepper="${id}">
    <button type="button" class="minus" aria-label="Less">−</button>
    <span class="font-semibold text-slate-800"><span id="${id}">${value}</span> ${unit}</span>
    <button type="button" class="plus" aria-label="More">+</button>
  </div>`;
}
function wireSteppers(root) {
  root.querySelectorAll('[data-stepper]').forEach(s => {
    const out = s.querySelector(`#${s.dataset.stepper}`);
    const set = (v) => { out.textContent = Math.max(0.5, Math.min(200, v)); s.dataset.edited = '1'; };
    s.querySelector('.minus').onclick = () => set(Number(out.textContent) - 0.5);
    s.querySelector('.plus').onclick = () => set(Number(out.textContent) + 0.5);
  });
}

function courseSelect() {
  if (!Create.courses.length) {
    return `<div class="box flex items-center justify-between gap-3 text-sm text-slate-500">
      No courses yet.
      <button type="button" class="btn btn-soft btn-sm" data-ctab-go="course">+ Add a course</button>
    </div>`;
  }
  return `<select id="c_course" class="inp inp-soft">
    <option value="">Select course</option>
    ${Create.courses.map(c => `<option value="${c.id}">${esc(c.code)} — ${esc(c.title)}</option>`).join('')}
  </select>`;
}

function reminderBlock() {
  return `<div class="box">
    <label class="flex items-center justify-between text-sm font-medium text-slate-700 cursor-pointer">
      <span>🔔 Remind me</span>
      <input type="checkbox" id="c_remind" class="w-5 h-5 rounded border-slate-300 text-indigo-600">
    </label>
    <div id="c_remind_when" class="hidden mt-3">${chips('remindWhen', [['1440', '1 day before'], ['60', '1 hour before']], '1440', { outline: true })}</div>
  </div>`;
}

function saveButtons(text) {
  return `<div class="pt-1 space-y-2.5">
    <button type="submit" id="c_save" class="btn btn-primary btn-block !py-4 !text-base !rounded-2xl">${text}</button>
    <button type="button" onclick="closeCreate()" class="btn btn-outline btn-block !rounded-2xl">Cancel</button>
  </div>`;
}

/** Run a save with the button disabled; close + refresh the current page on success. */
async function createSubmit(fn, { regenerate = false } = {}) {
  const btn = document.getElementById('c_save');
  if (btn) btn.disabled = true;
  try {
    const msg = await fn();
    if (msg === false) return; // handled (e.g. switched tabs)
    closeCreate();
    toast(msg);
    if (regenerate) await autoRegenerate();
    App.route();
  } catch (err) {
    if (!err.premium) toast(err.message, 'error');
  } finally {
    if (btn && document.body.contains(btn)) btn.disabled = false;
  }
}

/* ---------- forms ---------- */

const CREATE_FORMS = {
  deadline: () => `
    ${lbl('Title', '<input id="c_title" class="inp inp-soft" placeholder="e.g. Database assignment 2" maxlength="120">')}
    ${lbl('Course', courseSelect())}
    ${lbl('Type', chips('type', ['Assignment', 'CAT/Test', 'Project', 'Presentation', 'Other'], 'Assignment'))}
    ${lbl('Due', `<div class="grid grid-cols-2 gap-2">
      <input type="date" id="c_date" class="inp inp-soft"><input type="time" id="c_time" value="23:59" class="inp inp-soft"></div>`)}
    ${lbl('Priority', chips('priority', ['Low', 'Medium', 'High'], 'Medium'))}
    ${lbl('Study time needed', stepper('c_hours', DEFAULT_HOURS.Assignment, 'hours'))}
    ${reminderBlock()}
    ${saveButtons('Save deadline')}`,

  exam: () => `
    ${lbl('Exam name', '<input id="c_title" class="inp inp-soft" placeholder="e.g. Operating Systems final" maxlength="120">')}
    ${lbl('Course', courseSelect())}
    ${lbl('When', `<div class="grid grid-cols-2 gap-2">
      <input type="date" id="c_date" class="inp inp-soft"><input type="time" id="c_time" value="09:00" class="inp inp-soft"></div>`)}
    ${lbl('Priority', chips('priority', ['Low', 'Medium', 'High'], 'High'))}
    ${lbl('Revision time needed', stepper('c_hours', DEFAULT_HOURS.Exam, 'hours'))}
    <p class="text-xs text-slate-400 -mt-2">EduFlex spreads this revision across your free time before the exam.</p>
    ${reminderBlock()}
    ${saveButtons('Save exam')}`,

  course: () => `
    ${lbl('Course name', '<input id="c_ctitle" class="inp inp-soft" placeholder="e.g. Database Systems" maxlength="120">')}
    ${lbl('Course code', '<input id="c_code" class="inp inp-soft uppercase" placeholder="e.g. CSC 224" maxlength="20">')}
    ${lbl('Difficulty', chips('difficulty', ['Easy', 'Moderate', 'Hard'], 'Moderate'))}
    <p class="text-xs text-slate-400 -mt-2">Harder courses get longer study sessions.</p>
    ${lbl('Notes (optional)', '<textarea id="c_desc" rows="3" class="inp inp-soft" placeholder="Lecturer, venue, anything useful…"></textarea>')}
    ${saveButtons('Save course')}`,

  free: () => `
    ${lbl('Quick presets', `<div class="grid gap-2">
      ${AVAIL_PRESETS.map(p => `
        <button type="button" data-preset="${p.id}" class="box !p-3 flex items-center gap-3 text-left hover:border-indigo-300 active:scale-[.99] transition">
          <span class="text-2xl">${p.icon}</span>
          <span><span class="block text-sm font-semibold text-slate-800">${esc(p.name)}</span>
          <span class="block text-xs text-slate-400">${esc(p.desc)}</span></span>
        </button>`).join('')}</div>`)}
    <div class="flex items-center gap-3 text-[11px] font-semibold text-slate-300 uppercase tracking-wider"><span class="flex-1 h-px bg-slate-100"></span>or custom<span class="flex-1 h-px bg-slate-100"></span></div>
    ${lbl('Days', chips('days', [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']], [], { multi: true }))}
    ${lbl('Time', `<div class="grid grid-cols-2 gap-2">
      <input type="time" id="c_from" value="19:00" class="inp inp-soft" aria-label="From"><input type="time" id="c_to" value="21:00" class="inp inp-soft" aria-label="To"></div>`)}
    ${lbl('Intensity', chips('intensity', ['Light', 'Normal', 'Deep Focus'], 'Normal'))}
    ${saveButtons('Save free time')}`,

  roadmap: () => roadmapLocked() ? `
    <div class="text-center pt-6">
      <div class="w-14 h-14 mx-auto rounded-2xl grid place-items-center text-white bg-gradient-to-br from-amber-400 to-orange-500 shadow-lg shadow-amber-500/30">${icon('crown')}</div>
      <h3 class="font-bold text-slate-900 text-lg mt-4">Your free roadmap is in use</h3>
      <p class="text-sm text-slate-500 mt-1.5">The free plan includes ${FREE_ROADMAPS} learning roadmap. EduFlex Plus unlocks unlimited roadmaps for every unit you take.</p>
      <a href="#/premium" onclick="closeCreate()" class="btn btn-primary btn-block !py-4 !rounded-2xl mt-6">👑 Go Premium</a>
      <a href="#/roadmaps" onclick="closeCreate()" class="btn btn-outline btn-block !rounded-2xl mt-2.5">View my roadmap</a>
    </div>` : `
    ${lbl('What do you want to learn?', `<input id="c_rm_name" class="inp inp-soft" placeholder="e.g. Database Systems" list="c_rm_list" maxlength="100">
      <datalist id="c_rm_list">${Create.courses.map(c => `<option value="${esc(c.title)}">`).join('')}</datalist>`)}
    ${lbl('Course code (optional)', '<input id="c_rm_code" class="inp inp-soft uppercase" placeholder="e.g. CSC 224" maxlength="20">')}
    ${lbl('Your level', chips('level', ['Beginner', 'Intermediate', 'Advanced'], 'Beginner'))}
    ${lbl('Learning style', chips('style', ['Mixed', 'Theory-based', 'Practical', 'Project-based', 'Exam-focused'], 'Mixed'))}
    ${lbl('Duration', chips('rmdays', [['7', '1 week'], ['14', '2 weeks'], ['30', '1 month'], ['60', '2 months']], '14'))}
    ${lbl('Finish by (optional)', '<input type="date" id="c_rm_date" class="inp inp-soft">')}
    ${!App.isPlus() ? `<p class="text-xs text-slate-400 -mt-2"><span class="free-badge">FREE</span> Your plan includes ${FREE_ROADMAPS} roadmap · unlimited with Plus 👑</p>` : ''}
    ${saveButtons(aiRoadmapReady(Create.ai) ? '✨ Build with AI' : '✨ Generate roadmap')}
    ${aiRoadmapNote(Create.ai) ? `<p class="text-[11px] text-slate-400 text-center -mt-2">${esc(aiRoadmapNote(Create.ai))}</p>` : ''}
    <a href="#/roadmaps/new" onclick="closeCreate()" class="block text-center text-xs font-semibold text-indigo-600">Prefer to review and edit before saving? Open the full builder →</a>`,
};

/* ---------- behaviour per form ---------- */

function bindReminder() {
  const cb = document.getElementById('c_remind');
  if (cb) cb.onchange = () => document.getElementById('c_remind_when').classList.toggle('hidden', !cb.checked);
}

/** Shared save for Deadline + Exam (both are deadlines on the server). */
function bindDeadlineLike(type) {
  bindReminder();
  document.getElementById('createForm').onsubmit = (e) => {
    e.preventDefault();
    const title = document.getElementById('c_title').value.trim();
    const course = document.getElementById('c_course');
    const date = document.getElementById('c_date').value;
    const time = document.getElementById('c_time').value || '23:59';
    if (!title) return toast(`Give the ${type === 'Exam' ? 'exam' : 'deadline'} a name.`, 'error');
    if (!course || !course.value) return toast('Choose a course (or add one first).', 'error');
    if (!date) return toast('Pick a date.', 'error');
    const due = `${date}T${time}`;
    if (new Date(due) < new Date()) return toast('That date is in the past.', 'error');
    createSubmit(async () => {
      await API.post('/api/deadlines', {
        course_id: Number(course.value), title, due_date: due,
        type: type || chipVal('type'),
        priority: chipVal('priority'),
        estimated_hours: Number(document.getElementById('c_hours').textContent),
        reminder_enabled: document.getElementById('c_remind').checked,
        reminder_minutes_before: Number(chipVal('remindWhen')) || 1440,
      });
      return type === 'Exam' ? 'Exam added — revision will be scheduled. 📚' : 'Deadline added. ⏰';
    }, { regenerate: true });
  };
}

const CREATE_BIND = {
  deadline: () => {
    // Smart default hours follow the type until the student adjusts them
    const typeGroup = document.querySelector('[data-chips="type"]');
    const step = document.querySelector('[data-stepper="c_hours"]');
    typeGroup.addEventListener('chipchange', () => {
      if (!step.dataset.edited) document.getElementById('c_hours').textContent = DEFAULT_HOURS[chipVal('type')] || 2;
    });
    bindDeadlineLike(null);
  },

  exam: () => bindDeadlineLike('Exam'),

  course: () => {
    document.getElementById('createForm').onsubmit = (e) => {
      e.preventDefault();
      const title = document.getElementById('c_ctitle').value.trim();
      const code = document.getElementById('c_code').value.trim();
      if (!title || !code) return toast('Course name and code are required.', 'error');
      createSubmit(async () => {
        const { course } = await API.post('/api/courses', {
          title, code, difficulty: chipVal('difficulty'), description: document.getElementById('c_desc').value.trim(),
        });
        if (Create.returnTab) {
          // Came here from Deadline/Exam → go back with the new course selected
          Create.courses.unshift(course);
          Create.tab = Create.returnTab; Create.returnTab = null;
          renderCreate();
          document.getElementById('c_course').value = course.id;
          toast('Course added — now finish your entry. 📘');
          return false;
        }
        return 'Course added. 📘';
      });
    };
  },

  free: () => {
    document.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => createSubmit(async () => {
      const preset = AVAIL_PRESETS.find(p => p.id === b.dataset.preset);
      await applyAvailPreset(preset);
      return `${preset.name} added. 🕒`;
    }, { regenerate: true }));
    document.getElementById('createForm').onsubmit = (e) => {
      e.preventDefault();
      const days = chipVals('days').map(Number);
      const start = document.getElementById('c_from').value, end = document.getElementById('c_to').value;
      if (days.length === 0) return toast('Pick at least one day.', 'error');
      if (!start || !end || end <= start) return toast('End time must be after start time.', 'error');
      createSubmit(async () => {
        for (const d of days) {
          await API.post('/api/availability', { day_of_week: d, start_time: start, end_time: end, study_intensity: chipVal('intensity') });
        }
        return `Free time added for ${days.length} day${days.length === 1 ? '' : 's'}. 🕒`;
      }, { regenerate: true });
    };
  },

  roadmap: () => {
    const form = document.getElementById('createForm');
    if (roadmapLocked()) { form.onsubmit = (e) => e.preventDefault(); return; }
    form.onsubmit = (e) => {
      e.preventDefault();
      const name = document.getElementById('c_rm_name').value.trim();
      if (!name) return toast('Tell EduFlex what you want to learn.', 'error');
      const body = {
        course_name: name,
        course_code: document.getElementById('c_rm_code').value.trim(),
        current_level: chipVal('level'),
        preferred_learning_style: chipVal('style'),
        duration_days: Number(chipVal('rmdays')) || 14,
        deadline_date: document.getElementById('c_rm_date').value || null,
        difficulty: 'Moderate',
      };
      const linked = Create.courses.find(c => c.title.toLowerCase() === name.toLowerCase());
      if (linked) { body.course_id = linked.id; body.difficulty = linked.difficulty; }
      const btn = document.getElementById('c_save');
      if (btn) btn.textContent = aiRoadmapReady(Create.ai) ? '✨ Building with AI… (up to a minute)' : 'Generating…';
      createSubmit(async () => {
        const { structure, ai } = await API.post('/api/roadmaps/preview', body);
        const { id } = await API.post('/api/roadmaps', { ...body, structure });
        location.hash = `#/roadmaps/${id}`;
        return roadmapSourceMessage(structure, ai, true);
      }).finally(() => { if (btn && document.body.contains(btn)) btn.textContent = aiRoadmapReady(Create.ai) ? '✨ Build with AI' : '✨ Generate roadmap'; });
    };
  },
};
