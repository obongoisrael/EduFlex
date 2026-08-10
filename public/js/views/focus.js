/**
 * Focus Mode: Pomodoro timer that also works offline.
 * Timer state lives on Views.focus._timer so it survives in-app navigation.
 */
Views.focus = async (el) => {
  let courses = [], history = [], linkable = [];
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [c, h, t] = await Promise.all([
      API.get('/api/courses'), API.get('/api/focus'),
      API.get(`/api/sessions?from=${today}&to=${today}`),
    ]);
    courses = c.courses; history = h.sessions;
    linkable = t.sessions.filter(s => s.status === 'Planned' || s.status === 'Rescheduled');
  } catch (err) {
    if (err.message === 'Not authenticated') throw err;
    if (!App.offline) throw err; // offline: timer still usable with empty lists
  }

  const T = (Views.focus._timer ||= {
    running: false, phase: 'study', remaining: 25 * 60, focusId: null,
    studyMin: 25, breakMin: 5, elapsedStudySec: 0, interval: null,
    title: '', courseId: null, studySessionId: null, startedAt: null,
  });

  const fmtClock = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  const barPct = () => {
    const total = (T.phase === 'study' ? T.studyMin : T.breakMin) * 60 || 1;
    return Math.round(((total - T.remaining) / total) * 100);
  };

  el.innerHTML = `
    <div class="grid lg:grid-cols-2 gap-4">
      <!-- Timer -->
      <div class="rounded-3xl p-6 sm:p-8 text-center text-white bg-gradient-to-br ${T.phase === 'study' ? 'from-indigo-600 to-violet-700' : 'from-emerald-600 to-teal-700'} shadow-xl shadow-indigo-500/20">
        <div id="phaseLabel" class="text-xs font-bold uppercase tracking-widest text-white/80">
          ${T.phase === 'study' ? '📖 Study time' : '☕ Break time'}
        </div>
        <div id="timerDisplay" class="text-6xl sm:text-7xl font-extrabold tabular-nums my-6 leading-none">${fmtClock(T.remaining)}</div>
        <div class="h-2 bg-white/20 rounded-full overflow-hidden max-w-sm mx-auto">
          <div id="timerBar" class="h-full bg-white rounded-full transition-all" style="width:${barPct()}%"></div>
        </div>
        <div class="flex justify-center gap-3 mt-8" id="timerControls"></div>
        <p id="focusInfo" class="text-xs text-white/70 mt-5">${T.focusId ? esc(T.title) : 'Set up your session, then press Start.'}</p>
      </div>

      <div class="space-y-4">
        <!-- Setup -->
        <div class="card p-5">
          <h3 class="font-bold text-slate-900 mb-4">Session setup</h3>
          <div class="space-y-4">
            ${field('Session title', `<input class="inp" id="fs_title" value="${esc(T.title)}" placeholder="e.g. Revise graph algorithms" ${T.focusId ? 'disabled' : ''}>`)}
            ${field('Course (optional)', `<select class="inp" id="fs_course" ${T.focusId ? 'disabled' : ''}>
              <option value="">— No course —</option>
              ${courses.map(c => `<option value="${c.id}" ${T.courseId === c.id ? 'selected' : ''}>${esc(c.code)} — ${esc(c.title)}</option>`).join('')}
            </select>`)}
            ${field(`Link today's session (optional)`, `<select class="inp" id="fs_link" ${T.focusId ? 'disabled' : ''}>
              <option value="">— None —</option>
              ${linkable.map(s => `<option value="${s.id}" ${T.studySessionId === s.id ? 'selected' : ''}>${esc(s.title)} (${s.start_datetime.slice(11)})</option>`).join('')}
            </select>`)}
            <div class="grid grid-cols-2 gap-3">
              ${field('Study (min)', `<input type="number" min="1" max="240" class="inp" id="fs_study" value="${T.studyMin}" ${T.focusId ? 'disabled' : ''}>`)}
              ${field('Break (min)', `<input type="number" min="0" max="60" class="inp" id="fs_break" value="${T.breakMin}" ${T.focusId ? 'disabled' : ''}>`)}
            </div>
            <div class="flex gap-2">
              ${[[25, 5], [50, 10], [90, 15]].map(([s, b]) =>
                `<button class="preset btn btn-ghost btn-sm flex-1" data-s="${s}" data-b="${b}">${s}/${b}</button>`).join('')}
            </div>
          </div>
        </div>

        <!-- History -->
        <div class="card p-5">
          <h3 class="font-bold text-slate-900 mb-3">Recent focus sessions</h3>
          ${history.length === 0 ? '<p class="text-sm text-slate-400">No focus sessions yet.</p>'
            : history.slice(0, 6).map(f => `
              <div class="flex items-center justify-between gap-3 py-2 border-b border-slate-50 last:border-0 text-sm">
                <div class="min-w-0">
                  <div class="font-medium text-slate-700 truncate">${esc(f.title)}</div>
                  <div class="text-xs text-slate-400">${f.course_code ? esc(f.course_code) + ' · ' : ''}${fmtDate(f.started_at)}</div>
                </div>
                <div class="text-right shrink-0">
                  <div class="font-semibold text-slate-700">${f.completed_duration_minutes}m</div>
                  <div class="text-[11px] ${f.status === 'Completed' ? 'text-emerald-600' : 'text-slate-400'}">${f.status}</div>
                </div>
              </div>`).join('')}
        </div>
      </div>
    </div>`;

  function renderControls() {
    const c = document.getElementById('timerControls');
    if (!c) return;
    const btn = (id, label, cls) => `<button id="${id}" class="btn ${cls}">${label}</button>`;
    if (!T.focusId) {
      c.innerHTML = btn('startBtn', '▶ Start', 'bg-white text-indigo-700 hover:bg-indigo-50 px-8');
      document.getElementById('startBtn').onclick = start;
    } else if (T.running) {
      c.innerHTML = btn('pauseBtn', '⏸ Pause', 'bg-white/20 text-white border-white/30') +
                    btn('endBtn', '⏹ End', 'bg-white text-slate-800');
      document.getElementById('pauseBtn').onclick = pause;
      document.getElementById('endBtn').onclick = end;
    } else {
      c.innerHTML = btn('resumeBtn', '▶ Resume', 'bg-white text-indigo-700') +
                    btn('endBtn', '⏹ End', 'bg-white/20 text-white border-white/30');
      document.getElementById('resumeBtn').onclick = resume;
      document.getElementById('endBtn').onclick = end;
    }
  }

  function paint() {
    const disp = document.getElementById('timerDisplay');
    if (!disp) { clearInterval(T.interval); T.interval = null; return; }
    disp.textContent = fmtClock(T.remaining);
    document.getElementById('timerBar').style.width = `${barPct()}%`;
    document.getElementById('phaseLabel').textContent = T.phase === 'study' ? '📖 Study time' : '☕ Break time';
  }

  function tick() {
    if (!T.running) return;
    T.remaining--;
    if (T.phase === 'study') T.elapsedStudySec++;
    if (T.remaining <= 0) {
      if (T.phase === 'study') {
        T.phase = 'break'; T.remaining = T.breakMin * 60;
        toast('Study block done — take a break! ☕', 'info');
        if (T.breakMin === 0) { T.phase = 'study'; T.remaining = T.studyMin * 60; }
      } else {
        T.phase = 'study'; T.remaining = T.studyMin * 60;
        toast('Break over — back to studying! 📖', 'info');
      }
      Views.focus(el); return; // re-render to swap the gradient
    }
    paint();
  }

  async function start() {
    T.title = document.getElementById('fs_title').value.trim() || 'Focus session';
    T.courseId = Number(document.getElementById('fs_course').value) || null;
    T.studySessionId = Number(document.getElementById('fs_link').value) || null;
    T.studyMin = Math.max(1, Math.min(240, Number(document.getElementById('fs_study').value) || 25));
    T.breakMin = Math.max(0, Math.min(60, Number(document.getElementById('fs_break').value) || 5));
    T.startedAt = new Date().toISOString();

    if (App.offline) {
      T.focusId = `offline-${Date.now()}`;
      T.phase = 'study'; T.remaining = T.studyMin * 60; T.elapsedStudySec = 0; T.running = true;
      if (!T.interval) T.interval = setInterval(tick, 1000);
      toast('Offline session started — syncs when you reconnect. 📡', 'info');
      Views.focus(el); return;
    }
    try {
      const r = await API.post('/api/focus', {
        title: T.title, course_id: T.courseId, study_session_id: T.studySessionId,
        study_duration_minutes: T.studyMin, break_duration_minutes: T.breakMin,
      });
      T.focusId = r.id;
      T.phase = 'study'; T.remaining = T.studyMin * 60; T.elapsedStudySec = 0; T.running = true;
      if (!T.interval) T.interval = setInterval(tick, 1000);
      toast('Focus session started. Good luck! 🎯');
      Views.focus(el);
    } catch (err) { toast(err.message, 'error'); }
  }

  function pause() { T.running = false; renderControls(); }
  function resume() { T.running = true; renderControls(); }

  async function end() {
    T.running = false;
    clearInterval(T.interval); T.interval = null;
    const minutes = Math.round(T.elapsedStudySec / 60);
    const linked = T.studySessionId;

    if (App.offline || String(T.focusId).startsWith('offline-')) {
      const queue = JSON.parse(localStorage.getItem('ef_focus_queue') || '[]');
      queue.push({
        title: T.title, course_id: T.courseId,
        study_duration_minutes: T.studyMin, break_duration_minutes: T.breakMin,
        completed_duration_minutes: minutes,
        started_at: T.startedAt || new Date().toISOString(), completed_at: new Date().toISOString(),
      });
      localStorage.setItem('ef_focus_queue', JSON.stringify(queue));
      Object.assign(T, { focusId: null, phase: 'study', remaining: (T.studyMin || 25) * 60, elapsedStudySec: 0, studySessionId: null });
      toast(`Saved offline — ${minutes} min will sync later. 📡`, 'info');
      if (!App.offline) App.syncFocusQueue();
      Views.focus(el); return;
    }

    const finish = async (markCompleted) => {
      try {
        await API.patch(`/api/focus/${T.focusId}`, {
          completed_duration_minutes: minutes, status: 'Completed', mark_study_session_completed: markCompleted,
        });
        Object.assign(T, { focusId: null, phase: 'study', remaining: (T.studyMin || 25) * 60, elapsedStudySec: 0, studySessionId: null });
        closeModal();
        toast(`Saved — ${minutes} study minute${minutes === 1 ? '' : 's'} logged. 💪`);
        Views.focus(el);
      } catch (err) { toast(err.message, 'error'); }
    };

    if (linked) {
      openModal('End focus session', `
        <p class="text-sm text-slate-600">You studied for <strong>${minutes} minute${minutes === 1 ? '' : 's'}</strong>. Mark the linked study session complete too?</p>
        <div class="flex flex-col-reverse sm:flex-row justify-end gap-2 mt-6">
          <button id="efNo" class="btn btn-ghost">Just save</button>
          <button id="efYes" class="btn btn-success">Save &amp; complete</button>
        </div>`);
      document.getElementById('efNo').onclick = () => finish(false);
      document.getElementById('efYes').onclick = () => finish(true);
    } else finish(false);
  }

  el.querySelectorAll('.preset').forEach(b => b.onclick = () => {
    if (T.focusId) return;
    document.getElementById('fs_study').value = b.dataset.s;
    document.getElementById('fs_break').value = b.dataset.b;
  });

  renderControls();
  if (T.focusId && !T.interval) T.interval = setInterval(tick, 1000);

  // Roadmap integration: "Start focus session" prefills this form
  if (!T.focusId) {
    try {
      const pre = JSON.parse(localStorage.getItem('ef_focus_prefill') || 'null');
      if (pre) {
        localStorage.removeItem('ef_focus_prefill');
        document.getElementById('fs_title').value = pre.title || '';
        if (pre.course_id) document.getElementById('fs_course').value = String(pre.course_id);
        toast('Prefilled from your roadmap topic — press Start. 🗺️', 'info');
      }
    } catch { /* ignore */ }
  }
};
