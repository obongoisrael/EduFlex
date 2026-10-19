/**
 * Features page (the grid button in the bottom bar): Go Premium strip, then
 * "Your studies", "Tools" (Plus features marked PRO) and "Account" lists.
 */

/** "SATURDAY, 27 SEPTEMBER" + "Good afternoon, Jane" + search/avatar — shared with Home. */
function greetingHeader() {
  const now = new Date();
  const h = now.getHours();
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return `
    <div class="flex items-start justify-between gap-3 pt-1">
      <div class="min-w-0">
        <div class="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
          ${now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
        </div>
        <h2 class="text-[1.4rem] sm:text-2xl leading-tight font-bold text-slate-900 mt-1">${part}, ${esc(App.user.first_name)}</h2>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <a href="#/resources" class="w-10 h-10 rounded-full bg-white border border-slate-200 grid place-items-center text-slate-600 shadow-sm" aria-label="Search resources">
          <span class="w-5 h-5 block">${icon('search')}</span></a>
        <a href="#/profile" class="lg:hidden w-10 h-10 rounded-full bg-gradient-to-br from-[#4c6aab] to-[#223051] text-white grid place-items-center text-sm font-bold shadow-md shadow-indigo-900/25" aria-label="Profile">
          ${esc(App.user.public_username)}</a>
      </div>
    </div>`;
}

Views.more = async (el) => {
  const plus = App.isPlus();

  const row = (n) => {
    const locked = n.pro && !plus;
    const href = n.route ? `#/${n.route}` : (locked ? '#/premium' : n.plusHref);
    return `
      <a href="${href}" class="row-link">
        ${tintIcon(n.icon || n.route, n.tint)}
        <span class="flex-1 min-w-0">
          <span class="flex items-center gap-2">
            <span class="font-semibold text-slate-800 text-[.95rem] truncate">${esc(n.label)}</span>
            ${locked ? proBadge() : ''}
            ${n.freeTag && !plus ? `<span class="free-badge">${n.freeTag}</span>` : ''}
          </span>
        </span>
        <span class="chev text-slate-300 shrink-0">${icon('chevron')}</span>
      </a>`;
  };

  el.innerHTML = `
    <div class="max-w-2xl mx-auto">
      ${greetingHeader()}
      <div class="mt-5">${plus ? `
        <a href="#/premium" class="card flex items-center gap-3 px-4 py-3.5">
          ${tintIcon('crown', 'gold')}
          <span class="flex-1 min-w-0"><span class="block font-semibold text-slate-800">EduFlex Plus is active</span>
          <span class="block text-xs text-slate-400">${App.user.role === 'admin' ? 'Included with your admin account' : App.user.plan_expires_at ? `Active until ${fmtDate(App.user.plan_expires_at)}` : 'No expiry'}</span></span>
          <span class="chev text-slate-300">${icon('chevron')}</span>
        </a>` : premiumBanner()}</div>

      ${NAV_SECTIONS.map(sec => `
        <h3 class="text-[11px] font-bold tracking-wider text-slate-400 uppercase mt-6 mb-2 px-1">${esc(sec.title)}</h3>
        <div class="card overflow-hidden">${sec.items.filter(navVisible).map(row).join('')}</div>`).join('')}

      <button onclick="App.logout()" class="card w-full row-link mt-4 text-left">
        ${tintIcon('logout', 'rose')}
        <span class="flex-1 font-semibold text-rose-600">Log out</span>
      </button>
    </div>`;
};
