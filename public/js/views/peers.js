/**
 * Peer Study: opt-in matching, suggested peers, study requests, study groups.
 * Privacy: only initials + institution are ever shown.
 */
Views.peers = async (el) => {
  const [{ enabled }, matchData, reqData, { groups }] = await Promise.all([
    API.get('/api/peers/preferences'),
    API.get('/api/peers/matches'),
    API.get('/api/peers/requests'),
    API.get('/api/peers/groups'),
  ]);

  el.innerHTML = `
    <div class="card p-5 flex flex-wrap items-center justify-between gap-4">
      <div class="min-w-0">
        <h3 class="font-bold text-slate-900">Allow Peer Study Matching</h3>
        <p class="text-xs text-slate-500 mt-1 max-w-lg leading-relaxed">
          When enabled, students with similar courses can see your <strong>initials (${esc(App.user.public_username)})</strong>
          and institution — never your full name or email. Turn it off anytime.
        </p>
      </div>
      <button id="peerToggle" class="btn ${enabled ? 'btn-success' : 'btn-ghost'} shrink-0">
        ${enabled ? '✓ Enabled' : 'Enable matching'}
      </button>
    </div>

    ${!enabled ? `<div class="mt-4">${emptyState('🤝', 'Peer matching is off',
        'Enable it above to discover students studying the same courses as you.')}</div>` : `

      <section class="mt-6">
        <h3 class="font-bold text-slate-900 mb-3">Suggested study partners</h3>
        ${matchData.matches.length === 0
          ? emptyState('🔍', 'No matches yet', 'Matches appear when other opted-in students share your courses or roadmap subjects.')
          : `<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              ${matchData.matches.map((m, i) => `
                <div class="card p-5">
                  <div class="flex items-center gap-3">
                    <span class="w-11 h-11 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white grid place-items-center font-bold shrink-0">${esc(m.public_username)}</span>
                    <div class="min-w-0">
                      <div class="font-semibold text-slate-900 text-sm">${esc(m.public_username)}</div>
                      <div class="text-xs text-slate-400 truncate">${esc(m.institution)}</div>
                    </div>
                  </div>
                  <div class="text-xs text-slate-500 mt-3 space-y-1">
                    <div>📘 ${m.shared_courses.map(esc).join('; ')}</div>
                    ${m.common_slot ? `<div>🕒 ${esc(m.common_slot)}</div>` : ''}
                    <div class="text-slate-400">${esc(m.match_reason)}</div>
                  </div>
                  <button data-request="${i}" class="btn btn-primary btn-sm btn-block mt-4">📨 Send study request</button>
                </div>`).join('')}
            </div>`}
      </section>

      <section class="mt-6 grid lg:grid-cols-2 gap-4">
        <div class="card p-5">
          <h3 class="font-bold text-slate-900 text-sm mb-3">📥 Incoming requests</h3>
          ${reqData.incoming.length === 0 ? '<p class="text-sm text-slate-400 py-4 text-center">No incoming requests.</p>'
            : reqData.incoming.map(r => `
              <div class="py-3 border-b border-slate-50 last:border-0">
                <div class="flex items-center justify-between gap-2">
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white grid place-items-center text-[11px] font-bold shrink-0">${esc(r.public_username)}</span>
                    <div class="min-w-0">
                      <div class="text-sm font-medium text-slate-800 truncate">${esc(r.public_username)} · ${esc(r.institution)}</div>
                      <div class="text-xs text-slate-400 truncate">${r.course_name ? esc(r.course_name) + ' · ' : ''}${esc(r.message || 'Wants to study together')}</div>
                    </div>
                  </div>
                  ${r.status === 'Pending' ? `<span class="flex gap-1.5 shrink-0">
                      <button data-req-accept="${r.id}" class="btn btn-success btn-sm !px-3">Accept</button>
                      <button data-req-decline="${r.id}" class="btn btn-ghost btn-sm !px-3">Decline</button>
                    </span>`
                    : badge(r.status, r.status === 'Accepted' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500')}
                </div>
              </div>`).join('')}
        </div>

        <div class="card p-5">
          <h3 class="font-bold text-slate-900 text-sm mb-3">📤 Sent requests</h3>
          ${reqData.sent.length === 0 ? '<p class="text-sm text-slate-400 py-4 text-center">No requests sent yet.</p>'
            : reqData.sent.map(r => `
              <div class="py-3 border-b border-slate-50 last:border-0 flex items-center justify-between gap-2">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="w-9 h-9 rounded-full bg-slate-400 text-white grid place-items-center text-[11px] font-bold shrink-0">${esc(r.public_username)}</span>
                  <div class="min-w-0">
                    <div class="text-sm font-medium text-slate-800 truncate">To ${esc(r.public_username)} · ${esc(r.institution)}</div>
                    <div class="text-xs text-slate-400">${fmtDate(r.created_at)}</div>
                  </div>
                </div>
                ${badge(r.status, r.status === 'Accepted' ? 'bg-emerald-100 text-emerald-700' : r.status === 'Declined' ? 'bg-rose-100 text-rose-600' : 'bg-amber-100 text-amber-700')}
              </div>`).join('')}
        </div>
      </section>

      <section class="mt-6">
        <div class="flex items-center justify-between gap-3 mb-3">
          <h3 class="font-bold text-slate-900">👥 Study groups</h3>
          <button id="newGroupBtn" class="btn btn-primary btn-sm">+ Create</button>
        </div>
        ${groups.length === 0
          ? emptyState('👥', 'No study groups yet', 'Create the first study group for one of your courses.')
          : `<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              ${groups.map(g => `
                <div class="card p-5">
                  <div class="flex items-start justify-between gap-2">
                    <h4 class="font-semibold text-slate-900 text-sm leading-snug">${esc(g.name)}</h4>
                    ${badge(`${g.member_count}`, 'bg-indigo-50 text-indigo-700')}
                  </div>
                  <div class="text-xs text-slate-500 mt-2 space-y-0.5">
                    ${g.course_name ? `<div class="truncate">📘 ${esc(g.course_name)}</div>` : ''}
                    <div class="truncate">🏛️ ${esc(g.institution)}</div>
                  </div>
                  <div class="flex flex-wrap gap-1.5 mt-3">
                    ${g.members.map(m => `<span title="${esc(m.institution)}" class="w-7 h-7 rounded-full ${m.role === 'owner' ? 'bg-indigo-600' : 'bg-slate-400'} text-white grid place-items-center text-[10px] font-bold">${esc(m.public_username)}</span>`).join('')}
                  </div>
                  <button data-group="${g.id}" data-member="${g.is_member ? 1 : 0}"
                    class="btn btn-sm btn-block mt-4 ${g.is_member ? 'border border-rose-200 text-rose-600 bg-white' : 'btn-primary'}">
                    ${g.is_member ? 'Leave group' : 'Join group'}
                  </button>
                </div>`).join('')}
            </div>`}
      </section>`}`;

  document.getElementById('peerToggle').onclick = async () => {
    try {
      await API.put('/api/peers/preferences', { enabled: !enabled });
      App.user.peer_matching_enabled = !enabled;
      toast(!enabled ? 'Peer matching enabled — you appear as initials only.' : 'Peer matching disabled.');
      Views.peers(el);
    } catch (err) { toast(err.message, 'error'); }
  };

  el.querySelectorAll('[data-request]').forEach(b => b.onclick = () => {
    const m = matchData.matches[Number(b.dataset.request)];
    openModal(`Study request to ${m.public_username}`, `
      <form id="reqForm" class="space-y-4">
        ${field('Course (optional)', `<input class="inp" id="rq_course" value="${esc((m.shared_courses[0] || '').split(' — ')[1] || '')}">`)}
        ${field('Message', `<textarea class="inp" id="rq_msg" rows="3" placeholder="Hi! Want to revise together before the CAT?"></textarea>`)}
        <p class="text-xs text-slate-500 bg-slate-50 rounded-xl p-3">🔒 They see only your initials (${esc(App.user.public_username)}) and institution.</p>
        <div class="flex flex-col-reverse sm:flex-row justify-end gap-2">
          <button type="button" onclick="closeModal()" class="btn btn-ghost">Cancel</button>
          <button type="submit" class="btn btn-primary">Send request</button>
        </div>
      </form>`);
    document.getElementById('reqForm').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await API.post('/api/peers/requests', {
          receiver_user_id: m.user_id,
          course_name: document.getElementById('rq_course').value.trim(),
          message: document.getElementById('rq_msg').value.trim(),
        });
        closeModal(); toast('Study request sent. 📨'); Views.peers(el);
      } catch (err) { toast(err.message, 'error'); }
    };
  });

  el.querySelectorAll('[data-req-accept]').forEach(b => b.onclick = async () => {
    try { await API.patch(`/api/peers/requests/${b.dataset.reqAccept}`, { status: 'Accepted' }); toast('Request accepted! 🎉'); Views.peers(el); }
    catch (err) { toast(err.message, 'error'); }
  });
  el.querySelectorAll('[data-req-decline]').forEach(b => b.onclick = async () => {
    try { await API.patch(`/api/peers/requests/${b.dataset.reqDecline}`, { status: 'Declined' }); toast('Request declined.', 'info'); Views.peers(el); }
    catch (err) { toast(err.message, 'error'); }
  });

  const newGroupBtn = document.getElementById('newGroupBtn');
  if (newGroupBtn) newGroupBtn.onclick = () => {
    openModal('Create study group', `
      <form id="groupForm" class="space-y-4">
        ${field('Group name', `<input class="inp" id="gr_name" required placeholder="e.g. CSC 224 Revision Squad">`)}
        ${field('Course (optional)', `<input class="inp" id="gr_course" placeholder="e.g. Database Systems">`)}
        <div class="flex flex-col-reverse sm:flex-row justify-end gap-2">
          <button type="button" onclick="closeModal()" class="btn btn-ghost">Cancel</button>
          <button type="submit" class="btn btn-primary">Create</button>
        </div>
      </form>`);
    document.getElementById('groupForm').onsubmit = async (e) => {
      e.preventDefault();
      const name = document.getElementById('gr_name').value.trim();
      if (!name) return toast('Group name is required.', 'error');
      try {
        await API.post('/api/peers/groups', { name, course_name: document.getElementById('gr_course').value.trim() });
        closeModal(); toast('Study group created. 👥'); Views.peers(el);
      } catch (err) { toast(err.message, 'error'); }
    };
  };

  el.querySelectorAll('[data-group]').forEach(b => b.onclick = async () => {
    const isMember = b.dataset.member === '1';
    try {
      await API.post(`/api/peers/groups/${b.dataset.group}/${isMember ? 'leave' : 'join'}`);
      toast(isMember ? 'You left the group.' : 'Welcome to the group! 👥');
      Views.peers(el);
    } catch (err) { toast(err.message, 'error'); }
  });
};
