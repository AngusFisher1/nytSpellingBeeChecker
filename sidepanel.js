console.log('[SB Tracker:panel] side panel script loaded');

const hintInput = document.getElementById('hintInput');
const foundInput = document.getElementById('foundInput');
const rawPasteInput = document.getElementById('rawPasteInput');
const cleanStatusLine = document.getElementById('cleanStatusLine');
const results = document.getElementById('results');
const statusLine = document.getElementById('statusLine');
const liveDot = document.getElementById('liveDot');
const liveText = document.getElementById('liveText');

let lastSyncTs = null;
let lastSyncNoTabFound = false;

function renderAll() {
  const hintData = parseHints(hintInput.value);
  const foundWords = parseFound(foundInput.value);

  if (!hintData.cols || Object.keys(hintData.grid).length === 0) {
    results.innerHTML = '<div class="empty-state">No hints grid yet. Open the day\'s Spelling Bee hints page, or paste the grid text manually above.</div>';
    statusLine.textContent = '';
    return;
  }

  const stats = computeFoundStats(foundWords, hintData.letters);
  const centerLetter = hintData.letters ? hintData.letters[0] : null;
  const { cols, grid, twoLetter, totals } = hintData;

  let mismatch = false;
  const rowLetters = Object.keys(grid).filter((l) => l !== 'Σ' && l !== '∑');
  const sigmaKey = Object.keys(grid).find((l) => l === 'Σ' || l === '∑');

  let totalRemainingWords = 0;
  let rowsHtml = '';
  rowLetters.forEach((letter) => {
    const isCenter = centerLetter && letter === centerLetter;
    let cellsHtml = '';
    cols.forEach((col) => {
      if (col === 'Σ' || col === '∑') return;
      const total = grid[letter][col] || 0;
      const found = (stats.foundGrid[letter] && stats.foundGrid[letter][col]) || 0;
      const remaining = total - found;
      if (remaining < 0) mismatch = true;
      totalRemainingWords += Math.max(remaining, 0);
      let cls = 'cell-remaining';
      let display = remaining;
      if (total === 0 || remaining <= 0) { cls = 'cell-done'; display = '·'; }
      cellsHtml += `<td class="${cls}">${display}</td>`;
    });
    const rowTotal = grid[letter][sigmaKey] || 0;
    const rowFoundTotal = cols.reduce((sum, c) => {
      if (c === 'Σ' || c === '∑') return sum;
      return sum + ((stats.foundGrid[letter] && stats.foundGrid[letter][c]) || 0);
    }, 0);
    const rowRemaining = rowTotal - rowFoundTotal;
    rowsHtml += `<tr>
      <td class="letter-cell"><span class="hex-letter ${isCenter ? 'center' : ''}">${letter}</span></td>
      ${cellsHtml}
      <td class="${rowRemaining > 0 ? 'cell-remaining' : 'cell-done'}">${rowRemaining > 0 ? rowRemaining : '·'}</td>
    </tr>`;
  });

  const colHeaders = cols.map((c) => `<th>${c}</th>`).join('');
  const gridTotal = totals ? totals.words : (grid[sigmaKey] ? grid[sigmaKey][sigmaKey] : null);
  const pointsTotal = totals ? totals.points : null;
  const pangramsTotal = totals ? totals.pangrams : null;
  const pointsRemaining = pointsTotal !== null ? Math.max(pointsTotal - stats.points, 0) : null;
  const pangramsRemaining = pangramsTotal !== null ? Math.max(pangramsTotal - stats.pangramsFound, 0) : null;

  let twoLetterHtml = '';
  Object.keys(twoLetter).sort().forEach((prefix) => {
    const total = twoLetter[prefix];
    const found = stats.foundTwoLetter[prefix] || 0;
    const remaining = total - found;
    if (remaining < 0) mismatch = true;
    const cls = remaining <= 0 ? 'done' : '';
    const label = remaining > 0 ? `${prefix}-${remaining}` : `${prefix}-${total}`;
    twoLetterHtml += `<div class="tl-pill ${cls}">${label}</div>`;
  });

  results.innerHTML = `
    <div class="summary">
      <div class="stat"><div class="num">${totalRemainingWords}</div><div class="label">words left${gridTotal !== null ? ' / ' + gridTotal : ''}</div></div>
      ${pointsRemaining !== null ? `<div class="stat"><div class="num">${pointsRemaining}</div><div class="label">points left</div></div>` : ''}
      ${pangramsTotal !== null ? `<div class="stat ${pangramsRemaining === 0 ? '' : 'pangram-open'}"><div class="num">${pangramsRemaining}</div><div class="label">pangram${pangramsTotal !== 1 ? 's' : ''} left</div></div>` : ''}
    </div>
    <div class="panel">
      <h2 class="section-title">Remaining by letter &amp; length</h2>
      <table class="grid">
        <thead><tr><th></th>${colHeaders}<th>&Sigma;</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <div class="panel">
      <h2 class="section-title">Two-letter combos left</h2>
      <div class="two-letter-list">${twoLetterHtml}</div>
    </div>
  `;

  if (mismatch) {
    statusLine.textContent = 'Some counts went negative, a word probably belongs to a different puzzle or got double-counted.';
    statusLine.classList.add('warn');
  } else {
    statusLine.textContent = `${stats.uniqueCount} unique word${stats.uniqueCount !== 1 ? 's' : ''} counted.`;
    statusLine.classList.remove('warn');
  }
}

function updateLiveStatus() {
  if (lastSyncNoTabFound) {
    liveDot.classList.remove('live');
    liveText.textContent = "2. Found words: no open NYT Spelling Bee tab found, open today's puzzle then hit Check now";
    return;
  }
  if (!lastSyncTs) {
    liveDot.classList.remove('live');
    liveText.textContent = '2. Found words: waiting to spot your puzzle tab…';
    return;
  }
  const secondsAgo = Math.round((Date.now() - lastSyncTs) / 1000);
  if (secondsAgo < 90) {
    liveDot.classList.add('live');
    liveText.textContent = secondsAgo < 5 ? '2. Found words: live, just synced' : `2. Found words: live, synced ${secondsAgo}s ago`;
  } else {
    liveDot.classList.remove('live');
    const minutesAgo = Math.round(secondsAgo / 60);
    liveText.textContent = `2. Found words: last synced ${minutesAgo} min ago`;
  }
}
setInterval(updateLiveStatus, 5000);

// Actively asks background.js to go check the live puzzle tab right now,
// rather than passively trusting whatever's cached in storage. This runs
// automatically when the panel opens and whenever it regains focus, plus a
// manual "Check now" button, so if you haven't touched the puzzle in days
// (or played from your phone, where this extension can't run at all),
// opening the panel re-checks the real page before showing you anything.
function syncNow(reason) {
  console.log('[SB Tracker:panel] requesting sync now, reason:', reason);
  liveDot.classList.remove('live');
  liveText.textContent = '2. Found words: checking the puzzle tab…';

  chrome.runtime.sendMessage({ type: 'SB_SYNC_NOW' }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('[SB Tracker:panel] sync request errored', chrome.runtime.lastError);
      updateLiveStatus();
      return;
    }
    console.log('[SB Tracker:panel] sync response', response);

    if (!response || !response.ok) {
      lastSyncNoTabFound = response && response.reason === 'no_tab';
      updateLiveStatus();
      return;
    }

    lastSyncNoTabFound = false;
    // storage.onChanged (below) picks up whatever background.js wrote and
    // will call renderAll() itself, this just clears the "checking..." state
    // in case nothing actually changed (e.g. hints grid text was identical).
    updateLiveStatus();
  });
}

function loadFromStorage() {
  chrome.storage.local.get(['sb_hintsText', 'sb_foundText', 'sb_lastSync'], (data) => {
    if (data.sb_hintsText) hintInput.value = data.sb_hintsText;
    if (data.sb_foundText) foundInput.value = data.sb_foundText;
    if (data.sb_lastSync) lastSyncTs = data.sb_lastSync;
    updateLiveStatus();
    if (hintInput.value.trim()) renderAll();
    // Now that we've shown whatever was cached, immediately check if it's stale.
    syncNow('panel-opened');
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  let changed = false;
  if (changes.sb_hintsText) { hintInput.value = changes.sb_hintsText.newValue || ''; changed = true; }
  if (changes.sb_foundText) { foundInput.value = changes.sb_foundText.newValue || ''; changed = true; }
  if (changes.sb_lastSync) { lastSyncTs = changes.sb_lastSync.newValue; lastSyncNoTabFound = false; }
  updateLiveStatus();
  if (changed && hintInput.value.trim()) renderAll();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') syncNow('panel-focused');
});

document.getElementById('updateBtn').addEventListener('click', renderAll);
document.getElementById('applyFoundBtn').addEventListener('click', renderAll);
document.getElementById('syncNowBtn').addEventListener('click', () => syncNow('manual-button'));

document.getElementById('clearBtn').addEventListener('click', () => {
  hintInput.value = '';
  foundInput.value = '';
  rawPasteInput.value = '';
  lastSyncTs = null;
  lastSyncNoTabFound = false;
  results.innerHTML = '<div class="empty-state">Open today\'s Spelling Bee and the hints page in two tabs. This panel fills in automatically once it spots both.</div>';
  statusLine.textContent = '';
  cleanStatusLine.textContent = '';
  chrome.storage.local.remove(['sb_hintsText', 'sb_foundText', 'sb_lastSync']);
  updateLiveStatus();
});

document.getElementById('cleanBtn').addEventListener('click', () => {
  const rawTokens = rawPasteInput.value.match(/[A-Za-z]+/g) || [];
  if (rawTokens.length === 0) {
    cleanStatusLine.textContent = 'Paste some words above first.';
    cleanStatusLine.classList.add('warn');
    return;
  }
  let fixedCount = 0;
  const cleaned = rawTokens.map((t) => {
    const d = dedupeToken(t);
    if (d.length !== t.length) fixedCount++;
    return d;
  });
  const existing = foundInput.value.match(/[A-Za-z]+/g) || [];
  const seen = new Set();
  const merged = [];
  [...existing, ...cleaned].forEach((w) => {
    const key = w.toLowerCase();
    if (!seen.has(key)) { seen.add(key); merged.push(w.toLowerCase()); }
  });
  foundInput.value = merged.join('\n');
  cleanStatusLine.classList.remove('warn');
  cleanStatusLine.textContent = `Cleaned ${rawTokens.length} word${rawTokens.length !== 1 ? 's' : ''}, fixed ${fixedCount} doubled entr${fixedCount === 1 ? 'y' : 'ies'}.`;
  rawPasteInput.value = '';
  renderAll();
});

loadFromStorage();
