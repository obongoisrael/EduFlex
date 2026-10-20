/**
 * Resource Library: browse / search / filter / upvote / view / download / upload.
 * Privacy: cards show contributor initials + institution only.
 */
Views.resources = async (el) => {
  const state = (Views.resources._state ||= { search: '', category: '', institution: '', course: '', sort: 'recent', mine: false, topQuality: false });
  const CATEGORIES = ['Notes', 'Slides', 'PDF', 'Past Paper', 'Assignment Guide', 'Other'];
  const plus = App.isPlus();
  if (!plus) { state.topQuality = false; if (state.sort === 'quality') state.sort = 'recent'; } // quality filters are Plus

  const params = new URLSearchParams();
  if (state.search) params.set('search', state.search);
  if (state.category) params.set('category', state.category);
  if (state.institution) params.set('institution', state.institution);
  if (state.course) params.set('course', state.course);
  if (state.sort) params.set('sort', state.sort);
  if (state.mine) params.set('mine', '1');
  if (state.topQuality) params.set('top_quality', '1');

  const hasFilters = state.search || state.category || state.institution || state.course || state.mine || state.topQuality;
  const [{ resources }, { institutions }, recData] = await Promise.all([
    API.get(`/api/resources?${params}`),
    API.get('/api/resources/institutions'),
    hasFilters ? Promise.resolve(null) : API.get('/api/smart/resources?limit=3').catch(() => null),
  ]);

  const fmtSize = (b) => !b ? '0 KB' : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

  el.innerHTML = `
    <div class="flex items-center justify-between gap-3 mb-4">
      <p class="text-sm text-slate-500 min-w-0 truncate">${resources.length} resource${resources.length === 1 ? '' : 's'} · initials only</p>
      <button id="uploadBtn" class="btn btn-primary btn-sm shrink-0">Upload</button>
    </div>

    <div class="card p-4 mb-4">
      <input id="f_search" class="inp" placeholder="Search" value="${esc(state.search)}">
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-2">
        <select id="f_category" class="inp"><option value="">All categories</option>
          ${CATEGORIES.map(c => `<option ${state.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
        <select id="f_institution" class="inp"><option value="">All institutions</option>
          ${institutions.map(i => `<option ${state.institution === i ? 'selected' : ''}>${esc(i)}</option>`).join('')}</select>
        <select id="f_sort" class="inp">
          <option value="recent" ${state.sort === 'recent' ? 'selected' : ''}>Most recent</option>
          <option value="top" ${state.sort === 'top' ? 'selected' : ''}>Most upvoted</option>
          <option value="quality" ${state.sort === 'quality' ? 'selected' : ''}>Highest quality${plus ? '' : ' (Plus)'}</option>
        </select>
        <input id="f_course" class="inp" placeholder="Course name or code" value="${esc(state.course)}">
      </div>
      <div class="flex flex-wrap items-center gap-4 mt-3">
        <label class="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
          <input type="checkbox" id="f_mine" ${state.mine ? 'checked' : ''} class="w-4 h-4 rounded border-slate-300 text-indigo-600"> My uploads
        </label>
        <label class="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
          <input type="checkbox" id="f_quality" ${state.topQuality ? 'checked' : ''} class="w-4 h-4 rounded border-slate-300 text-emerald-600"> Highly recommended ${plus ? '' : proBadge()}
        </label>
        <button id="f_clear" class="text-xs font-semibold text-slate-400 hover:text-slate-600 ml-auto">Clear</button>
      </div>
    </div>

    ${recData && recData.resources.length ? `
      <div class="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 mb-4">
        <h3 class="text-sm font-bold text-indigo-900 mb-3">Recommended for your courses</h3>
        <div class="grid sm:grid-cols-3 gap-3">
          ${recData.resources.map(r => `
            <div class="bg-white rounded-2xl p-4 border border-indigo-100">
              <div class="text-sm font-semibold text-slate-800 leading-snug line-clamp-2">${esc(r.title)}</div>
              <div class="text-xs text-slate-400 mt-1 truncate">${esc(r.category)} · ${esc(r.course_name)}</div>
              <div class="mt-2">${qualityBadge(r.quality_score, r.quality_label)}</div>
              <div class="flex gap-2 mt-3">
                <a href="/api/resources/${r.id}/view" target="_blank" rel="noopener" class="btn btn-ghost btn-sm flex-1">View</a>
                <a href="/api/resources/${r.id}/download" download class="btn btn-ghost btn-sm flex-1 [&_svg]:w-4 [&_svg]:h-4" title="Download" aria-label="Download">${icon('download')}</a>
              </div>
            </div>`).join('')}
        </div>
      </div>` : ''}

    ${resources.length === 0
      ? emptyState('resources', 'No resources found', hasFilters ? 'Try adjusting your search or filters.' : 'Be the first to share notes or past papers!',
          `<button onclick="document.getElementById('uploadBtn').click()" class="btn btn-primary">Upload a resource</button>`)
      : `<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          ${resources.map(r => `
            <div class="card p-5 flex flex-col">
              <div class="flex items-start justify-between gap-2">
                ${tintIcon(r.category === 'Slides' ? 'layers' : r.category === 'Past Paper' ? 'exam' : 'file', 'blue', '2.5rem')}
                ${badge(r.category, 'bg-indigo-50 text-indigo-700')}
              </div>
              <h3 class="font-semibold text-slate-900 mt-3 leading-snug">${esc(r.title)}</h3>
              <p class="text-xs text-slate-400 mt-1 flex-1 line-clamp-2">${esc(r.description || '')}</p>
              <div class="mt-2">${qualityBadge(r.quality_score, r.quality_label)}</div>
              <div class="text-xs text-slate-500 mt-3 space-y-0.5">
                <div class="truncate">${esc(r.course_name)}${r.course_code ? ` (${esc(r.course_code)})` : ''}</div>
                <div class="truncate">${esc(r.institution)}</div>
                <div class="text-slate-400 truncate">${fmtSize(r.file_size)} · ${fmtDate(r.created_at)} · ${r.views_count || 0} · ${r.downloads_count || 0}</div>
              </div>
              <div class="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-slate-50">
                <div class="flex items-center gap-2 min-w-0" title="Contributor (initials only)">
                  <span class="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white grid place-items-center text-[11px] font-bold shrink-0">${esc(r.public_username)}</span>
                  <span class="text-xs text-slate-400 truncate">${r.is_owner ? 'you' : esc(r.public_username)}</span>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                  <button data-vote="${r.id}" class="btn btn-sm !px-2.5 ${r.voted_by_me ? 'bg-indigo-600 text-white' : 'btn-ghost'}">▲ ${r.upvotes_count}</button>
                  <a href="/api/resources/${r.id}/view" target="_blank" rel="noopener" class="btn btn-ghost btn-sm !px-2.5 [&_svg]:w-4 [&_svg]:h-4" title="View" aria-label="View">${icon('eye')}</a>
                  <a href="/api/resources/${r.id}/download" download class="btn btn-ghost btn-sm !px-2.5 [&_svg]:w-4 [&_svg]:h-4" title="Download" aria-label="Download">${icon('download')}</a>
                  ${r.is_owner ? `<button data-del="${r.id}" class="btn btn-sm !px-2 text-rose-500 bg-rose-50 [&_svg]:w-4 [&_svg]:h-4" title="Delete" aria-label="Delete">${icon('trash')}</button>` : ''}
                </div>
              </div>
            </div>`).join('')}
        </div>`}`;

  const refresh = () => Views.resources(el);
  let deb;
  document.getElementById('f_search').oninput = (e) => { clearTimeout(deb); deb = setTimeout(() => { state.search = e.target.value.trim(); refresh(); }, 400); };
  document.getElementById('f_course').oninput = (e) => { clearTimeout(deb); deb = setTimeout(() => { state.course = e.target.value.trim(); refresh(); }, 400); };
  document.getElementById('f_category').onchange = (e) => { state.category = e.target.value; refresh(); };
  document.getElementById('f_institution').onchange = (e) => { state.institution = e.target.value; refresh(); };
  document.getElementById('f_sort').onchange = (e) => {
    if (e.target.value === 'quality' && !plus) { e.target.value = state.sort; return showUpgrade('Ranking by quality is an EduFlex Plus feature.'); }
    state.sort = e.target.value; refresh();
  };
  document.getElementById('f_mine').onchange = (e) => { state.mine = e.target.checked; refresh(); };
  document.getElementById('f_quality').onchange = (e) => {
    if (!plus) { e.target.checked = false; return showUpgrade('The "Highly recommended" filter is an EduFlex Plus feature.'); }
    state.topQuality = e.target.checked; refresh();
  };
  document.getElementById('f_clear').onclick = () => { Object.assign(state, { search: '', category: '', institution: '', course: '', sort: 'recent', mine: false, topQuality: false }); refresh(); };

  el.querySelectorAll('[data-vote]').forEach(b => b.onclick = async () => {
    try {
      const r = await API.post(`/api/resources/${b.dataset.vote}/vote`);
      b.textContent = `▲ ${r.upvotes_count}`;
      b.className = `btn btn-sm !px-2.5 ${r.voted ? 'bg-indigo-600 text-white' : 'btn-ghost'}`;
    } catch (err) { toast(err.message, 'error'); }
  });
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!await confirmModal('Delete this resource? The file is removed permanently.')) return;
    try { await API.del(`/api/resources/${b.dataset.del}`); toast('Resource deleted.'); refresh(); }
    catch (err) { toast(err.message, 'error'); }
  });

  const showUpload = () => {
    if (App.offline) return toast('You are offline — uploading needs a connection.', 'error');
    openModal('Upload Resource', `
      <form id="upForm" class="space-y-4">
        ${field('Resource title', `<input class="inp" id="up_title" required>`)}
        ${field('Description', `<textarea class="inp" id="up_desc" rows="2"></textarea>`)}
        <div class="grid grid-cols-2 gap-3">
          ${field('Course name', `<input class="inp" id="up_cname" required>`)}
          ${field('Course code', `<input class="inp" id="up_ccode">`)}
        </div>
        ${field('Category', `<select class="inp" id="up_cat">${CATEGORIES.map(c => `<option>${c}</option>`).join('')}</select>`)}
        ${field('PDF file (max 20 MB)', `<input type="file" class="inp !py-2.5" id="up_file" required accept=".pdf,application/pdf">`)}
        <p class="text-xs text-slate-500 bg-slate-50 rounded-xl p-3">Shared as <strong>${esc(App.user.public_username)}</strong> (${esc(App.user.institution)}). Your full name is never shown.</p>
        <div class="flex flex-col-reverse sm:flex-row justify-end gap-2">
          <button type="button" onclick="closeModal()" class="btn btn-ghost">Cancel</button>
          <button type="submit" id="upSubmit" class="btn btn-primary">Upload</button>
        </div>
      </form>`);

    document.getElementById('upForm').onsubmit = async (e) => {
      e.preventDefault();
      const file = document.getElementById('up_file').files[0];
      const title = document.getElementById('up_title').value.trim();
      const cname = document.getElementById('up_cname').value.trim();
      if (!file) return toast('Please choose a PDF file.', 'error');
      if (!file.name.toLowerCase().endsWith('.pdf')) return toast('Only PDF files are allowed — convert your document first.', 'error');
      if (file.size > 20 * 1024 * 1024) return toast('File is larger than 20 MB.', 'error');
      if (!title || !cname) return toast('Title and course name are required.', 'error');

      const fd = new FormData();
      fd.append('file', file); fd.append('title', title);
      fd.append('description', document.getElementById('up_desc').value.trim());
      fd.append('course_name', cname);
      fd.append('course_code', document.getElementById('up_ccode').value.trim());
      fd.append('category', document.getElementById('up_cat').value);

      const btn = document.getElementById('upSubmit');
      btn.disabled = true; btn.textContent = 'Uploading…';
      try { await API.post('/api/resources', fd); closeModal(); toast('Resource uploaded. Thanks for sharing!'); refresh(); }
      catch (err) { toast(err.message, 'error'); btn.disabled = false; btn.textContent = 'Upload'; }
    };
  };

  document.getElementById('uploadBtn').onclick = showUpload;
  if (location.hash.includes('upload=1')) { history.replaceState(null, '', '#/resources'); showUpload(); }
};
