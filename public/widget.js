/*! OrderHogaya chat widget — add to any website:
 * <script src="https://YOUR-APP-DOMAIN/widget.js" data-business="your-business-slug" data-color="#4f46e5" async></script>
 */
(function () {
  var s = document.currentScript || document.querySelector('script[data-business]');
  if (!s || window.__salesPilotLoaded) return;
  window.__salesPilotLoaded = true;
  var slug = s.getAttribute('data-business');
  var color = s.getAttribute('data-color') || '#4f46e5';
  var side = s.getAttribute('data-position') === 'left' ? 'left' : 'right';
  var base = new URL(s.src).origin;
  if (!slug) { console.warn('OrderHogaya: data-business is missing'); return; }

  var btn = document.createElement('button');
  btn.setAttribute('aria-label', 'Open chat');
  btn.style.cssText = 'position:fixed;bottom:20px;' + side + ':20px;width:60px;height:60px;border-radius:50%;border:0;cursor:pointer;z-index:2147483646;box-shadow:0 6px 24px rgba(0,0,0,.25);background:' + color + ';display:flex;align-items:center;justify-content:center;transition:transform .15s';
  var chatIcon = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var closeIcon = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
  btn.innerHTML = chatIcon;

  var frame = document.createElement('iframe');
  frame.title = 'Chat';
  // The chat page loads only when a visitor opens it (saves bandwidth and free-plan quota).
  var chatSrc = base + '/chat/' + encodeURIComponent(slug) + '?embed=1';
  frame.style.cssText = 'position:fixed;bottom:92px;' + side + ':20px;width:380px;height:600px;max-width:calc(100vw - 32px);max-height:calc(100vh - 120px);border:0;border-radius:16px;box-shadow:0 12px 48px rgba(0,0,0,.25);z-index:2147483647;display:none;background:#fff';

  var open = false;
  btn.onclick = function () {
    open = !open;
    if (open && !frame.src) frame.src = chatSrc;
    frame.style.display = open ? 'block' : 'none';
    btn.innerHTML = open ? closeIcon : chatIcon;
  };
  function mount() { document.body.appendChild(frame); document.body.appendChild(btn); }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
