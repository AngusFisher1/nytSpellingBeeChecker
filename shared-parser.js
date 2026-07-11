// Shared parsing logic used by the side panel.
// Deliberately text-pattern based (not DOM-selector based) so it keeps working
// even if NYT reshuffles markup, as long as the wording stays the same.

function dedupeToken(token) {
  const len = token.length;
  if (len % 2 === 0) {
    const half = len / 2;
    const a = token.slice(0, half).toLowerCase();
    const b = token.slice(half).toLowerCase();
    if (a === b && a.length >= 4) {
      return token.slice(0, half);
    }
  }
  return token;
}

function parseHints(text) {
  const lines = (text || '').split('\n').map((l) => l.trim());
  let letters = null;
  for (const line of lines) {
    const toks = line.split(/\s+/).filter(Boolean);
    if (toks.length === 7 && toks.every((t) => /^[A-Za-z]$/.test(t))) {
      letters = toks.map((t) => t.toUpperCase());
      break;
    }
  }

  const totalsMatch = text.match(/WORDS:\s*(\d+),?\s*POINTS:\s*(\d+),?\s*PANGRAMS:\s*(\d+)/i);
  const totals = totalsMatch
    ? { words: +totalsMatch[1], points: +totalsMatch[2], pangrams: +totalsMatch[3] }
    : null;

  let cols = null;
  for (const line of lines) {
    const toks = line.split(/\s+/).filter(Boolean);
    if (toks.length >= 3 && toks[0] === '4' && toks.some((t) => /[Σ∑]/.test(t))) {
      cols = toks;
      break;
    }
  }

  const grid = {};
  if (cols) {
    for (const line of lines) {
      const m = line.match(/^([A-Za-zΣ∑])\s*:\s*(.+)$/);
      if (m) {
        const rowLetter = m[1].toUpperCase();
        const vals = m[2].split(/\s+/).filter(Boolean);
        if (vals.length === cols.length) {
          grid[rowLetter] = {};
          cols.forEach((c, i) => {
            grid[rowLetter][c] = (vals[i] === '-' ? 0 : parseInt(vals[i], 10)) || 0;
          });
        }
      }
    }
  }

  const twoLetter = {};
  const tlRegex = /\b([A-Za-z]{2})-(\d+)\b/g;
  let mm;
  while ((mm = tlRegex.exec(text))) {
    twoLetter[mm[1].toUpperCase()] = parseInt(mm[2], 10);
  }

  return { letters, totals, cols, grid, twoLetter };
}

function parseFound(text) {
  const rawTokens = (text || '').match(/[A-Za-z]+/g) || [];
  return rawTokens.map(dedupeToken).map((w) => w.toUpperCase()).filter((w) => w.length >= 4);
}

function computeFoundStats(words, letters) {
  const foundGrid = {};
  const foundTwoLetter = {};
  const letterSet = letters ? new Set(letters.map((l) => l.toUpperCase())) : null;
  let points = 0;
  let pangramsFound = 0;
  const seen = new Set();

  words.forEach((w) => {
    if (seen.has(w)) return;
    seen.add(w);
    const first = w[0];
    const len = String(w.length);
    foundGrid[first] = foundGrid[first] || {};
    foundGrid[first][len] = (foundGrid[first][len] || 0) + 1;

    const prefix = w.slice(0, 2);
    foundTwoLetter[prefix] = (foundTwoLetter[prefix] || 0) + 1;

    let wordPoints = w.length === 4 ? 1 : w.length;
    let isPangram = false;
    if (letterSet && letterSet.size === 7) {
      const wSet = new Set(w.split(''));
      isPangram = wSet.size === 7 && [...wSet].every((ch) => letterSet.has(ch));
    }
    if (isPangram) {
      wordPoints += 7;
      pangramsFound += 1;
    }
    points += wordPoints;
  });

  return { foundGrid, foundTwoLetter, points, pangramsFound, uniqueCount: seen.size };
}
