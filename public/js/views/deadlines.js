/** Deadlines: urgency-ordered cards (mobile) / table (desktop) + CRUD + reminders. */
Views.deadlines = async (el) => {
  const [{ deadlines }, { courses }] = await Promise.all([
    API.get('/api/deadlines'), API.get('/api/courses'),
  ]);
  const TYPES = ['Assignment', 'CAT/Test', 'Exam', 'Project', 'Presentation', 'Other'];

  const statusCls = (s) => s === 'Completed' ? 'bg-emerald-100 text-emerald-700'
    : s === 'Missed' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700';

  el.innerHTML = `
    <div class="flex items-center justify-between gap-3 mb-4">
      <p class="text-sm text-slate-500">Sorted by urgency</p>
      <button id="addBtn" class="btn btn-primary btn-sm">+ Add Deadline</button>
    </div>
    ${deadlines.length === 0
      ? emptyState('deadlines', 'No deadlines yet', 'Add assignments, CATs, exams and projects so EduFlex can plan your studying.',
          `<button onclick="document.getElementById('addBtn').click()" class="btn btn-primary">Add your first deadline</button>`)
      : `
      <!-- Mobile cards -->
      <div class="space-y-3 lg:hidden">
        ${deadlines.map(d => {
          const due = dueLabel(d.due_date);
          return `<div class="card p-4">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="font-semibold text-slate-800 text-sm leading-snug">${d.reminder_enabled ? '' : ''}${esc(d.title)}</div>
                <div class="text-xs text-slate-400 mt-1">${esc(d.course_code)} · ${esc(d.type)} · ${d.estimated_hours}h</div>
              </div>
              ${badge(d.status, statusCls(d.status))}
            </div>
            <div class="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-slate-50">
              <div class="min-w-0">
                <div class="text-xs text-slate-600">${fmtDT(d.due_date)}</div>
                ${d.status === 'Pending' ? `<div class="text-[11px] font-medium ${due.cls}">${due.text}</div>` : ''}
              </div>
              <div class="flex gap-1.5 shrink-0">
                ${badge(d.priority, PRIORITY_BADGE[d.priority])}
                ${d.status === 'Pending' ? `<button data-done="${d.id}" class="btn btn-sm !px-2.5 bg-emerald-50 text-emerald-700">✓</button>` : ''}
                <button data-edit="${d.id}" class="btn btn-ghost btn-sm !px-2.5">✎</button>
                <button data-del="${d.id}" class="btn btn-sm !px-2.5 bg-rose-50 text-rose-600 [&_svg]:w-4 [&_svg]:h-4" title="Delete" aria-label="Delete">${icon('trash')}</button>
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>

      <!-- Desktop table -->
      <div class="card overflow-x-auto hidden lg:block">
        <table class="w-full text-sm min-w-[760px]">
          <thead><tr class="text-left text-xs text-slate-400 border-b border-slate-100">
            <th class="px-5 py-3 font-semibold">Deadline</th><th class="px-3 py-3 font-semibold">Course</th>
            <th class="px-3 py-3 font-semibold">Type</th><th class="px-3 py-3 font-semibold">Due</th>
            <th class="px-3 py-3 font-semibold">Priority</th><th class="px-3 py-3 font-semibold">Hours</th>
            <th class="px-3 py-3 font-semibold">Status</th><th class="px-3 py-3"></th>
          </tr></thead>
          <tbody>
            ${deadlines.map(d => {
              const due = dueLabel(d.due_date);
              return `<tr class="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                <td class="px-5 py-3.5 font-medium text-slate-800">${d.reminder_enabled ? '' : ''}${esc(d.title)}</td>
                <td class="px-3 py-3.5 text-slate-500">${esc(d.course_code)}</td>
                <td class="px-3 py-3.5 text-slate-500">${esc(d.type)}</td>
                <td class="px-3 py-3.5"><div class="text-slate-700">${fmtDT(d.due_date)}</div>
                  ${d.status === 'Pending' ? `<div class="text-xs font-medium ${due.cls}">${due.text}</div>` : ''}</td>
                <td class="px-3 py-3.5">${badge(d.priority, PRIORITY_BADGE[d.priority])}</td>
                <td class="px-3 py-3.5 text-slate-500">${d.estimated_hours}h</td>
                <td class="px-3 py-3.5">${badge(d.status, statusCls(d.status))}</td>
                <td class="px-3 py-3.5 text-right whitespace-nowrap">
                  ${d.status === 'Pending' ? `<button data-done="${d.id}" title="Complete" class="text-emerald-600 hover:bg-emerald-50 rounded-lg p-2">✓</button>` : ''}
                  <button data-edit="${d.id}" title="Edit" class="text-slate-400 hover:bg-slate-100 rounded-lg p-2">✎</button>
                  <button data-del="${d.id}" title="Delete" aria-label="Delete" class="text-rose-500 hover:bg-rose-50 rounded-lg p-2 [&_svg]:w-4 [&_svg]:h-4">${icon('trash')}</button>
                </td></tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`}`;

  const showForm = (dl = null) => {
    if (courses.length === 0) { toast('Add a course first.', 'info'); location.hash = '#/courses?add=1'; return; }
    openModal(dl ? 'Edit Deadline' : 'Add Deadline', `
      <form id="dlForm" class="space-y-4">
        ${field('Course', `<select class="inp" id="df_course">
          ${courses.map(c => `<option value="${c.id}" ${dl?.course_id === c.id ? 'selected' : ''}>${esc(c.code)} — ${esc(c.title)}</option>`).join('')}
        </select>`)}
        ${field('Deadline title', `<input class="inp" id="df_title" required value="${esc(dl?.title || '')}">`)}
        <div class="grid grid-cols-2 gap-3">
          ${field('Type', `<select class="inp" id="df_type">${TYPES.map(t => `<option ${dl?.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>`)}
          ${field('Priority', `<select class="inp" id="df_prio">${['Low', 'Medium', 'High'].map(p => `<option ${(dl?.priority || 'Medium') === p ? 'selected' : ''}>${p}</option>`).join('')}</select>`)}
        </div>
        <div class="grid grid-cols-2 gap-3">
          ${field('Due date & time', `<input type="datetime-local" class="inp" id="df_due" required value="${dl?.due_date || ''}">`)}
          ${field('Est. hours', `<input type="number" min="0.5" max="200" step="0.5" class="inp" id="df_hours" required value="${dl?.estimated_hours || DEFAULT_HOURS['Assignment']}">`)}
        </div>
        ${dl ? field('Status', `<select class="inp" id="df_status">${['Pending', 'Completed', 'Missed'].map(s => `<option ${dl.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>`) : ''}
        <div class="border border-slate-200 rounded-2xl px-4 py-3">
          <label class="flex items-center justify-between text-sm font-medium text-slate-700 cursor-pointer">
            <span>Remind me</span>
            <input type="checkbox" id="df_remind" ${dl?.reminder_enabled ? 'checked' : ''} class="w-5 h-5 rounded border-slate-300 text-indigo-600">
          </label>
          <select id="df_remind_when" class="inp mt-2.5 ${dl?.reminder_enabled ? '' : 'hidden'}">
            <option value="1440" ${(dl?.reminder_minutes_before ?? 1440) === 1440 ? 'selected' : ''}>1 day before</option>
            <option value="60" ${dl?.reminder_minutes_before === 60 ? 'selected' : ''}>1 hour before</option>
          </select>
        </div>
        <div class="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-1">
          <button type="button" onclick="closeModal()" class="btn btn-ghost">Cancel</button>
          <button type="submit" class="btn btn-primary">${dl ? 'Save changes' : 'Add deadline'}</button>
        </div>
      </form>`);

    document.getElementById('df_remind').onchange = (e) =>
      document.getElementById('df_remind_when').classList.toggle('hidden', !e.target.checked);

    if (!dl) {
      let touched = false;
      document.getElementById('df_hours').oninput = () => { touched = true; };
      document.getElementById('df_type').onchange = (e) => {
        if (!touched) document.getElementById('df_hours').value = DEFAULT_HOURS[e.target.value] || 2;
      };
    }

    document.getElementById('dlForm').onsubmit = async (e) => {
      e.preventDefault();
      const body = {
        course_id: Number(document.getElementById('df_course').value),
        title: document.getElementById('df_title').value.trim(),
        type: document.getElementById('df_type').value,
        priority: document.getElementById('df_prio').value,
        due_date: document.getElementById('df_due').value,
        estimated_hours: Number(document.getElementById('df_hours').value),
        reminder_enabled: document.getElementById('df_remind').checked,
        reminder_minutes_before: Number(document.getElementById('df_remind_when').value),
      };
      if (dl) body.status = document.getElementById('df_status').value;
      if (!body.title || !body.due_date) return toast('Title and due date are required.', 'error');
      if (!dl && new Date(body.due_date) < new Date()) return toast('Due date should be in the future.', 'error');
      try {
        if (dl) await API.put(`/api/deadlines/${dl.id}`, body);
        else await API.post('/api/deadlines', body);
        closeModal();
        toast(dl ? 'Deadline updated.' : 'Deadline added.');
        autoRegenerate();
        Views.deadlines(el);
      } catch (err) { toast(err.message, 'error'); }
    };
  };

  document.getElementById('addBtn').onclick = () => showForm();
  el.querySelectorAll('[data-edit]').forEach(b =>
    b.onclick = () => showForm(deadlines.find(d => d.id === Number(b.dataset.edit))));
  el.querySelectorAll('[data-done]').forEach(b => b.onclick = async () => {
    try { await API.put(`/api/deadlines/${b.dataset.done}`, { status: 'Completed' }); toast('Marked complete.'); Views.deadlines(el); }
    catch (err) { toast(err.message, 'error'); }
  });
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!await confirmModal('Delete this deadline?')) return;
    try { await API.del(`/api/deadlines/${b.dataset.del}`); toast('Deadline deleted.'); Views.deadlines(el); }
    catch (err) { toast(err.message, 'error'); }
  });

  if (location.hash.includes('add=1')) { history.replaceState(null, '', '#/deadlines'); showForm(); }
};
