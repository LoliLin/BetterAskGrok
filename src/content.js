/* Better Grok Ask - entry point.
 *
 * Only the post's own Grok icon is handled, and X's handler for it is fully
 * overwritten: that handler always sends the post as a card message, so the
 * click is blocked and the extension opens Grok itself on a fresh conversation
 * with "https://x.com/<user>/status/<id> " pre-filled. Nothing is ever sent on
 * the user's behalf.
 *
 * Everything else that opens Grok or the drawer — the nav tab, the overflow
 * menu, image generation, the drawer's own controls — is left untouched.
 */
(() => {
  const dom = globalThis.BGADom;
  const composer = globalThis.BGAComposer;
  if (!dom || !composer) return;

  const DEFAULTS = { appendSpace: true };
  const GROK_PAGE = 'https://x.com/i/grok';
  const MESSAGE_STASH = 'better-grok-ask:stash';
  const MESSAGE_TAKE = 'better-grok-ask:take';
  const MOBILE_LAYOUT = '(max-width: 767px)';

  let settings = { ...DEFAULTS };
  const loadSettings = () => chrome.storage.sync.get(DEFAULTS, (stored) => { settings = { ...DEFAULTS, ...stored }; });
  loadSettings();
  chrome.storage.onChanged.addListener(loadSettings);

  const isMobileLayout = () => window.matchMedia(MOBILE_LAYOUT).matches;
  const onGrokPage = () => /^\/i\/grok/.test(location.pathname);

  document.addEventListener('click', onClick, true);

  function onClick(event) {
    if (event.defaultPrevented || event.button !== 0) return;

    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    const target = path.find((node) => node instanceof Element);
    if (!target) return;

    const container = dom.postContainer(target);
    if (!container) return;

    const entry = dom.findGrokEntry(container, target);
    if (!entry) return;

    const postUrl = dom.postUrl(container, target);
    if (!postUrl) return;

    // Overwrite X's behaviour: its handler would send the post as a message.
    event.preventDefault();
    event.stopPropagation();

    const text = settings.appendSpace ? `${postUrl} ` : postUrl;
    if (isMobileLayout()) {
      // X navigates the current tab here; do the same.
      chrome.runtime.sendMessage({ type: MESSAGE_STASH, text }, () => { void chrome.runtime.lastError; });
      location.assign(GROK_PAGE);
      return;
    }

    // X's post handler is never allowed to run (it sends the post as a card), so
    // the drawer is opened through X's own bottom-right Grok launcher instead.
    openDrawerAndFill(text);
  }

  async function openDrawerAndFill(text) {
    if (await composer.openDrawer()) {
      const written = await composer.writeIntoComposer(text, { ensureSpace: settings.appendSpace });
      if (!written) console.warn('[Better Grok Ask] could not prefill the Grok composer');
      return;
    }
    // No drawer launcher on this build: fall back to X's own Grok page, where the
    // same text is typed in. Better than a click that appears to do nothing.
    chrome.runtime.sendMessage({ type: MESSAGE_OPEN, url: GROK_PAGE, text }, () => { void chrome.runtime.lastError; });
  }

  // On Grok's own page, type the pre-fill the click asked for. Nothing is sent.
  if (onGrokPage()) {
    chrome.runtime.sendMessage({ type: MESSAGE_TAKE }, (response) => {
      if (chrome.runtime.lastError || !response || !response.text) return;
      composer.writeIntoComposer(response.text, { ensureSpace: settings.appendSpace }).then((written) => {
        if (!written) console.warn('[Better Grok Ask] could not prefill the Grok composer');
      });
    });
  }
})();
