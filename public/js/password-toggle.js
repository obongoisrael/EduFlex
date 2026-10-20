/**
 * Show/hide button for every password field (login, sign-up, reset, profile).
 * Works on fields added later too (the app renders pages dynamically).
 */
(() => {
  const SVG = (paths) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const EYE = SVG('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>');
  const EYE_OFF = SVG('<path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.3 3.3M6.6 6.6C3.8 8.3 2 12 2 12s3.5 7 10 7c1.9 0 3.6-.6 5-1.5"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M2 2l20 20"/>');

  function enhance(input) {
    if (input.dataset.pwToggle) return;
    input.dataset.pwToggle = '1';

    const wrap = document.createElement('div');
    wrap.style.position = 'relative';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    input.style.paddingRight = '3rem';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = EYE;
    btn.setAttribute('aria-label', 'Show password');
    btn.title = 'Show password';
    Object.assign(btn.style, {
      position: 'absolute', right: '.35rem', top: '50%', transform: 'translateY(-50%)',
      width: '2.5rem', height: '2.5rem', display: 'grid', placeItems: 'center',
      color: '#64748b', background: 'transparent', border: '0', borderRadius: '.75rem', cursor: 'pointer',
    });
    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.innerHTML = show ? EYE_OFF : EYE;
      const label = show ? 'Hide password' : 'Show password';
      btn.setAttribute('aria-label', label);
      btn.title = label;
      input.focus({ preventScroll: true });
    });
    wrap.appendChild(btn);
  }

  const scan = (root) => root.querySelectorAll && root.querySelectorAll('input[type="password"]').forEach(enhance);
  const start = () => {
    scan(document);
    new MutationObserver((muts) => muts.forEach(m => m.addedNodes.forEach(n => n.nodeType === 1 && (n.matches?.('input[type="password"]') ? enhance(n) : scan(n)))))
      .observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
