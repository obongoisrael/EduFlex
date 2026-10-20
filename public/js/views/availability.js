/** Availability: one-click presets + weekly slot grid + CRUD. */
Views.availability = async (el) => {
  const { slots } = await API.get('/api/availability');
  const dayOrder = [1, 2, 3, 4, 5, 6, 0];
  const INT_CLS = {
    'Deep Focus': 'bg-violet-50 text-violet-700 border-violet-200',
    'Normal': 'bg-indigo-50 text-indigo-700 border-indigo-200',
    'Light': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  };

  el.innerHTML = `
    <div class="flex items-center justify-between gap-3 mb-4">
      <p class="text-sm text-slate-500">When are you free to study?</p>
      <button id="addBtn" class="btn btn-primary btn-sm">+ Add Slot</button>
    </div>

    <div class="card p-4 mb-4">
      <div class="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Quick presets</div>
      <div class="grid sm:grid-cols-3 gap-3">
        ${AVAIL_PRESETS.map((p, i) => `
          <button data-preset="${i}" class="border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/50 rounded-2xl p-4 text-left transition active:scale-[.98]">
            <div class="flex items-center gap-2"><span class="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 grid place-items-center shrink-0 [&_svg]:w-5 [&_svg]:h-5">${icon(p.icon)}</span>
            <span class="text-sm font-semibold text-slate-800">${p.name}</span></div>
            <div class="text-xs text-slate-400 mt-1">${p.desc}</div>
          </button>`).join('')}
      </div>
    </div>

    ${slots.length === 0
      ? emptyState('availability', 'No availability yet', 'Pick a preset above or add your free study times manually.',
          `<button onclick="document.getElementById('addBtn').click()" class="btn btn-primary">Add your first slot</button>`)
      : `<div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          ${dayOrder.map(day => {
            const daySlots = slots.filter(s => s.day_of_week === day);
            return `<div class="card p-4 ${daySlots.length === 0 ? 'opacity-60' : ''}">
              <h3 class="font-bold text-slate-800 text-sm mb-3">${DAYS[day]}</h3>
              ${daySlots.length === 0 ? '<p class="text-xs text-slate-300">Not available</p>'
                : daySlots.map(s => `
                  <div class="border ${INT_CLS[s.study_intensity]} rounded-xl px-3 py-2.5 mb-2 last:mb-0">
                    <div class="flex items-center justify-between gap-2">
                      <span class="text-sm font-semibold">${s.start_time} – ${s.end_time}</span>
                      <span class="flex gap-2 shrink-0">
                        <button data-edit="${s.id}" class="opacity-60 hover:opacity-100 text-sm">✎</button>
                        <button data-del="${s.id}" class="opacity-60 hover:opacity-100 text-rose-500 p-1 [&_svg]:w-4 [&_svg]:h-4" title="Delete" aria-label="Delete">${icon('trash')}</button>
                      </span>
                    </div>
                    <div class="text-[11px] mt-0.5">${esc(s.study_intensity)}</div>
                  </div>`).join('')}
            </div>`;
          }).join('')}
        </div>`}`;

  const showForm = (slot = null) => {
    openModal(slot ? 'Edit Slot' : 'Add Availability Slot', `
      <form id="slotForm" class="space-y-4">
        ${field('Day of the week', `<select class="inp" id="sf_day">
          ${dayOrder.map(dd => `<option value="${dd}" ${slot?.day_of_week === dd ? 'selected' : ''}>${DAYS[dd]}</option>`).join('')}
        </select>`)}
        <div class="grid grid-cols-2 gap-3">
          ${field('Start time', `<input type="time" class="inp" id="sf_start" required value="${slot?.start_time || '19:00'}">`)}
          ${field('End time', `<input type="time" class="inp" id="sf_end" required value="${slot?.end_time || '21:00'}">`)}
        </div>
        ${field('Study intensity', `<select class="inp" id="sf_int">
          ${['Light', 'Normal', 'Deep Focus'].map(i => `<option ${(slot?.study_intensity || 'Normal') === i ? 'selected' : ''}>${i}</option>`).join('')}
        </select>`)}
        <div class="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2">
          <button type="button" onclick="closeModal()" class="btn btn-ghost">Cancel</button>
          <button type="submit" class="btn btn-primary">${slot ? 'Save changes' : 'Add slot'}</button>
        </div>
      </form>`);

    document.getElementById('slotForm').onsubmit = async (e) => {
      e.preventDefault();
      const body = {
        day_of_week: Number(document.getElementById('sf_day').value),
        start_time: document.getElementById('sf_start').value,
        end_time: document.getElementById('sf_end').value,
        study_intensity: document.getElementById('sf_int').value,
      };
      if (body.end_time <= body.start_time) return toast('End time must be after start time.', 'error');
      try {
        if (slot) await API.put(`/api/availability/${slot.id}`, body);
        else await API.post('/api/availability', body);
        closeModal();
        toast(slot ? 'Slot updated.' : 'Slot added.');
        autoRegenerate();
        Views.availability(el);
      } catch (err) { toast(err.message, 'error'); }
    };
  };

  document.getElementById('addBtn').onclick = () => showForm();
  el.querySelectorAll('[data-preset]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    try {
      await applyAvailPreset(AVAIL_PRESETS[Number(b.dataset.preset)]);
      toast('Preset slots added.');
      autoRegenerate();
      Views.availability(el);
    } catch (err) { toast(err.message, 'error'); b.disabled = false; }
  });
  el.querySelectorAll('[data-edit]').forEach(b =>
    b.onclick = () => showForm(slots.find(s => s.id === Number(b.dataset.edit))));
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!await confirmModal('Delete this availability slot?')) return;
    try { await API.del(`/api/availability/${b.dataset.del}`); toast('Slot deleted.'); Views.availability(el); }
    catch (err) { toast(err.message, 'error'); }
  });

  if (location.hash.includes('add=1')) { history.replaceState(null, '', '#/availability'); showForm(); }
};
