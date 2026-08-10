/** Courses: card grid + add/edit/delete via modal. */
Views.courses = async (el) => {
  const { courses } = await API.get('/api/courses');

  el.innerHTML = `
    <div class="flex items-center justify-between gap-3 mb-4">
      <p class="text-sm text-slate-500">${courses.length} course${courses.length === 1 ? '' : 's'} registered</p>
      <button id="addBtn" class="btn btn-primary btn-sm">+ Add Course</button>
    </div>
    ${courses.length === 0
      ? emptyState('📘', 'No courses yet', 'Add the units you are taking this semester to get started.',
          `<button onclick="document.getElementById('addBtn').click()" class="btn btn-primary">Add your first course</button>`)
      : `<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          ${courses.map(c => `
            <div class="card p-5 flex flex-col">
              <div class="flex items-start justify-between gap-2">
                <span class="text-xs font-bold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-lg">${esc(c.code)}</span>
                ${badge(c.difficulty, DIFFICULTY_BADGE[c.difficulty])}
              </div>
              <h3 class="font-semibold text-slate-900 mt-3 leading-snug">${esc(c.title)}</h3>
              <p class="text-xs text-slate-400 mt-1 flex-1 line-clamp-2">${esc(c.description || 'No description')}</p>
              <div class="text-[11px] text-slate-400 mt-3">${c.pending_deadlines} pending · added ${fmtDate(c.created_at)}</div>
              <div class="flex gap-2 mt-4">
                <button data-edit="${c.id}" class="btn btn-ghost btn-sm flex-1">Edit</button>
                <button data-del="${c.id}" class="btn btn-sm flex-1 border border-rose-200 text-rose-600 bg-white hover:bg-rose-50">Delete</button>
              </div>
            </div>`).join('')}
        </div>`}`;

  const showForm = (course = null) => {
    openModal(course ? 'Edit Course' : 'Add Course', `
      <form id="courseForm" class="space-y-4">
        ${field('Course title', `<input class="inp" id="cf_title" required value="${esc(course?.title || '')}" placeholder="e.g. Database Systems">`)}
        ${field('Course code', `<input class="inp" id="cf_code" required value="${esc(course?.code || '')}" placeholder="e.g. CSC 224">`)}
        ${field('Difficulty level', `<select class="inp" id="cf_diff">
            ${['Easy', 'Moderate', 'Hard'].map(dd => `<option ${course?.difficulty === dd ? 'selected' : ''}>${dd}</option>`).join('')}
          </select>`)}
        ${field('Description (optional)', `<textarea class="inp" id="cf_desc" rows="3" placeholder="Topics covered, lecturer…">${esc(course?.description || '')}</textarea>`)}
        <div class="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2">
          <button type="button" onclick="closeModal()" class="btn btn-ghost">Cancel</button>
          <button type="submit" class="btn btn-primary">${course ? 'Save changes' : 'Add course'}</button>
        </div>
      </form>`);

    document.getElementById('courseForm').onsubmit = async (e) => {
      e.preventDefault();
      const body = {
        title: document.getElementById('cf_title').value.trim(),
        code: document.getElementById('cf_code').value.trim(),
        difficulty: document.getElementById('cf_diff').value,
        description: document.getElementById('cf_desc').value.trim(),
      };
      if (!body.title || !body.code) return toast('Title and code are required.', 'error');
      try {
        if (course) await API.put(`/api/courses/${course.id}`, body);
        else await API.post('/api/courses', body);
        closeModal();
        toast(course ? 'Course updated.' : 'Course added.');
        Views.courses(el);
      } catch (err) { toast(err.message, 'error'); }
    };
  };

  document.getElementById('addBtn').onclick = () => showForm();
  el.querySelectorAll('[data-edit]').forEach(b =>
    b.onclick = () => showForm(courses.find(c => c.id === Number(b.dataset.edit))));
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!await confirmModal('Delete this course? Its deadlines and study sessions will also be removed.')) return;
    try { await API.del(`/api/courses/${b.dataset.del}`); toast('Course deleted.'); Views.courses(el); }
    catch (err) { toast(err.message, 'error'); }
  });

  if (location.hash.includes('add=1')) { history.replaceState(null, '', '#/courses'); showForm(); }
};
