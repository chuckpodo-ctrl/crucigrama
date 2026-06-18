// ─────────────────────────────────────────────────────────────
// solver.js — Client-side crossword fill via backtracking
//
// Strategy (mirrors professional constructors):
//   1. Pre-index the word list by (length, position, letter) so we
//      can answer "what words fit _A_O_?" in O(1)-ish set lookups.
//   2. Fill slots using "most constrained first" — always tackle the
//      slot with the fewest candidates next. This is what keeps
//      backtracking tractable on a 9×9.
//   3. Student/priority words are tried first within each slot, so
//      the user's own vocabulary surfaces as theme entries.
// ─────────────────────────────────────────────────────────────

// ── Build the index once per word list ───────────────────────
// Returns { byLength: Map<len, Word[]>, patternIndex: Map<"len:pos:ch", Set<idx>> }
export function buildIndex(words) {
  const byLength = new Map();
  // For each length, a map "pos:ch" -> Set of array indices into that length bucket
  const patternIndex = new Map();

  for (const w of words) {
    const len = w.key.length;
    if (!byLength.has(len)) {
      byLength.set(len, []);
      patternIndex.set(len, new Map());
    }
    const bucket = byLength.get(len);
    const idx = bucket.length;
    bucket.push(w);

    const pmap = patternIndex.get(len);
    for (let i = 0; i < len; i++) {
      const pk = `${i}:${w.key[i]}`;
      if (!pmap.has(pk)) pmap.set(pk, new Set());
      pmap.get(pk).add(idx);
    }
  }

  return { byLength, patternIndex };
}

// ── Find candidate words matching a pattern ──────────────────
// pattern: array of letters or null (e.g. ['c', null, 's', null] = "c_s_")
// Returns array of Word objects whose key matches all fixed letters.
function candidatesFor(pattern, index) {
  const len = pattern.length;
  const bucket = index.byLength.get(len);
  if (!bucket) return [];

  const pmap = index.patternIndex.get(len);
  const fixed = [];
  for (let i = 0; i < len; i++) {
    if (pattern[i]) fixed.push(`${i}:${pattern[i]}`);
  }

  // No constraints yet → whole bucket is fair game
  if (fixed.length === 0) return bucket.slice();

  // Intersect the sets for each fixed letter, smallest-first for speed
  const sets = fixed.map(f => pmap.get(f)).sort((a, b) => {
    const sa = a ? a.size : 0, sb = b ? b.size : 0;
    return sa - sb;
  });
  if (sets.some(s => !s)) return []; // some letter has zero matches

  let result = null;
  for (const s of sets) {
    if (result === null) {
      result = new Set(s);
    } else {
      const next = new Set();
      for (const idx of result) if (s.has(idx)) next.add(idx);
      result = next;
    }
    if (result.size === 0) return [];
  }

  return [...result].map(idx => bucket[idx]);
}

// ── Get the current pattern for a slot from the grid ─────────
function slotPattern(slot, grid) {
  const pat = [];
  for (let i = 0; i < slot.length; i++) {
    const r = slot.dir === 'A' ? slot.row : slot.row + i;
    const c = slot.dir === 'A' ? slot.col + i : slot.col;
    pat.push(grid[r][c]); // null if empty, letter if filled
  }
  return pat;
}

// ── Place / remove a word on the working grid ────────────────
function placeWord(slot, key, grid) {
  for (let i = 0; i < slot.length; i++) {
    const r = slot.dir === 'A' ? slot.row : slot.row + i;
    const c = slot.dir === 'A' ? slot.col + i : slot.col;
    grid[r][c] = key[i];
  }
}

// ── Shuffle helper (Fisher-Yates) ────────────────────────────
function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Simple seeded RNG (mulberry32) so puzzles can be reproducible if desired
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Main solve entry point (with random restart) ─────────────
// slots: from computeSlots (each {id, dir, row, col, length})
// index: from buildIndex
// opts: { priorityKeys?: Set<string>, seed?: number, maxMs?: number }
//
// Wraps the core backtracker with random restarts: if one search path
// thrashes, we abandon it and try a fresh randomized ordering rather
// than grinding the same dead corner of the search space. This is the
// single biggest reliability win for dense grids.
//
// Returns { ok: boolean, assignment: {slotId: word}, reason?: string }
export function solve(slots, index, opts = {}) {
  const maxMs = opts.maxMs ?? 4000;
  const baseSeed = opts.seed ?? (Math.random() * 1e9) | 0;
  const startTime = Date.now();

  // Each restart gets a fresh seed and a slice of the time budget.
  const perAttemptMs = Math.max(120, Math.floor(maxMs / 6));
  let attempt = 0;
  let lastReason = 'no-fill';

  while (Date.now() - startTime < maxMs) {
    const remainingMs = maxMs - (Date.now() - startTime);
    const budget = Math.min(perAttemptMs, remainingMs);
    const res = solveOnce(slots, index, {
      priorityKeys: opts.priorityKeys,
      seed: baseSeed + attempt * 2654435761,
      maxMs: budget,
    });
    if (res.ok) return { ...res, attempts: attempt + 1 };
    lastReason = res.reason;
    attempt++;
  }

  return { ok: false, assignment: {}, reason: lastReason, steps: 0, grid: null, attempts: attempt };
}

// ── Core single-pass backtracking solve ──────────────────────
function solveOnce(slots, index, opts = {}) {
  const rng = makeRng(opts.seed ?? (Math.random() * 1e9) | 0);
  const priorityKeys = opts.priorityKeys ?? new Set();
  const maxMs = opts.maxMs ?? 1000;
  const startTime = Date.now();

  // Working grid: find bounds from slots
  let maxR = 0, maxC = 0;
  for (const s of slots) {
    const er = s.dir === 'A' ? s.row : s.row + s.length - 1;
    const ec = s.dir === 'A' ? s.col + s.length - 1 : s.col;
    maxR = Math.max(maxR, er); maxC = Math.max(maxC, ec);
  }
  const grid = Array.from({ length: maxR + 1 }, () => Array(maxC + 1).fill(null));

  const assignment = {};
  const usedKeys = new Set(); // no repeated words in one puzzle

  let steps = 0;
  let timedOut = false;

  function backtrack(remaining) {
    if (Date.now() - startTime > maxMs) { timedOut = true; return false; }
    if (remaining.length === 0) return true;

    // ── Most constrained first: score each remaining slot by # candidates
    let best = null, bestCands = null, bestScore = Infinity;
    for (const slot of remaining) {
      const pat = slotPattern(slot, grid);
      const cands = candidatesFor(pat, index).filter(w => !usedKeys.has(w.key));
      if (cands.length === 0) return false; // dead end — prune now
      if (cands.length < bestScore) {
        bestScore = cands.length;
        best = slot;
        bestCands = cands;
        if (bestScore === 1) break; // can't do better than forced
      }
    }

    // Order candidates: priority (student) words first, then shuffled.
    // Cap how many we explore per slot — exploring all 800 candidates of
    // an unconstrained slot is what causes thrashing. A generous cap keeps
    // variety while bounding the branching factor.
    const prio = [], rest = [];
    for (const w of bestCands) {
      (priorityKeys.has(w.key) ? prio : rest).push(w);
    }
    shuffle(prio, rng);
    shuffle(rest, rng);
    const CAP = 40;
    const ordered = [...prio, ...rest].slice(0, Math.max(CAP, prio.length));

    const nextRemaining = remaining.filter(s => s !== best);

    // Snapshot grid cells this slot will touch (for undo)
    const touched = [];
    for (let i = 0; i < best.length; i++) {
      const r = best.dir === 'A' ? best.row : best.row + i;
      const c = best.dir === 'A' ? best.col + i : best.col;
      touched.push([r, c, grid[r][c]]);
    }

    for (const w of ordered) {
      steps++;
      placeWord(best, w.key, grid);
      assignment[best.id] = w;
      usedKeys.add(w.key);

      if (backtrack(nextRemaining)) return true;

      // Undo
      delete assignment[best.id];
      usedKeys.delete(w.key);
      for (const [r, c, prev] of touched) grid[r][c] = prev;

      if (timedOut) return false;
    }

    return false;
  }

  const ok = backtrack(slots.slice());

  return {
    ok,
    assignment: ok ? assignment : {},
    reason: ok ? null : (timedOut ? 'timeout' : 'no-fill'),
    steps,
    grid: ok ? grid : null,
  };
}

// ── Convenience: filter a raw word list to grid-safe entries ──
export function prepareWords(rawWords, maxLen = 9) {
  const out = [];
  const seen = new Set();
  for (const w of rawWords) {
    const key = w.key || '';
    if (key.length < 3 || key.length > maxLen) continue;
    if (!/^[a-z]+$/.test(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}
