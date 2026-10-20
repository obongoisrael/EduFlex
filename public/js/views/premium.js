/**
 * EduFlex Plus page: what Plus adds (and what stays free), plans, how to get it,
 * and subscription status. Payments are not connected yet — until then an admin
 * activates Plus (Admin → Users → Grant Plus).
 */
Views.premium = async (el) => {
  const u = App.user;
  const plus = App.isPlus();
  const state = (Views.premium._state ||= { plan: 'semester' });

  // Free vs Plus — limits must match the server (FREE_ROADMAPS, AI_LIMITS, requirePlus routes)
  const YES = `<span class="inline-block w-5 h-5 text-emerald-500 [&_svg]:w-5 [&_svg]:h-5">${icon('check')}</span>`;
  const NO = '<span class="text-slate-300">—</span>';
  const COMPARE = [
    ['Courses, deadlines, exams and free time', YES, YES],
    ['Auto-generated study schedule and calendar', YES, YES],
    ['Focus timer', YES, YES],
    ['Resource library: browse, upload and download', YES, YES],
    ['Peer study matching and groups', YES, YES],
    ['Learning roadmaps', '1', 'Unlimited'],
    ['AI-built roadmaps per month', '3', '30'],
    ['Smart Insights', NO, YES],
    ['Smart recommendations', NO, YES],
    ['Missed-session recovery', NO, YES],
    ['Reminders', 'In-app', 'In-app, sound and notifications'],
    ['Offline mode', NO, YES],
    ['Library quality filters', NO, YES],
  ];

  const section = (title) => `<h3 class="text-[11px] font-bold tracking-wider text-slate-400 uppercase mt-7 mb-2 px-1">${title}</h3>`;
  const statusText = u.role === 'admin' ? 'Included with your admin account'
    : u.plan_expires_at ? `Active until ${fmtDate(u.plan_expires_at)}` : 'Active';

  el.innerHTML = `
    <div class="max-w-2xl mx-auto">
      <div class="rounded-[1.75rem] p-6 text-white text-center bg-gradient-to-br from-[#223051] via-[#2f4579] to-[#4c6aab] shadow-xl shadow-indigo-900/25 relative overflow-hidden">
        <div class="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/10"></div>
        <div class="absolute -bottom-12 -left-8 w-36 h-36 rounded-full bg-white/10"></div>
        <div class="relative">
          <div class="w-16 h-16 mx-auto rounded-2xl grid place-items-center bg-white/20 text-amber-300 [&_svg]:w-8 [&_svg]:h-8">${icon('crown')}</div>
          <h2 class="text-2xl font-extrabold mt-4">EduFlex Plus</h2>
          <p class="text-indigo-100 text-sm mt-1.5">Know what to study, when, and why — and never lose track of a missed session.</p>
          ${plus ? `<div class="inline-flex items-center gap-2 mt-4 bg-white/20 rounded-full px-4 py-1.5 text-sm font-semibold">
              <span class="w-4 h-4 block">${icon('check')}</span>${esc(statusText)}
            </div>` : `<div class="mt-4 text-sm text-indigo-100">From <strong class="text-white">${esc(PLANS[0].price)}</strong> a month</div>`}
        </div>
      </div>

      ${section(plus ? 'Your Plus features' : 'What you get with Plus')}
      <div class="card overflow-hidden">
        ${PLUS_FEATURES.map(([ic, title, desc, href]) => `
          <${plus ? `a href="${href}"` : 'div'} class="row-link !items-start">
            ${tintIcon(ic, 'sky')}
            <span class="flex-1 min-w-0">
              <span class="block font-semibold text-slate-800 text-sm">${esc(title)}</span>
              <span class="block text-xs text-slate-500 mt-0.5 leading-relaxed">${esc(desc)}</span>
            </span>
            ${plus ? `<span class="chev text-slate-300 shrink-0 self-center">${icon('chevron')}</span>` : ''}
          </${plus ? 'a' : 'div'}>`).join('')}
      </div>

      ${section('Free vs Plus')}
      <div class="card overflow-hidden">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-400">
              <th class="text-left font-bold px-4 py-2.5">Feature</th>
              <th class="font-bold px-2 py-2.5 w-16">Free</th>
              <th class="font-bold px-2 py-2.5 w-24 text-amber-600">Plus</th>
            </tr>
          </thead>
          <tbody>
            ${COMPARE.map(([f, free, pro]) => `
              <tr class="border-t border-slate-100">
                <td class="px-4 py-2.5 text-slate-700">${esc(f)}</td>
                <td class="px-2 py-2.5 text-center text-slate-500 text-xs">${free}</td>
                <td class="px-2 py-2.5 text-center font-semibold text-slate-800 text-xs">${pro}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>

      ${plus ? '' : `
        ${section('Choose a plan')}
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
        <button id="payBtn" class="btn btn-primary btn-block !py-4 !text-base !rounded-2xl mt-4">Get Plus</button>
        <p class="text-[11px] text-slate-400 text-center mt-2">Prices in Kenya Shillings. No automatic renewal.</p>`}

      ${section('Good to know')}
      <div class="card divide-y divide-slate-100 text-sm">
        ${[
          ['How do I pay?', 'M-Pesa checkout is coming soon. Until then, EduFlex activates Plus on your account for you: tap Get Plus to see how.'],
          ['Does it renew automatically?', 'No. Plus runs for the period you choose and nothing is charged automatically when it ends.'],
          ['What happens when Plus ends?', 'You keep everything: courses, deadlines, schedule, roadmaps and uploads. Plus features simply lock again, and new roadmaps follow the free limit.'],
          ['Is my data private?', 'Other students only ever see your initials and institution. See the <a href="/privacy.html" class="text-indigo-600 font-semibold hover:underline">Privacy Policy</a>.'],
        ].map(([q, a]) => `
          <details class="group px-4 py-3">
            <summary class="font-semibold text-slate-800 cursor-pointer list-none flex items-center justify-between gap-3">
              ${q}<span class="text-slate-300 transition group-open:rotate-90 [&_svg]:w-4 [&_svg]:h-4">${icon('chevron')}</span>
            </summary>
            <p class="text-slate-500 mt-2 leading-relaxed">${a}</p>
          </details>`).join('')}
      </div>
    </div>`;

  el.querySelectorAll('[data-plan]').forEach(b => b.onclick = () => { state.plan = b.dataset.plan; Views.premium(el); });
  const pay = document.getElementById('payBtn');
  if (pay) pay.onclick = () => {
    const p = PLANS.find(x => x.id === state.plan);
    openModal('Get EduFlex Plus', `
      <p class="text-sm text-slate-600 leading-relaxed">
        You chose the <strong>${esc(p.name)}</strong> plan: <strong>${esc(p.price)}</strong> ${esc(p.per)}.
      </p>
      <p class="text-sm text-slate-600 leading-relaxed mt-3">
        M-Pesa checkout is coming soon. For now, EduFlex activates Plus for you: send us a request and we'll
        reply with how to pay. Your account email (<strong>${esc(u.email)}</strong>) and plan are filled in for you.
      </p>
      <a class="btn btn-primary btn-block mt-6" onclick="closeModal()"
         href="mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`EduFlex Plus request: ${p.name} plan`)}&body=${encodeURIComponent(
           `Hi EduFlex team,\n\nPlease activate EduFlex Plus on my account.\n\nAccount email: ${u.email}\nPlan: ${p.name} (${p.price} ${p.per})\n\nThank you.`)}">Request Plus by email</a>
      <button class="btn btn-ghost btn-block mt-2" onclick="closeModal()">Not now</button>`);
  };
};
