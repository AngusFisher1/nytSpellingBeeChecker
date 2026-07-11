// Manifest V3 side panel behavior is set from the service worker, not the manifest.
console.log('[SB Tracker:bg] service worker starting up');

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .then(() => console.log('[SB Tracker:bg] side panel behavior set'))
    .catch((err) => console.error('[SB Tracker:bg] could not set panel behavior', err));
});

// Self-contained scrape function, injected directly into the page via
// chrome.scripting.executeScript. This does NOT depend on content.js's
// static injection having worked, it's a completely independent path, which
// is the point: if the declarative content_scripts injection is silently
// failing for whatever reason, this still works, because it's triggered
// on demand by the side panel opening/focusing/clicking "Check now" rather
// than relying on document_idle timing or a matching content script ever
// having attached to this specific tab.
function sbInjectedScrape() {
  // Confirmed real selector, checked first (see content.js for how this was found).
  const FOUND_LIST_SELECTOR = '.sb-wordlist-items-pag';
  let foundText = null;

  const selectorEl = document.querySelector(FOUND_LIST_SELECTOR);
  if (selectorEl) {
    foundText = selectorEl.innerText;
  } else {
    const FOUND_PATTERN = /You\s*have\s*found\s*\d+\s*words?/i;
    let anchorEl = null;
    let smallestLen = Infinity;
    const all = document.querySelectorAll('body *');
    for (const el of all) {
      const text = el.textContent || '';
      if (text.length < smallestLen && FOUND_PATTERN.test(text)) {
        anchorEl = el;
        smallestLen = text.length;
      }
    }
    // Climb from the PARENT of the anchor, not the anchor itself: the
    // anchor's own text ("You have found N words") contains three 4+ letter
    // tokens on its own ("have", "found", "words"), which used to satisfy
    // the threshold immediately and return the boilerplate sentence instead
    // of the real list.
    if (anchorEl) {
      let container = anchorEl.parentElement;
      for (let i = 0; i < 6 && container; i++) {
        const words = (container.innerText || '').match(/\b[A-Za-z]{4,}\b/g) || [];
        if (words.length >= 5) {
          foundText = container.innerText;
          break;
        }
        container = container.parentElement;
      }
    }
  }

  const bodyText = document.body ? (document.body.innerText || '') : '';
  const hintsText = /WORDS:\s*\d+,?\s*POINTS:\s*\d+,?\s*PANGRAMS:\s*\d+/i.test(bodyText) ? bodyText : null;

  return {
    url: location.href,
    isTop: window === window.top,
    foundText,
    hintsText,
  };
}

async function findPuzzleTab() {
  const tabs = await chrome.tabs.query({ url: '*://*.nytimes.com/*' });
  console.log('[SB Tracker:bg] nytimes.com tabs currently open:', tabs.map((t) => `${t.id}: ${t.url}`));
  if (!tabs.length) return null;
  const preferred = tabs.find((t) => (t.url || '').includes('spelling-bee'));
  return preferred || tabs[0];
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SB_SYNC_NOW') return false;

  (async () => {
    const tab = await findPuzzleTab();
    if (!tab) {
      console.log('[SB Tracker:bg] no nytimes.com tab open, nothing to sync');
      sendResponse({ ok: false, reason: 'no_tab' });
      return;
    }

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: sbInjectedScrape,
      });
      console.log(`[SB Tracker:bg] executeScript ran in ${results.length} frame(s):`, results.map((r) => r.result));

      let foundText = null;
      let hintsText = null;
      for (const r of results) {
        const val = r.result;
        if (!val) continue;
        if (!foundText && val.foundText) foundText = val.foundText;
        if (!hintsText && val.hintsText) hintsText = val.hintsText;
      }

      const updates = { sb_lastSync: Date.now() };
      if (foundText) updates.sb_foundText = foundText;
      if (hintsText) updates.sb_hintsText = hintsText;
      chrome.storage.local.set(updates);

      console.log('[SB Tracker:bg] sync-now complete', {
        gotFoundText: !!foundText,
        gotHintsText: !!hintsText,
        tabUrl: tab.url,
      });
      sendResponse({ ok: true, foundText, hintsText, tabUrl: tab.url });
    } catch (err) {
      console.error('[SB Tracker:bg] executeScript failed', err);
      sendResponse({ ok: false, reason: 'inject_failed', error: String(err) });
    }
  })();

  return true; // keep the message channel open for the async sendResponse above
});
