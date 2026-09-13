/* Better Grok Ask - opens Grok when the drawer cannot be used, and carries the
 * pre-fill across that navigation.
 *
 * The normal desktop path opens the drawer in place and needs nothing from here.
 * Two cases do: a narrow layout (X navigates to /i/grok) and a build without the
 * floating Grok launcher (opened as a new tab). Both end with the text stashed
 * for Grok's page to claim.
 */
const MESSAGE_OPEN = 'better-grok-ask:open';
const MESSAGE_STASH = 'better-grok-ask:stash';
const MESSAGE_TAKE = 'better-grok-ask:take';
const PENDING_KEY = 'pendingPrefill';
const PENDING_TTL_MS = 30000;

const stash = (text, tabId) => chrome.storage.session.set({ [PENDING_KEY]: { text, tabId, at: Date.now() } });

async function claim(tabId) {
  const stored = (await chrome.storage.session.get(PENDING_KEY))[PENDING_KEY];
  // A fresh tab may ask before the create callback stamped its id.
  const claimable = stored
    && (stored.tabId === null || stored.tabId === tabId)
    && Date.now() - stored.at < PENDING_TTL_MS;
  if (!claimable) return null;
  await chrome.storage.session.remove(PENDING_KEY);
  return stored.text;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return false;
  const tabId = (sender.tab && sender.tab.id) ?? null;

  if (message.type === MESSAGE_STASH) {
    if (typeof message.text !== 'string' || !message.text || tabId === null) {
      sendResponse({ ok: false });
      return false;
    }
    stash(message.text, tabId);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === MESSAGE_OPEN) {
    const text = message.text;
    // Claimable before the tab exists: the page asks for it while this callback
    // is still pending.
    stash(text, null);
    chrome.tabs.create({ url: message.url, active: true, openerTabId: tabId }, (tab) => {
      chrome.storage.session.get(PENDING_KEY).then((stored) => {
        const current = stored[PENDING_KEY];
        if (current && current.text === text) stash(text, (tab && tab.id) ?? null);
      });
    });
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === MESSAGE_TAKE) {
    claim(tabId).then((text) => sendResponse({ text }));
    return true; // keep the channel open for the async reply
  }

  return false;
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
