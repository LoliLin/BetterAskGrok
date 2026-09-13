/* Better Grok Ask - types into Grok's composer.
 *
 * Measured on the live x.com build (logged in):
 *   - the composer is a <textarea placeholder="随便问点什么"> ("Ask anything");
 *   - it only accepts input through the browser's editing pipeline. Setting
 *     .value plus a synthetic input event is ignored by X's state and the next
 *     render wipes the field, while document.execCommand('insertText') sticks;
 *   - the page also re-renders the composer while it settles, so a write only
 *     counts once it has survived without being reset.
 *
 * Nothing here ever submits: the link is left in the composer for the user.
 */
(() => {
  const COMPOSER_SEL = '[contenteditable="true"], [role="textbox"], textarea';

  // Never touch the post composer, DM composer or a search field. The current
  // build carries no data-testid for these, so match on aria-label too.
  const NOT_COMPOSER_SEL = [
    '[data-testid^="tweetTextarea"]',
    '[data-testid^="dmComposer"]',
    '[data-testid="searchBox"]',
    '#tweet-text-editor',
    '[aria-label*="post text" i]',
    '[aria-label*="add another post" i]',
    '[aria-label*="reply text" i]',
    '[aria-label*="search query" i]',
    '[aria-label*="search" i]',
  ].join(', ');

  /** Grok's own placeholder, so a stray editor is never mistaken for it. */
  const COMPOSER_PLACEHOLDER = /ask anything|随便问点什么/i;

  const delay = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

  const isVisible = (el) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const isGrokScoped = (el) => {
    for (let node = el; node instanceof Element; node = node.parentElement) {
      const label = `${node.getAttribute('data-testid') || ''} ${node.getAttribute('aria-label') || ''}`;
      if (/grok/i.test(label)) return true;
    }
    return false;
  };

  const onGrokPage = () => /^\/i\/grok/.test(location.pathname);

  const candidates = () =>
    Array.from(document.querySelectorAll(COMPOSER_SEL)).filter((el) => isVisible(el) && !el.closest(NOT_COMPOSER_SEL));

  /**
   * Grok's composer: a Grok-scoped editor, else — on Grok's own page — the
   * editor carrying Grok's placeholder, else the only editor there.
   */
  function findComposer() {
    const list = candidates();
    const scoped = list.find(isGrokScoped);
    if (scoped) return scoped;
    if (!onGrokPage()) return null;
    return list.find((el) => COMPOSER_PLACEHOLDER.test(el.getAttribute('placeholder') || '')) || list[0] || null;
  }

  const readText = (el) => (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement ? el.value : el.textContent || '');

  /**
   * X's floating Grok launcher, bottom-right: a <button> labelled "Grok", never
   * the nav tab (an <a>) and never the per-post icons (inside an <article>).
   * Clicking it opens the drawer on its own, with no post attached.
   */
  const LAUNCHER_SEL = 'button[data-testid="GrokDrawerHeader"], button[aria-label="Grok"]';

  function findLauncher() {
    for (const el of document.querySelectorAll(LAUNCHER_SEL)) {
      if (el.closest('article') || !isVisible(el)) continue;
      return el;
    }
    return null;
  }

  /**
   * Open the drawer through X's own launcher when its composer is not around.
   * The drawer's state is judged by the composer itself: the GrokDrawer element
   * stays mounted as an empty shell, so its presence says nothing.
   */
  async function openDrawer({ timeoutMs = 4000 } = {}) {
    if (findComposer()) return true;

    const launcher = findLauncher();
    if (!launcher) return false;
    launcher.click();

    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      if (findComposer()) return true;
      await delay(150);
    }
    return !!findComposer();
  }

  /** X's own "New chat" control in the drawer header, localized. */
  const NEW_CHAT_LABEL = /新聊天|new chat/i;

  function findNewChatButton() {
    for (const el of document.querySelectorAll('button[aria-label]')) {
      if (!NEW_CHAT_LABEL.test(el.getAttribute('aria-label') || '')) continue;
      if (el.closest('article') || !isVisible(el)) continue;
      return el;
    }
    return null;
  }

  /**
   * Start a fresh conversation before typing. A conversation that already holds
   * text — or one whose reply is still streaming in — keeps re-rendering the
   * composer and swallows the write, which made a second post look like it did
   * nothing at all.
   */
  async function startNewConversation({ timeoutMs = 3000 } = {}) {
    const button = findNewChatButton();
    if (!button) return false;
    button.click();

    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      const el = findComposer();
      if (el && readText(el) === '') return true;
      await delay(120);
    }
    return false;
  }

  function caretToEnd(el) {
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function insertRaw(el, value) {
    el.focus();

    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      // X's composer only accepts the browser's editing pipeline: execCommand
      // produces a real edit that its state picks up.
      try {
        const end = el.value.length;
        el.setSelectionRange(end, end);
      } catch {
        /* input types without a selection API: leave the caret alone */
      }
      document.execCommand('insertText', false, value);
      if (el.value.endsWith(value)) return;

      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, el.value + value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    caretToEnd(el);
    document.execCommand('insertText', false, value);
    if (readText(el).endsWith(value)) return;

    // Draft.js consumes a synthetic paste natively; used when execCommand is a no-op.
    try {
      const data = new DataTransfer();
      data.setData('text/plain', value);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    } catch {
      /* ClipboardEvent unavailable: the caller verifies against the DOM. */
    }
  }

  function insert(el, value) {
    const body = value.replace(/\s+$/, '');
    const tail = value.slice(body.length);

    let ok = true;
    if (body) {
      insertRaw(el, body);
      ok = readText(el).endsWith(body);
    }
    if (ok && tail) ok = insertWhitespace(el, tail);
    return ok;
  }

  /**
   * Editors routinely normalise a trailing space away. A non-breaking space
   * survives, renders as a space and still satisfies /\s/, which is what keeps
   * the link and the question typed next from gluing together.
   */
  function insertWhitespace(el, tail) {
    for (const candidate of [tail, ' ', '\u00A0']) {
      insertRaw(el, candidate);
      if (/\s$/.test(readText(el))) return true;
    }
    return false;
  }

  /** Empty the composer through the editing pipeline, so X's state follows. */
  function clearComposer(el) {
    el.focus();
    try {
      el.setSelectionRange(0, el.value.length);
    } catch {
      /* editors without a selection API */
    }
    document.execCommand('delete');
    if (!readText(el)) return;

    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  /**
   * Type `text` into Grok's composer without sending anything.
   *
   * Runs only once the composer has stopped changing (settleMs), and only
   * reports success once the value has survived without being reset.
   */
  async function writeIntoComposer(text, { timeoutMs = 20000, ensureSpace = true, settleMs = 400 } = {}) {
    const body = text.replace(/\s+$/, '');
    const hasLink = (el) => readText(el).includes(body);
    const deadline = performance.now() + timeoutMs;
    const CONFIRM_MS = 600;
    let lastValue = null;
    let settledSince = 0;
    let confirmedSince = 0;

    while (performance.now() < deadline) {
      const el = findComposer();
      if (!el) {
        lastValue = null;
        settledSince = 0;
        confirmedSince = 0;
        await delay(150);
        continue;
      }

      const value = readText(el);
      if (value !== lastValue) {
        lastValue = value;
        settledSince = performance.now();
      }
      const settled = settledSince > 0 && performance.now() - settledSince >= settleMs;

      if (hasLink(el)) {
        if (!confirmedSince) confirmedSince = performance.now();
        if (performance.now() - confirmedSince >= CONFIRM_MS) {
          if (ensureSpace && !/\s$/.test(readText(el))) insertWhitespace(el, ' ');
          el.focus();
          return true;
        }
      } else {
        confirmedSince = 0;
        if (settled) {
          if (readText(el).trim()) clearComposer(el);
          insert(el, text);
          if (ensureSpace && !/\s$/.test(readText(el))) insertWhitespace(el, ' ');
          el.focus();
        }
      }
      await delay(150);
    }
    return false;
  }

  globalThis.BGAComposer = { writeIntoComposer, findComposer, openDrawer, startNewConversation };
})();
