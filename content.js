// Spelling Bee Tracker - content script
//
// This intentionally does NOT hardcode NYT's CSS class names, since those
// change often and silently. Instead it anchors on stable, user-facing text
// NYT itself writes into the page ("You have found N words", the
// "WORDS: n, POINTS: n, PANGRAMS: n" hint summary) and reads the surrounding
// text.
//
// IMPORTANT: every log line here uses console.log, not console.debug.
// console.debug gets filed under Chrome DevTools' "Verbose" level, which is
// hidden by the default console filter. If you don't see ANY of these lines
// (not even the very first one below) after reloading the puzzle tab, the
// content script itself never ran on that frame, check chrome://extensions
// for errors and make sure you reloaded both the extension and the tab.
//
// If NYT changes their copy, tighten FOUND_LIST_SELECTOR / HINTS_SELECTOR
// below with a real selector found via right-click > Inspect.

console.log(
  '%c[SB Tracker:content] script loaded',
  'color:#B8860B;font-weight:bold',
  { url: location.href, frame: window === window.top ? 'top' : 'iframe' }
);

// Confirmed via live DOM inspection on the actual puzzle page (2026-07-11):
// the found-words summary lives at .sb-wordlist-summary, and the real word
// list content is reachable a few levels up. .sb-wordlist-items-pag is the
// real NYT class for the list itself, used as the primary path below, with
// the old text-anchor heuristic kept only as a fallback in case NYT ever
// renames it.
const FOUND_LIST_SELECTOR = '.sb-wordlist-items-pag';
const HINTS_SELECTOR = null; // e.g. 'main article' once you've confirmed it

function findFoundWordsText() {
  if (FOUND_LIST_SELECTOR) {
    const el = document.querySelector(FOUND_LIST_SELECTOR);
    if (el) {
      console.log('[SB Tracker:content] using FOUND_LIST_SELECTOR', FOUND_LIST_SELECTOR,
        '-', (el.innerText.match(/\b[A-Za-z]{4,}\b/g) || []).length, 'candidate tokens');
      return el.innerText;
    }
    console.log('[SB Tracker:content] FOUND_LIST_SELECTOR set but not present on this page/frame, falling back to heuristic');
  }

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

  if (!anchorEl) {
    console.log('[SB Tracker:content] no "You have found N words" anchor on this page/frame:', location.href);
    return null;
  }

  // Walk up from the PARENT of the anchor (not the anchor itself) until we
  // hit a container holding a plausible word list.
  //
  // The actual bug: the anchor's own text, "You have found N words," itself
  // contains three 4+ letter tokens ("have", "found", "words"). Starting the
  // climb at the anchor and checking >=3 tokens satisfied that threshold
  // immediately, at step zero, every single time, regardless of what was
  // actually typed. It silently returned that same boilerplate sentence
  // forever instead of ever reaching the real list. Skipping to the parent
  // and raising the bar fixes that.
  //
  // Also: use innerText, not textContent. NYT's real word list content
  // isn't reachable via textContent at all (confirmed live: textContent
  // stayed flat while innerText climbed from 3 to 73 tokens across the same
  // ancestor chain), so innerText is correct here.
  let container = anchorEl.parentElement;
  for (let i = 0; i < 6 && container; i++) {
    const words = (container.innerText || '').match(/\b[A-Za-z]{4,}\b/g) || [];
    if (words.length >= 5) {
      console.log('[SB Tracker:content] found-words container located via heuristic', container, `(${words.length} candidate tokens)`);
      return container.innerText;
    }
    container = container.parentElement;
  }
  console.log('[SB Tracker:content] anchor found but no word-list container nearby', anchorEl);
  return null;
}

function findHintsText() {
  if (HINTS_SELECTOR) {
    const el = document.querySelector(HINTS_SELECTOR);
    if (el) return el.innerText;
  }

  const bodyText = document.body.innerText || '';
  if (/WORDS:\s*\d+,?\s*POINTS:\s*\d+,?\s*PANGRAMS:\s*\d+/i.test(bodyText)) {
    return bodyText;
  }
  console.log('[SB Tracker:content] no WORDS/POINTS/PANGRAMS summary on this page/frame');
  return null;
}

function sync() {
  const foundText = findFoundWordsText();
  const hintsText = findHintsText();
  const updates = {};
  if (foundText) updates.sb_foundText = foundText;
  if (hintsText) updates.sb_hintsText = hintsText;
  if (Object.keys(updates).length) {
    updates.sb_lastSync = Date.now();
    chrome.storage.local.set(updates);
    console.log('[SB Tracker:content] synced', {
      foundWords: foundText ? foundText.slice(0, 80) + '...' : null,
      hints: hintsText ? hintsText.slice(0, 80) + '...' : null
    });
  }
  return { foundText, hintsText };
}

sync();

let debounceTimer = null;
const observer = new MutationObserver(() => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(sync, 350);
});
observer.observe(document.body, { childList: true, subtree: true, characterData: true });

// Lets the side panel ask this exact tab/frame to re-check right now,
// instead of waiting for the next DOM mutation. This is a lighter-weight
// companion to the on-demand chrome.scripting.executeScript path in
// background.js; if this content script is running, this responds fast.
// If it's NOT running (the thing we're actually debugging), background.js's
// executeScript fallback still covers it independently.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'SB_SYNC_NOW') {
    console.log('[SB Tracker:content] on-demand sync requested by panel');
    const result = sync();
    sendResponse({ ok: true, via: 'content-script', ...result });
  }
});
