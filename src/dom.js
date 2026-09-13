/* Better Grok Ask - shared DOM helpers.
 *
 * Runs as a classic content script (isolated world) and exposes globalThis.BGADom.
 *
 * Contract taken from the live x.com build (verified 2026-09):
 *   - posts are <article class="..."> with NO data-testid; the classic build used
 *     article[data-testid="tweet"], so both must work.
 *   - actions carry aria-label ("Reply", "Repost", "Like", "Bookmark", "Share").
 *     The Grok action is labelled from the i18n string "Grok actions".
 *   - X builds its Grok links as /i/grok?text=<prompt> (its own OpenSearch
 *     template), and also accepts /i/grok?conversation=<id>&text=<prompt>.
 *   - X itself recognises a bare post link, trailing whitespace included:
 *     /^https?:\/\/(?:www\.)?x\.com\/([^/]+)\/status\/(\d+)(?:\?[^#\s]*)?\s*$/
 */
(() => {
  const STATUS_IN_PATH = /^\/([^/]+)\/status\/(\d+)/;
  const PROFILE_IN_PATH = /^\/([^/]+)$/;
  const ANCESTOR_LIMIT = 10;
  const CONTROL_SEL = 'button, a[href], [role="button"], [role="menuitem"], [role="link"]';

  // First path segments that are routes, not handles. The current build appends
  // a handle-less https://x.com/i/status/<id> link to every post.
  const RESERVED_SEGMENTS = new Set([
    'i', 'home', 'explore', 'search', 'settings', 'messages', 'notifications',
    'compose', 'intent', 'share', 'login', 'logout', 'signup', 'account',
    'tos', 'privacy', 'about', 'help', 'jobs', 'en',
  ]);

  /** Numeric status id of a post permalink, or ''. */
  function statusId(url) {
    const match = /\/status\/(\d+)/.exec(url || '');
    return match ? match[1] : '';
  }

  /** Path of an in-app href, or null. */
  function pathOf(href) {
    try {
      return new URL(href, location.origin).pathname;
    } catch {
      return null;
    }
  }

  /** Canonical https://x.com/<user>/status/<id> for an in-app href, or null. */
  function canonicalPermalink(href) {
    const path = pathOf(href);
    if (!path) return null;
    const match = STATUS_IN_PATH.exec(path);
    if (!match || RESERVED_SEGMENTS.has(match[1].toLowerCase())) return null;
    return `https://x.com/${match[1]}/status/${match[2]}`;
  }

  /** Author handle linked from the post itself, or ''. */
  function authorHandle(root) {
    for (const anchor of root.querySelectorAll('a[href]')) {
      const inner = anchor.closest('article');
      if (inner && inner !== root) continue;
      const path = pathOf(anchor.getAttribute('href'));
      const match = path && PROFILE_IN_PATH.exec(path);
      if (match && !RESERVED_SEGMENTS.has(match[1].toLowerCase())) return match[1];
    }
    return '';
  }

  const isElement = (node) => node instanceof Element;

  /** Anchors for the post itself; links inside a quoted post do not count. */
  function ownAnchors(root) {
    return Array.from(root.querySelectorAll('a[href*="/status/"]')).filter((anchor) => {
      const inner = anchor.closest('article');
      return !inner || inner === root;
    });
  }

  /**
   * Nearest ancestor that represents one post. Falls back to climbing while
   * exactly one post permalink is in scope, so it works without <article> too.
   */
  function postContainer(node) {
    const article = node.closest('article');
    if (article) return article;
    for (let current = node, depth = 0; isElement(current) && depth < ANCESTOR_LIMIT; current = current.parentElement, depth += 1) {
      const anchors = ownAnchors(current);
      if (anchors.length > 1) return null; // climbed past the post boundary
      if (anchors.length === 1) return current;
    }
    return null;
  }

  /** Permalink of the post containing `anchor` (i.e. the click target). */
  function postUrl(container, target) {
    const candidates = [];
    let handlelessId = '';

    for (const anchor of ownAnchors(container)) {
      const href = anchor.getAttribute('href') || anchor.href;
      const url = canonicalPermalink(href);
      if (url) candidates.push({ anchor, url });
      else if (!handlelessId) handlelessId = statusId(href);
    }

    // A post's permalink sits above its action bar, so the last permalink that
    // starts before the click target belongs to the post being acted on. That
    // also keeps thread views, where one container holds several posts, correct.
    const preceding = target
      ? candidates.filter(({ anchor }) => anchor.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING)
      : [];
    const chosen = preceding[preceding.length - 1] || candidates[0];
    if (chosen) return chosen.url;

    // Only a handle-less /i/status/<id> link was found: rebuild the canonical
    // form from the post's own author link, the way X builds t.permalink.
    if (handlelessId) {
      const handle = authorHandle(container);
      if (handle) return `https://x.com/${handle}/status/${handlelessId}`;
    }
    return null;
  }

  /** The Grok entry X renders on a post: labelled for Grok, never for image gen. */
  const ENTRY_ARIA = /(^|[^a-z])grok([^a-z]|$)/i;
  const ENTRY_TESTID = /grokactions|grokpost|grok-action/i;
  const NOT_ENTRY = /imagine|image|图片|生成图片/i;

  /**
   * Does this element look like the post's own Grok entry? Everything else that
   * opens Grok (the nav tab, the overflow menu, image generation, the drawer's
   * own controls) is deliberately left alone.
   */
  function looksLikeGrokEntry(node) {
    const label = `${node.getAttribute('aria-label') || ''} ${node.getAttribute('title') || ''}`;
    const testid = node.getAttribute('data-testid') || '';
    const entry = ENTRY_TESTID.test(testid)
      || (label.trim() !== '' && ENTRY_ARIA.test(label) && !NOT_ENTRY.test(label))
      || (node.childElementCount <= 3 && node.matches(CONTROL_SEL) && (() => {
        const text = (node.textContent || '').trim();
        return text.length > 0 && text.length <= 40 && ENTRY_ARIA.test(text) && !NOT_ENTRY.test(text);
      })());
    if (!entry) return false;
    return node.matches(CONTROL_SEL);
  }

  /** The Grok entry between `target` and `container`, or null. */
  function findGrokEntry(container, target) {
    for (let node = target, depth = 0; isElement(node) && depth < ANCESTOR_LIMIT; node = node.parentElement, depth += 1) {
      if (looksLikeGrokEntry(node)) return node;
      if (node === container) break;
    }
    return null;
  }

  globalThis.BGADom = {
    postContainer,
    postUrl,
    findGrokEntry,
  };
})();
