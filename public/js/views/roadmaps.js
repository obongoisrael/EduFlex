/**
 * Smart Learning Roadmap pages:
 *   #/roadmaps            list
 *   #/roadmaps/new        form → generate → editable preview → save
 *   #/roadmaps/:id        detail (stage timeline, topics, tasks, tools, resources)
 *   #/roadmaps/:id/edit   edit meta + structure
 */
Views.roadmaps = async (el, args = []) => {
  if (args[0] === 'new') return roadmapNew(el);
  if (args[0] && args[1] === 'edit') return roadmapEdit(el, Number(args[0]));
  if (args[0]) return roadmapDetail(el, Number(args[0]));
  return roadmapList(el);
};

const RM_BADGE = {
  'Not Started': 'bg-slate-100 text-slate-600', 'In Progress': 'bg-indigo-100 text-indigo-700',
  'Completed': 'bg-emerald-100 text-emerald-700', 'Paused': 'bg-amber-100 text-amber-700',
  'Skipped': 'bg-slate-100 text-slate-400',
};
const TASK_ICON = { Practice: '✏️', 'Mini-project': '🛠️', Checkpoint: '🎓', Reading: '📖' };

/* ================= LIST ================= */
async function roadmapList(el) {
  const { roadmaps } = await API.get('/api/roadmaps');
  localStorage.setItem('ef_roadmaps_cache', JSON.stringify(
    roadmaps.filter(r => r.status !== 'Completed').slice(0, 3)
      .map(r => ({ title: r.title, progress: r.progress_percentage, next_topic: r.next_topic }))));

  el.innerHTML = `
    <div class="flex items-center justify-between gap-3 mb-4">
      <p class="text-sm text-slate-500">Structured paths for any course or topic.${App.isPlus() ? '' : ` <span class="free-badge">${roadmaps.length}/1 FREE</span>`}</p>
      <a href="#/roadmaps/new" class="btn btn-primary btn-sm shrink-0">+ New Roadmap</a>
    </div>
    ${roadmaps.length === 0
      ? emptyState('🗺️', 'No roadmaps yet', 'Tell EduFlex what you want to learn and it builds a structured path for you.',
          `<a href="#/roadmaps/new" class="btn btn-primary inline-flex">Create your first roadmap</a>`)
      : `<div class="grid sm:grid-cols-2 gap-3 sm:gap-4">
          ${roadmaps.map(r => `
            <a href="#/roadmaps/${r.id}" class="card p-5 hover:border-indigo-300 active:scale-[.99] transition block">
              <div class="flex items-start justify-between gap-2">
                <h3 class="font-semibold text-slate-900 leading-snug">${esc(r.title)}</h3>
                ${badge(r.status, RM_BADGE[r.status])}
              </div>
              <div class="text-xs text-slate-400 mt-1 truncate">${esc(r.course_name)}${r.course_code ? ` (${esc(r.course_code)})` : ''} · ${esc(r.current_level)}</div>
              <div class="flex justify-between text-xs mt-3 mb-1.5">
                <span class="text-slate-500 truncate">📍 ${esc(r.current_stage)}</span>
                <span class="font-bold text-slate-700 shrink-0 ml-2">${r.progress_percentage}%</span>
              </div>
              ${progressBar(r.progress_percentage)}
              <div class="flex flex-wrap items-center gap-2 mt-3 text-[11px] text-slate-400">
                ${r.next_topic ? `<span class="truncate">➡️ ${esc(r.next_topic)}</span>` : '<span>🎉 All done</span>'}
              </div>
              <div class="flex flex-wrap gap-2 mt-2 text-[11px]">
                ${r.deadline_date ? `<span class="text-slate-400">⏰ ${fmtDate(r.deadline_date)}</span>` : `<span class="text-slate-400">📅 ${r.duration_days} days</span>`}
                ${r.behind_schedule ? badge('⚠ Behind', 'bg-amber-100 text-amber-700') : ''}
              </div>
            </a>`).join('')}
        </div>`}`;
}

/* ================= NEW ================= */
async function roadmapNew(el) {
  const [{ courses }, { deadlines }] = await Promise.all([API.get('/api/courses'), API.get('/api/deadlines')]);
  const pendingDl = deadlines.filter(d => d.status === 'Pending');
  const CATS = ['Any', 'Notes', 'Slides', 'PDF', 'Past Paper', 'Assignment Guide'];

  el.innerHTML = `
    <div class="max-w-3xl mx-auto">
      <a href="#/roadmaps" class="text-xs font-semibold text-slate-400 hover:text-slate-600">← Back to roadmaps</a>
      <div class="card p-5 sm:p-6 mt-3">
        <h2 class="font-bold text-slate-900 text-lg">Create a learning roadmap 🗺️</h2>
        <p class="text-xs text-slate-500 mt-1 mb-5 leading-relaxed">Expert templates for common subjects, custom paths for anything else.</p>
        <div class="grid sm:grid-cols-2 gap-4">
          ${field('Course / unit / topic *', `<input class="inp" id="rf_name" placeholder="e.g. Database Systems" list="courseList">
            <datalist id="courseList">${courses.map(c => `<option value="${esc(c.title)}">`).join('')}</datalist>`)}
          ${field('Course code', `<input class="inp" id="rf_code" placeholder="e.g. CSC 224">`)}
          ${field('Link existing course', `<select class="inp" id="rf_course"><option value="">— Auto-create —</option>
            ${courses.map(c => `<option value="${c.id}">${esc(c.code)} — ${esc(c.title)}</option>`).join('')}</select>`)}
          ${field('Connect to deadline', `<select class="inp" id="rf_deadline"><option value="">— None —</option>
            ${pendingDl.map(d => `<option value="${d.id}">${esc(d.title)} (${fmtDate(d.due_date)})</option>`).join('')}</select>`)}
          ${field('Current level', `<select class="inp" id="rf_level"><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select>`)}
          ${field('Learning style', `<select class="inp" id="rf_style"><option>Mixed</option><option>Theory-based</option><option>Practical</option><option>Project-based</option><option>Exam-focused</option></select>`)}
          ${field('Difficulty', `<select class="inp" id="rf_diff"><option>Easy</option><option selected>Moderate</option><option>Hard</option></select>`)}
          ${field('Duration (days)', `<input type="number" min="3" max="180" class="inp" id="rf_days" value="14">`)}
          ${field('Deadline date', `<input type="date" class="inp" id="rf_date">`)}
          ${field('Preferred resource type', `<select class="inp" id="rf_restype">${CATS.map(c => `<option>${c}</option>`).join('')}</select>`)}
        </div>
        <div class="mt-4">${field('Target goal', `<textarea class="inp" id="rf_goal" rows="2" placeholder="e.g. Score an A in the end-of-semester exam"></textarea>`)}</div>
        <button id="rf_generate" class="btn btn-primary btn-block mt-5">✨ Generate my roadmap</button>
        <p id="rf_ai" class="text-[11px] text-slate-400 text-center mt-2"></p>
      </div>
      <div id="previewArea" class="mt-5"></div>
    </div>`;

  let structure = null;
  // AI status line (Claude builds the roadmap when configured and within the monthly quota)
  let aiStatus = null;
  API.get('/api/roadmaps/ai').then(ai => {
    aiStatus = ai;
    const note = document.getElementById('rf_ai');
    if (note) note.textContent = aiRoadmapNote(ai);
  }).catch(() => {});
  const readForm = () => ({
    course_name: document.getElementById('rf_name').value.trim(),
    course_code: document.getElementById('rf_code').value.trim(),
    course_id: document.getElementById('rf_course').value || null,
    deadline_id: document.getElementById('rf_deadline').value || null,
    current_level: document.getElementById('rf_level').value,
    preferred_learning_style: document.getElementById('rf_style').value,
    difficulty: document.getElementById('rf_diff').value,
    duration_days: Number(document.getElementById('rf_days').value) || 14,
    deadline_date: document.getElementById('rf_date').value || null,
    preferred_resource_type: document.getElementById('rf_restype').value,
    goal: document.getElementById('rf_goal').value.trim(),
  });

  document.getElementById('rf_generate').onclick = async () => {
    const form = readForm();
    if (!form.course_name) return toast('Enter the course, unit or topic name.', 'error');
    const btn = document.getElementById('rf_generate');
    btn.disabled = true; btn.textContent = aiRoadmapReady(aiStatus) ? '✨ Building with AI… (up to a minute)' : 'Generating…';
    try {
      const r = await API.post('/api/roadmaps/preview', form);
      structure = r.structure;
      renderPreview();
      toast(roadmapSourceMessage(structure, r.ai, false), 'info');
      if (r.ai) { aiStatus = { configured: aiStatus ? aiStatus.configured : true, ...r.ai }; document.getElementById('rf_ai').textContent = aiRoadmapNote(aiStatus); }
      document.getElementById('previewArea').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) { toast(err.message, 'error'); }
    btn.disabled = false; btn.textContent = '✨ Generate my roadmap';
  };

  function renderPreview() {
    const area = document.getElementById('previewArea');
    const totalH = structure.stages.reduce((s, st) => s + st.topics.reduce((a, t) => a + t.hours, 0), 0);
    area.innerHTML = `
      <div class="card p-5 sm:p-6 border-indigo-200">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-1">
          <h3 class="font-bold text-slate-900">Preview — edit before saving</h3>
          <span class="text-[11px] text-slate-400">${badge(ROADMAP_SOURCE_BADGE[structure.source] || '🗺️ Custom', 'bg-indigo-50 text-indigo-700')} ~${Math.round(totalH)}h</span>
        </div>
        <p class="text-xs text-slate-400 mb-4">Rename anything, adjust hours, remove topics you know, or add your own.</p>
        ${structure.stages.map((st, si) => `
          <div class="border border-slate-200 rounded-2xl p-4 mb-3">
            <div class="flex items-center gap-2">
              <span class="w-7 h-7 rounded-full bg-indigo-600 text-white grid place-items-center text-xs font-bold shrink-0">${si + 1}</span>
              <input data-stage="${si}" class="flex-1 min-w-0 font-semibold text-slate-800 text-sm bg-transparent border-b border-transparent hover:border-slate-200 focus:border-indigo-400 focus:outline-none py-1" value="${esc(st.title)}">
              <button data-rmstage="${si}" class="text-rose-400 hover:text-rose-600 text-xs shrink-0">Remove</button>
            </div>
            <div class="mt-2 space-y-1.5 sm:pl-9">
              ${st.topics.map((t, ti) => `
                <div class="flex items-center gap-2">
                  <input data-topic="${si}:${ti}" class="flex-1 min-w-0 text-sm text-slate-700 bg-slate-50 rounded-xl px-3 py-2 border border-transparent focus:border-indigo-400 focus:outline-none" value="${esc(t.title)}">
                  <input data-hours="${si}:${ti}" type="number" min="0.5" step="0.5" class="w-16 text-sm text-slate-600 bg-slate-50 rounded-xl px-2 py-2 border border-transparent focus:border-indigo-400 focus:outline-none shrink-0" value="${t.hours}">
                  <button data-rmtopic="${si}:${ti}" class="text-rose-400 hover:text-rose-600 px-1 shrink-0">✕</button>
                </div>`).join('')}
              <button data-addtopic="${si}" class="text-xs font-semibold text-indigo-600">+ Add topic</button>
            </div>
          </div>`).join('')}
        <button id="pv_addstage" class="text-xs font-semibold text-indigo-600">+ Add stage</button>
        ${structure.tools.length ? `
          <div class="mt-4 pt-4 border-t border-slate-100">
            <div class="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">🧰 Tools</div>
            <div class="flex flex-wrap gap-2">
              ${structure.tools.map(t => `<span class="text-xs bg-slate-100 text-slate-600 rounded-lg px-3 py-1.5" title="${esc(t.purpose)}">${esc(t.name)}</span>`).join('')}
            </div>
          </div>` : ''}
        <button id="pv_save" class="btn btn-success btn-block mt-6">💾 Save roadmap</button>
      </div>`;

    area.querySelectorAll('[data-stage]').forEach(i => i.oninput = () => { structure.stages[Number(i.dataset.stage)].title = i.value; });
    area.querySelectorAll('[data-topic]').forEach(i => i.oninput = () => {
      const [si, ti] = i.dataset.topic.split(':').map(Number); structure.stages[si].topics[ti].title = i.value;
    });
    area.querySelectorAll('[data-hours]').forEach(i => i.oninput = () => {
      const [si, ti] = i.dataset.hours.split(':').map(Number); structure.stages[si].topics[ti].hours = Number(i.value) || 1;
    });
    area.querySelectorAll('[data-rmtopic]').forEach(b => b.onclick = () => {
      const [si, ti] = b.dataset.rmtopic.split(':').map(Number); structure.stages[si].topics.splice(ti, 1); renderPreview();
    });
    area.querySelectorAll('[data-rmstage]').forEach(b => b.onclick = () => { structure.stages.splice(Number(b.dataset.rmstage), 1); renderPreview(); });
    area.querySelectorAll('[data-addtopic]').forEach(b => b.onclick = () => {
      structure.stages[Number(b.dataset.addtopic)].topics.push({ title: 'New topic', hours: 2, tasks: [] }); renderPreview();
    });
    document.getElementById('pv_addstage').onclick = () => {
      structure.stages.push({ title: 'New stage', topics: [{ title: 'New topic', hours: 2, tasks: [] }] }); renderPreview();
    };
    document.getElementById('pv_save').onclick = async () => {
      if (structure.stages.every(s => s.topics.length === 0)) return toast('Add at least one topic.', 'error');
      const btn = document.getElementById('pv_save');
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        const r = await API.post('/api/roadmaps', { ...readForm(), structure });
        toast('Roadmap saved! 🗺️');
        location.hash = `#/roadmaps/${r.id}`;
      } catch (err) { toast(err.message, 'error'); btn.disabled = false; btn.textContent = '💾 Save roadmap'; }
    };
  }
}

/* ================= DETAIL ================= */
async function roadmapDetail(el, id) {
  let data;
  try { data = await API.get(`/api/roadmaps/${id}`); }
  catch (err) {
    el.innerHTML = emptyState('🗺️', 'Roadmap not found', err.message,
      '<a href="#/roadmaps" class="btn btn-ghost inline-flex">← Back to roadmaps</a>');
    return;
  }
  const { roadmap: rm, stages, tools, resources, next_topic } = data;

  el.innerHTML = `
    <a href="#/roadmaps" class="text-xs font-semibold text-slate-400 hover:text-slate-600">← All roadmaps</a>

    <div class="card p-5 sm:p-6 mt-3">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <h2 class="text-lg sm:text-xl font-bold text-slate-900 leading-snug">${esc(rm.title)}</h2>
          <div class="flex flex-wrap gap-2 mt-2">
            ${badge(rm.course_code || rm.course_name, 'bg-indigo-50 text-indigo-700')}
            ${badge(rm.current_level, 'bg-slate-100 text-slate-600')}
            ${badge(rm.preferred_learning_style, 'bg-violet-50 text-violet-700')}
            ${badge(rm.difficulty, DIFFICULTY_BADGE[rm.difficulty])}
          </div>
          ${rm.goal ? `<p class="text-sm text-slate-500 mt-3">🎯 ${esc(rm.goal)}</p>` : ''}
          <p class="text-xs text-slate-400 mt-2">📅 ${rm.duration_days} days${rm.deadline_date ? ` · deadline ${fmtDate(rm.deadline_date)}` : ''}</p>
        </div>
        <select id="rmStatus" class="inp !w-auto !min-h-0 !py-2 text-xs font-semibold shrink-0">
          ${['Not Started', 'In Progress', 'Completed', 'Paused'].map(s => `<option ${rm.status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>

      <div class="flex justify-between text-sm mt-5 mb-1.5">
        <span class="text-slate-500">Overall progress</span><span class="font-bold text-slate-800">${rm.progress_percentage}%</span>
      </div>
      ${progressBar(rm.progress_percentage)}

      ${rm.behind_schedule ? `
        <div class="mt-4 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-sm text-amber-800">
          ⚠️ <strong>Behind schedule.</strong> Progress is lower than expected — schedule extra sessions to catch up.
        </div>` : ''}

      <div class="flex flex-col sm:flex-row flex-wrap gap-2 mt-5">
        <button id="rmSchedule" class="btn btn-primary flex-1 sm:flex-none">⚡ Generate Schedule from Roadmap</button>
        <a href="#/roadmaps/${rm.id}/edit" class="btn btn-ghost">✏️ Edit</a>
        <button id="rmDelete" class="btn border border-rose-200 text-rose-600 bg-white">🗑 Delete</button>
      </div>
      <div id="schedResult" class="hidden mt-3 text-sm rounded-2xl px-4 py-3"></div>
    </div>

    ${next_topic ? `
      <div class="card p-5 mt-4 border-indigo-200">
        <div class="text-xs font-bold text-indigo-600 uppercase tracking-wide">Recommended next</div>
        <div class="text-sm font-semibold text-slate-800 mt-1">➡️ ${esc(next_topic.title)}</div>
        <div class="flex flex-col sm:flex-row gap-2 mt-3">
          <button data-schedule-topic="${next_topic.id}" class="btn btn-primary btn-sm flex-1">🗓 Schedule this topic</button>
          <button data-focus-topic="${esc(next_topic.title)}" class="btn btn-sm bg-violet-600 text-white flex-1">🎯 Start focus session</button>
        </div>
      </div>` : ''}

    ${tools.length ? `
      <div class="card p-5 mt-4">
        <h3 class="font-bold text-slate-900 text-sm mb-3">🧰 Tools &amp; technologies</h3>
        <div class="flex flex-wrap gap-2">
          ${tools.map(t => `<span class="text-xs bg-slate-100 text-slate-600 rounded-lg px-3 py-1.5" title="${esc(t.purpose)}">${esc(t.name)}${t.is_required ? '' : ' (optional)'}</span>`).join('')}
        </div>
      </div>` : ''}

    <div class="mt-6">
      ${stages.map((st, si) => `
        <div class="relative pl-9 sm:pl-10 pb-5 ${si < stages.length - 1 ? 'border-l-2 border-slate-200 ml-4' : 'ml-4'}">
          <span class="absolute -left-4 top-0 w-8 h-8 rounded-full grid place-items-center text-xs font-bold
            ${st.status === 'Completed' ? 'bg-emerald-500 text-white' : st.status === 'In Progress' ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-500'}">
            ${st.status === 'Completed' ? '✓' : si + 1}</span>
          <div class="card p-4 sm:p-5">
            <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h3 class="font-bold text-slate-900 text-sm sm:text-base">${esc(st.title)}</h3>
              <span class="flex items-center gap-2">${badge(st.status, RM_BADGE[st.status])}<span class="text-[11px] text-slate-400">${st.estimated_hours}h</span></span>
            </div>
            ${st.topics.map(t => `
              <div class="border border-slate-100 rounded-2xl px-3 sm:px-4 py-3 mb-2 last:mb-0">
                <div class="flex items-center gap-3">
                  <button data-toggle-topic="${t.id}" data-cur="${t.status}"
                    class="w-7 h-7 rounded-full border-2 grid place-items-center text-xs shrink-0 active:scale-90 transition
                    ${t.status === 'Completed' ? 'bg-emerald-500 border-emerald-500 text-white' : t.status === 'Skipped' ? 'bg-slate-200 border-slate-200 text-slate-400' : 'border-slate-300 text-transparent'}">✓</button>
                  <div class="flex-1 min-w-0">
                    <div class="text-sm font-medium ${t.status === 'Completed' || t.status === 'Skipped' ? 'text-slate-400 line-through' : 'text-slate-800'}">${esc(t.title)}</div>
                    <div class="text-[11px] text-slate-400 mt-0.5">${t.estimated_hours}h${t.session_count ? ` · 🗓 ${t.session_count}` : ''}</div>
                  </div>
                  <div class="flex gap-0.5 shrink-0">
                    <button data-schedule-topic="${t.id}" title="Schedule" class="p-2 rounded-lg hover:bg-indigo-50 text-indigo-600">🗓</button>
                    <button data-focus-topic="${esc(t.title)}" title="Focus" class="p-2 rounded-lg hover:bg-violet-50 text-violet-600">🎯</button>
                    <button data-skip-topic="${t.id}" title="Skip" class="p-2 rounded-lg hover:bg-slate-100 text-slate-400">⤼</button>
                  </div>
                </div>
                ${t.tasks.length ? `<div class="mt-2 pl-10 space-y-1.5">
                  ${t.tasks.map(task => `
                    <label class="flex items-start gap-2 text-xs ${task.status === 'Completed' ? 'text-slate-300 line-through' : 'text-slate-500'} cursor-pointer">
                      <input type="checkbox" data-task="${task.id}" ${task.status === 'Completed' ? 'checked' : ''} class="w-4 h-4 mt-0.5 rounded border-slate-300 text-emerald-600 shrink-0">
                      <span>${TASK_ICON[task.task_type] || '✏️'} ${esc(task.title)} <span class="text-slate-300">· ${task.estimated_minutes}m</span></span>
                    </label>`).join('')}
                </div>` : ''}
              </div>`).join('')}
          </div>
        </div>`).join('')}
    </div>

    <div class="card p-5 mt-2">
      <h3 class="font-bold text-slate-900 text-sm mb-3">📚 Recommended resources</h3>
      ${resources.length === 0
        ? '<p class="text-sm text-slate-400">No matching resources yet — check the <a href="#/resources" class="text-indigo-600">library</a>.</p>'
        : `<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            ${resources.map(r => `
              <div class="border border-slate-100 rounded-2xl p-4">
                <div class="text-sm font-semibold text-slate-800 leading-snug line-clamp-2">${esc(r.resource_title)}</div>
                <div class="mt-1.5">${qualityBadge(r.quality_score, r.quality_score >= 80 ? 'Highly Recommended' : r.quality_score >= 60 ? 'Good Resource' : r.quality_score >= 40 ? 'Average' : 'Low Confidence')}</div>
                ${r.resource_id ? `<div class="flex gap-2 mt-3">
                  <a href="/api/resources/${r.resource_id}/view" target="_blank" rel="noopener" class="btn btn-ghost btn-sm flex-1">👁 View</a>
                  <a href="/api/resources/${r.resource_id}/download" download class="btn btn-ghost btn-sm flex-1">⬇</a>
                </div>` : ''}
              </div>`).join('')}
          </div>`}
    </div>`;

  const reload = () => roadmapDetail(el, id);

  document.getElementById('rmStatus').onchange = async (e) => {
    try { await API.put(`/api/roadmaps/${id}`, { status: e.target.value }); toast('Status updated.', 'info'); reload(); }
    catch (err) { toast(err.message, 'error'); }
  };
  document.getElementById('rmDelete').onclick = async () => {
    if (!await confirmModal('Delete this roadmap? Stages, topics and tasks are removed (study sessions stay).')) return;
    try { await API.del(`/api/roadmaps/${id}`); toast('Roadmap deleted.'); location.hash = '#/roadmaps'; }
    catch (err) { toast(err.message, 'error'); }
  };
  document.getElementById('rmSchedule').onclick = async () => {
    const btn = document.getElementById('rmSchedule');
    btn.disabled = true; btn.textContent = 'Scheduling…';
    try {
      const r = await API.post(`/api/roadmaps/${id}/schedule`);
      const box = document.getElementById('schedResult');
      box.className = `mt-3 text-sm rounded-2xl px-4 py-3 ${r.created > 0 ? 'bg-emerald-50 text-emerald-800 border border-emerald-100' : 'bg-amber-50 text-amber-800 border border-amber-100'}`;
      box.innerHTML = r.messages.map(m => `<div>• ${esc(m)}</div>`).join('') +
        (r.created > 0 ? '<div class="mt-1"><a href="#/calendar" class="font-semibold underline">Open calendar →</a></div>' : '');
      box.classList.remove('hidden');
      if (r.created > 0) toast(`${r.created} session${r.created === 1 ? '' : 's'} added. 🗓️`);
    } catch (err) { toast(err.message, 'error'); }
    btn.disabled = false; btn.textContent = '⚡ Generate Schedule from Roadmap';
  };

  el.querySelectorAll('[data-toggle-topic]').forEach(b => b.onclick = async () => {
    const newStatus = b.dataset.cur === 'Completed' ? 'Not Started' : 'Completed';
    try {
      await API.patch(`/api/roadmaps/topics/${b.dataset.toggleTopic}`, { status: newStatus });
      toast(newStatus === 'Completed' ? 'Topic completed! 🎉' : 'Topic reopened.', 'info');
      reload();
    } catch (err) { toast(err.message, 'error'); }
  });
  el.querySelectorAll('[data-skip-topic]').forEach(b => b.onclick = async () => {
    const cur = el.querySelector(`[data-toggle-topic="${b.dataset.skipTopic}"]`).dataset.cur;
    try { await API.patch(`/api/roadmaps/topics/${b.dataset.skipTopic}`, { status: cur === 'Skipped' ? 'Not Started' : 'Skipped' }); reload(); }
    catch (err) { toast(err.message, 'error'); }
  });
  el.querySelectorAll('[data-task]').forEach(cb => cb.onchange = async () => {
    try { await API.patch(`/api/roadmaps/tasks/${cb.dataset.task}`, { status: cb.checked ? 'Completed' : 'Not Started' }); }
    catch (err) { toast(err.message, 'error'); cb.checked = !cb.checked; }
  });
  el.querySelectorAll('[data-schedule-topic]').forEach(b => b.onclick = async () => {
    try {
      const r = await API.post(`/api/roadmaps/${id}/schedule`, { topic_id: Number(b.dataset.scheduleTopic) });
      toast(r.created > 0 ? `${r.created} session${r.created === 1 ? '' : 's'} scheduled. 🗓️` : (r.messages[0] || 'Nothing to schedule.'), r.created > 0 ? 'success' : 'info');
      reload();
    } catch (err) { toast(err.message, 'error'); }
  });
  el.querySelectorAll('[data-focus-topic]').forEach(b => b.onclick = () => {
    localStorage.setItem('ef_focus_prefill', JSON.stringify({ title: b.dataset.focusTopic, course_id: rm.course_id }));
    location.hash = '#/focus';
  });
}

/* ================= EDIT ================= */
async function roadmapEdit(el, id) {
  let data;
  try { data = await API.get(`/api/roadmaps/${id}`); }
  catch (err) { el.innerHTML = emptyState('🗺️', 'Roadmap not found', err.message); return; }
  const { roadmap: rm, stages } = data;

  el.innerHTML = `
    <a href="#/roadmaps/${id}" class="text-xs font-semibold text-slate-400 hover:text-slate-600">← Back to roadmap</a>
    <div class="max-w-3xl">
      <div class="card p-5 sm:p-6 mt-3">
        <h2 class="font-bold text-slate-900 mb-4">Edit roadmap</h2>
        <div class="grid sm:grid-cols-2 gap-4">
          ${field('Title', `<input class="inp" id="re_title" value="${esc(rm.title)}">`)}
          ${field('Status', `<select class="inp" id="re_status">${['Not Started', 'In Progress', 'Completed', 'Paused'].map(s => `<option ${rm.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>`)}
          ${field('Current level', `<select class="inp" id="re_level">${['Beginner', 'Intermediate', 'Advanced'].map(s => `<option ${rm.current_level === s ? 'selected' : ''}>${s}</option>`).join('')}</select>`)}
          ${field('Learning style', `<select class="inp" id="re_style">${['Mixed', 'Theory-based', 'Practical', 'Project-based', 'Exam-focused'].map(s => `<option ${rm.preferred_learning_style === s ? 'selected' : ''}>${s}</option>`).join('')}</select>`)}
          ${field('Difficulty', `<select class="inp" id="re_diff">${['Easy', 'Moderate', 'Hard'].map(s => `<option ${rm.difficulty === s ? 'selected' : ''}>${s}</option>`).join('')}</select>`)}
          ${field('Duration (days)', `<input type="number" min="3" max="180" class="inp" id="re_days" value="${rm.duration_days}">`)}
          ${field('Deadline date', `<input type="date" class="inp" id="re_date" value="${rm.deadline_date || ''}">`)}
        </div>
        <div class="mt-4">${field('Target goal', `<textarea class="inp" id="re_goal" rows="2">${esc(rm.goal || '')}</textarea>`)}</div>
        <button id="re_save" class="btn btn-primary btn-block sm:w-auto mt-4">Save changes</button>
      </div>

      <div class="card p-5 sm:p-6 mt-4">
        <h3 class="font-bold text-slate-900 mb-1">Stages &amp; topics</h3>
        <p class="text-xs text-slate-400 mb-4">Edits save when you tap away from a field.</p>
        ${stages.map(st => `
          <div class="border border-slate-200 rounded-2xl p-4 mb-3">
            <div class="flex items-center justify-between gap-2 mb-2">
              <span class="font-semibold text-sm text-slate-800 min-w-0 truncate">${esc(st.title)}</span>
              <button data-rmstage="${st.id}" class="text-xs text-rose-400 hover:text-rose-600 shrink-0">Remove stage</button>
            </div>
            <div class="space-y-1.5">
              ${st.topics.map(t => `
                <div class="flex items-center gap-2">
                  <input data-rename="${t.id}" class="flex-1 min-w-0 text-sm text-slate-700 bg-slate-50 rounded-xl px-3 py-2 border border-transparent focus:border-indigo-400 focus:outline-none" value="${esc(t.title)}">
                  <input data-rehours="${t.id}" type="number" min="0.5" step="0.5" class="w-16 text-sm bg-slate-50 rounded-xl px-2 py-2 border border-transparent focus:border-indigo-400 focus:outline-none shrink-0" value="${t.estimated_hours}">
                  <button data-rmtopic="${t.id}" class="text-rose-400 hover:text-rose-600 px-1 shrink-0">✕</button>
                </div>`).join('')}
              <div class="flex gap-2 mt-2">
                <input data-newtopic="${st.id}" class="flex-1 min-w-0 text-sm bg-white rounded-xl px-3 py-2 border border-dashed border-slate-300 focus:border-indigo-400 focus:outline-none" placeholder="New topic title…">
                <button data-addtopic="${st.id}" class="btn btn-soft btn-sm shrink-0">+ Add</button>
              </div>
            </div>
          </div>`).join('')}
        <div class="flex gap-2 mt-3">
          <input id="re_newstage" class="flex-1 min-w-0 text-sm bg-white rounded-xl px-3 py-2 border border-dashed border-slate-300 focus:border-indigo-400 focus:outline-none" placeholder="New stage title…">
          <button id="re_addstage" class="btn btn-soft btn-sm shrink-0">+ Add stage</button>
        </div>
      </div>
    </div>`;

  const reload = () => roadmapEdit(el, id);

  document.getElementById('re_save').onclick = async () => {
    try {
      await API.put(`/api/roadmaps/${id}`, {
        title: document.getElementById('re_title').value.trim(),
        status: document.getElementById('re_status').value,
        current_level: document.getElementById('re_level').value,
        preferred_learning_style: document.getElementById('re_style').value,
        difficulty: document.getElementById('re_diff').value,
        duration_days: Number(document.getElementById('re_days').value),
        deadline_date: document.getElementById('re_date').value || null,
        goal: document.getElementById('re_goal').value.trim(),
      });
      toast('Roadmap updated.');
      location.hash = `#/roadmaps/${id}`;
    } catch (err) { toast(err.message, 'error'); }
  };

  el.querySelectorAll('[data-rename]').forEach(i => i.onchange = async () => {
    try { await API.patch(`/api/roadmaps/topics/${i.dataset.rename}`, { title: i.value }); toast('Renamed.', 'info'); }
    catch (err) { toast(err.message, 'error'); }
  });
  el.querySelectorAll('[data-rehours]').forEach(i => i.onchange = async () => {
    try { await API.patch(`/api/roadmaps/topics/${i.dataset.rehours}`, { estimated_hours: Number(i.value) }); toast('Hours updated.', 'info'); }
    catch (err) { toast(err.message, 'error'); }
  });
  el.querySelectorAll('[data-rmtopic]').forEach(b => b.onclick = async () => {
    if (!await confirmModal('Remove this topic?')) return;
    try { await API.del(`/api/roadmaps/topics/${b.dataset.rmtopic}`); reload(); } catch (err) { toast(err.message, 'error'); }
  });
  el.querySelectorAll('[data-rmstage]').forEach(b => b.onclick = async () => {
    if (!await confirmModal('Remove this stage and all its topics?')) return;
    try { await API.del(`/api/roadmaps/stages/${b.dataset.rmstage}`); reload(); } catch (err) { toast(err.message, 'error'); }
  });
  el.querySelectorAll('[data-addtopic]').forEach(b => b.onclick = async () => {
    const input = el.querySelector(`[data-newtopic="${b.dataset.addtopic}"]`);
    if (!input.value.trim()) return toast('Type the topic title first.', 'error');
    try { await API.post(`/api/roadmaps/stages/${b.dataset.addtopic}/topics`, { title: input.value.trim() }); reload(); }
    catch (err) { toast(err.message, 'error'); }
  });
  document.getElementById('re_addstage').onclick = async () => {
    const v = document.getElementById('re_newstage').value.trim();
    if (!v) return toast('Type the stage title first.', 'error');
    try { await API.post(`/api/roadmaps/${id}/stages`, { title: v }); reload(); } catch (err) { toast(err.message, 'error'); }
  };
}
