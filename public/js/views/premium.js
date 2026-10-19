/**
 * EduFlex Plus page: what's free, what Plus adds, plans, and subscription status.
 * Payments are not connected yet — until then an admin activates Plus
 * (Admin → Users → Grant Plus).
 */
Views.premium = async (el) => {
  const u = App.user;
  const plus = App.isPlus();
  const state = (Views.premium._state ||= { plan: 'semester' });

  const FREE = ['Courses, deadlines & exams', 'Free-time planner', 'Auto-generated study schedule', 'Calendar',
    'Focus timer (Pomodoro)', 'Shared resource library', 'Peer study matching', '1 learning roadmap'];

  el.innerHTML = `
    <div class="max-w-2xl mx-auto">
      <div class="rounded-[1.75rem] p-6 text-white text-center bg-gradient-to-br from-[#223051] via-[#2f4579] to-[#4c6aab] shadow-xl shadow-indigo-900/25 relative overflow-hidden">
        <div class="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/10"></div>
        <div class="absolute -bottom-12 -left-8 w-36 h-36 rounded-full bg-white/10"></div>
        <div class="relative">
          <div class="w-16 h-16 mx-auto rounded-2xl grid place-items-center bg-white/20 text-amber-300 [&_svg]:w-8 [&_svg]:h-8">${icon('crown')}</div>
          <h2 class="text-2xl font-extrabold mt-4">EduFlex Plus</h2>
          <p class="text-indigo-100 text-sm mt-1.5">Your personal study coach — know what to study, when, and why.</p>
          ${plus ? `<div class="inline-flex items-center gap-2 mt-4 bg-white/20 rounded-full px-4 py-1.5 text-sm font-semibold">
              <span class="w-4 h-4 block">${icon('check')}</span>
              ${u.role === 'admin' ? 'Included with your admin account' : u.plan_expires_at ? `Active until ${fmtDate(u.plan_expires_at)}` : 'Active'}
            </div>` : ''}
        </div>
      </div>

      <h3 class="text-[11px] font-bold tracking-wider text-slate-400 uppercase mt-6 mb-2 px-1">What Plus unlocks</h3>
      <div class="card overflow-hidden">
        ${PLUS_FEATURES.map(([ic, t, d]) => `
          <div class="row-link">
            ${tintIcon(ic, 'sky')}
            <span class="flex-1 min-w-0">
              <span class="block font-semibold text-slate-800 text-sm">${esc(t)}</span>
            </span>
            ${plus ? `<span class="w-5 h-5 text-emerald-500 shrink-0">${icon('check')}</span>` : proBadge()}
          </div>`).join('')}
      </div>

      ${plus ? '' : `
        <h3 class="text-[11px] font-bold tracking-wider text-slate-400 uppercase mt-6 mb-2 px-1">Choose a plan</h3>
        <div class="grid grid-cols-2 gap-3">
          ${PLANS.map(p => `
            <button type="button" data-plan="${p.id}" class="card p-4 text-left relative transition ${state.plan === p.id ? '!border-indigo-500 ring-2 ring-indigo-500/30' : ''}">
              ${p.best ? '<span class="absolute -top-2.5 right-3 text-[10px] font-bold bg-amber-400 text-amber-950 rounded-full px-2 py-0.5">BEST VALUE</span>' : ''}
              <span class="block text-xs font-semibold text-slate-500">${esc(p.name)}</span>
              <span class="block text-xl font-extrabold text-slate-900 mt-1">${esc(p.price)}</span>
              <span class="block text-[11px] text-slate-400">${esc(p.per)}</span>
              ${p.note ? `<span class="inline-block mt-2 text-[10px] font-bold text-emerald-700 bg-emerald-50 rounded-md px-1.5 py-0.5">${esc(p.note)}</span>` : ''}
            </button>`).join('')}
        </div>
        <button id="payBtn" class="btn btn-primary btn-block !py-4 !text-base !rounded-2xl mt-4">Continue with M-Pesa</button>
        <p class="text-[11px] text-slate-400 text-center mt-2">Cancel anytime. Prices in Kenya Shillings.</p>`}

      <h3 class="text-[11px] font-bold tracking-wider text-slate-400 uppercase mt-6 mb-2 px-1">Free forever</h3>
      <div class="card p-4 grid sm:grid-cols-2 gap-x-4 gap-y-2.5">
        ${FREE.map(f => `<div class="flex items-center gap-2 text-sm text-slate-600">
          <span class="w-4 h-4 text-emerald-500 shrink-0">${icon('check')}</span>${esc(f)}</div>`).join('')}
      </div>
    </div>`;

  el.querySelectorAll('[data-plan]').forEach(b => b.onclick = () => { state.plan = b.dataset.plan; Views.premium(el); });
  const pay = document.getElementById('payBtn');
  if (pay) pay.onclick = () => {
    const p = PLANS.find(x => x.id === state.plan);
    openModal('Almost there', `
      <p class="text-sm text-slate-600 leading-relaxed">
        M-Pesa checkout for the <strong>${esc(p.name)}</strong> plan (${esc(p.price)} ${esc(p.per)}) is launching soon.
      </p>
      <p class="text-sm text-slate-600 leading-relaxed mt-3">
        Until then, ask your EduFlex administrator to activate Plus on your account
        (<strong>${esc(u.email)}</strong>).
      </p>
      <button class="btn btn-primary btn-block mt-6" onclick="closeModal()">Got it</button>`);
  };
};
