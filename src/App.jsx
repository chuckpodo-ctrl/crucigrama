import { useState, useRef, useMemo } from 'react';
import { TEMPLATES } from './templates.js';
import { buildIndex, solve, prepareWords } from './solver.js';
import RAW_WORDS from './wordlist.json';

// ── Tokens ────────────────────────────────────────────────────
const T = {
  bg: '#0f1117', surface: '#1a1d27', card: '#22263a', border: '#2e3147',
  accent: '#e8aa3e', text: '#f0ede8', muted: '#8a8fa8',
  cellBg: '#f5f2ec', cellSel: '#f9d423', cellWord: '#fdf0b0',
  cellOk: '#b7e4c7', cellBad: '#ffc4c4', cellHint: '#d0b8ff',
  black: '#111', red: '#c0392b',
};

// ── Grid size ─────────────────────────────────────────────────
const GS = 9;

// ── Crossword geometry ────────────────────────────────────────

function computeSlots(template) {
  const slots = [];

  // Collect across runs (≥3 white cells)
  for (let r = 0; r < GS; r++) {
    let c = 0;
    while (c < GS) {
      if (template[r][c] === 1) { c++; continue; }
      const start = c;
      while (c < GS && template[r][c] === 0) c++;
      if (c - start >= 3) slots.push({ dir: 'A', row: r, col: start, length: c - start });
    }
  }

  // Collect down runs (≥3 white cells)
  for (let c = 0; c < GS; c++) {
    let r = 0;
    while (r < GS) {
      if (template[r][c] === 1) { r++; continue; }
      const start = r;
      while (r < GS && template[r][c] === 0) r++;
      if (r - start >= 3) slots.push({ dir: 'D', row: start, col: c, length: r - start });
    }
  }

  // Number starting cells (top-left → bottom-right)
  const startSet = new Map(); // "r,c" → number
  const starters = [];
  for (const s of slots) {
    const key = `${s.row},${s.col}`;
    if (!startSet.has(key)) starters.push({ key, row: s.row, col: s.col });
  }
  starters.sort((a, b) => a.row !== b.row ? a.row - b.row : a.col - b.col);
  let num = 1;
  for (const s of starters) startSet.set(s.key, num++);

  const cellNums = {};
  for (const s of slots) {
    const key = `${s.row},${s.col}`;
    s.number = startSet.get(key);
    s.id = `${s.dir}${s.number}`;
    cellNums[key] = s.number;
  }

  return {
    slots,
    cellNums,
    across: slots.filter(s => s.dir === 'A').sort((a, b) => a.number - b.number),
    down:   slots.filter(s => s.dir === 'D').sort((a, b) => a.number - b.number),
  };
}

function buildSolutionGrid(template, slots, words) {
  const grid = Array(GS).fill(null).map(() => Array(GS).fill(null));
  // Fill from across words first, then down (across takes precedence at conflicts)
  const dirs = ['D', 'A'];
  for (const dir of dirs) {
    for (const slot of slots.filter(s => s.dir === dir)) {
      const w = words[slot.id];
      if (!w) continue;
      const key = (w.key || w.spanish || '').toLowerCase().replace(/[áàâä]/g,'a').replace(/[éèêë]/g,'e').replace(/[íìîï]/g,'i').replace(/[óòôö]/g,'o').replace(/[úùûü]/g,'u').replace(/ñ/g,'n').replace(/[^a-z]/g,'');
      for (let i = 0; i < Math.min(key.length, slot.length); i++) {
        const r = slot.dir === 'A' ? slot.row : slot.row + i;
        const c = slot.dir === 'A' ? slot.col + i : slot.col;
        if (grid[r][c] === null || dir === 'A') grid[r][c] = key[i] ?? '?';
      }
    }
  }
  return grid;
}

// ── App ───────────────────────────────────────────────────────
export default function App() {
  const [puzzle,      setPuzzle]      = useState(null);
  const [userGrid,    setUserGrid]    = useState(null);
  const [sel,         setSel]         = useState({ r: null, c: null, dir: 'A' });
  const [peekEN,      setPeekEN]      = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [loadMsg,     setLoadMsg]     = useState('');
  const [error,       setError]       = useState('');
  const [checked,     setChecked]     = useState(false);
  const [revealed,    setRevealed]    = useState(new Set());
  const [inputVal,    setInputVal]    = useState('');
  const [activeTab,   setActiveTab]   = useState('A');
  const [hintText,    setHintText]    = useState('');
  const [hintLoading, setHintLoading] = useState(false);
  const [completed,   setCompleted]   = useState(false);
  const [cluesLoading, setCluesLoading] = useState(false);

  const inputRef = useRef(null);

  // ── Word list & index ────────────────────────────────────────
  // The bundled list is prepared (filtered to 3–9 letters, a–z keys) and
  // indexed for fast pattern lookup.
  const baseWords = useMemo(() => prepareWords(RAW_WORDS, 9), []);
  const wordIndex = useMemo(() => buildIndex(baseWords), [baseWords]);

  // Student words from the bundled list are the priority/theme layer.
  const priorityKeys = useMemo(() => {
    const keys = new Set();
    for (const w of baseWords) {
      if (w.source === 'student') keys.add(w.key);
    }
    return keys;
  }, [baseWords]);

  // ── Derived ──────────────────────────────────────────────────
  const inSlot = (s, r, c) => {
    if (!s) return false;
    return s.dir === 'A' ? s.row === r && c >= s.col && c < s.col + s.length
                         : s.col === c && r >= s.row && r < s.row + s.length;
  };

  const selectedSlot = puzzle?.slots.find(s => {
    if (s.dir !== sel.dir || sel.r === null) return false;
    return inSlot(s, sel.r, sel.c);
  }) ?? null;

  // ── Generate ─────────────────────────────────────────────────
  const generatePuzzle = async () => {
    setLoading(true); setLoadMsg('Building grid…');
    setError(''); setChecked(false); setRevealed(new Set());
    setHintText(''); setPeekEN(false); setCompleted(false);
    setPuzzle(null); setUserGrid(null);

    try {
      // ── Step 1: solve a grid locally (fast, reliable) ──────────
      // Try templates in random order; each solve has internal restarts,
      // so a single failure is rare, but we fall through to another
      // template just in case.
      const order = [...TEMPLATES.keys()].sort(() => Math.random() - 0.5);
      let chosen = null;

      for (const ti of order) {
        const template = TEMPLATES[ti];
        const { slots, cellNums, across, down } = computeSlots(template);
        const result = solve(slots, wordIndex, { priorityKeys, maxMs: 2500 });
        if (result.ok) {
          chosen = { template, slots, cellNums, across, down, assignment: result.assignment };
          break;
        }
        // brief yield so the loading text can paint between attempts
        await new Promise(r => setTimeout(r, 0));
      }

      if (!chosen) throw new Error('Could not fill a grid — try again');

      const { template, slots, cellNums, across, down, assignment } = chosen;

      // ── Step 2: build the solution grid from the assignment ────
      const wordsById = {};
      for (const s of slots) {
        const w = assignment[s.id];
        wordsById[s.id] = {
          key: w.key,
          spanish: w.spanish || w.key,
          english: w.english || '',
        };
      }
      const solution = buildSolutionGrid(template, slots, wordsById);

      // ── Step 3: show the playable grid immediately ─────────────
      // Clues fill in a moment later (Step 4), so the user sees the
      // puzzle right away rather than waiting on the network.
      const enrichedSlots = slots.map(s => ({
        ...s,
        key: wordsById[s.id].key,
        spanish: wordsById[s.id].spanish,
        english: wordsById[s.id].english,
        clue_en: '…',
        clue_es: '…',
      }));
      const enrichedAcross = enrichedSlots.filter(s => s.dir === 'A').sort((a, b) => a.number - b.number);
      const enrichedDown   = enrichedSlots.filter(s => s.dir === 'D').sort((a, b) => a.number - b.number);

      setPuzzle({ template, solution, slots: enrichedSlots, cellNums, across: enrichedAcross, down: enrichedDown });
      setUserGrid(Array(GS).fill(null).map(() => Array(GS).fill('')));
      const first = enrichedAcross[0] ?? enrichedDown[0];
      if (first) setSel({ r: first.row, c: first.col, dir: first.dir });
      setActiveTab(enrichedAcross.length ? 'A' : 'D');
      setLoading(false); setLoadMsg('');

      // ── Step 4: fetch clues for the placed words (background) ───
      setCluesLoading(true);
      try {
        const wordsForClues = enrichedSlots.map(s => ({
          id: s.id,
          spanish: s.spanish,
          english: s.english,
        }));
        const res = await fetch('/api/clues', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ words: wordsForClues }),
        });
        const data = await res.json();
        if (data.clues) {
          setPuzzle(prev => {
            if (!prev) return prev;
            const apply = sl => sl.map(s => ({
              ...s,
              clue_en: data.clues[s.id]?.clue_en || s.english || s.spanish,
              clue_es: data.clues[s.id]?.clue_es || s.spanish,
            }));
            const merged = apply(prev.slots);
            return {
              ...prev,
              slots: merged,
              across: merged.filter(s => s.dir === 'A').sort((a, b) => a.number - b.number),
              down:   merged.filter(s => s.dir === 'D').sort((a, b) => a.number - b.number),
            };
          });
        } else {
          fallbackClues();
        }
      } catch {
        fallbackClues();
      } finally {
        setCluesLoading(false);
      }
    } catch (e) {
      setError(e.message || 'Could not generate puzzle — please try again.');
      console.error(e);
      setLoading(false); setLoadMsg('');
    }
  };

  // If the clue API is unavailable, fall back to using the English gloss
  // (or the word itself) so the puzzle is still playable.
  const fallbackClues = () => {
    setPuzzle(prev => {
      if (!prev) return prev;
      const apply = sl => sl.map(s => ({
        ...s,
        clue_en: s.english || `(${s.spanish})`,
        clue_es: s.spanish,
      }));
      const merged = apply(prev.slots);
      return {
        ...prev,
        slots: merged,
        across: merged.filter(s => s.dir === 'A').sort((a, b) => a.number - b.number),
        down:   merged.filter(s => s.dir === 'D').sort((a, b) => a.number - b.number),
      };
    });
  };

  // ── Interaction ───────────────────────────────────────────────
  const handleTap = (r, c) => {
    if (!puzzle || puzzle.template[r][c] === 1) return;
    setHintText(''); setPeekEN(false);
    const hasA = puzzle.slots.some(s => s.dir === 'A' && inSlot(s, r, c));
    const hasD = puzzle.slots.some(s => s.dir === 'D' && inSlot(s, r, c));
    if (sel.r === r && sel.c === c && hasA && hasD) {
      setSel(s => ({ ...s, dir: s.dir === 'A' ? 'D' : 'A' }));
    } else {
      const keepDir = (sel.dir === 'A' && hasA) || (sel.dir === 'D' && hasD);
      setSel({ r, c, dir: keepDir ? sel.dir : (hasA ? 'A' : 'D') });
    }
    inputRef.current?.focus();
  };

  // Is every cell of a slot filled in the given grid?
  const isSlotFilled = (s, grid) => {
    for (let i = 0; i < s.length; i++) {
      const r = s.dir === 'A' ? s.row : s.row + i;
      const c = s.dir === 'A' ? s.col + i : s.col;
      if (!grid[r]?.[c]) return false;
    }
    return true;
  };

  // Find the next empty cell within a slot, starting at fromIdx.
  // Wraps to the start of the word so a late gap still gets filled.
  const nextEmptyInSlot = (s, grid, fromIdx) => {
    for (let i = fromIdx; i < s.length; i++) {
      const r = s.dir === 'A' ? s.row : s.row + i;
      const c = s.dir === 'A' ? s.col + i : s.col;
      if (!grid[r]?.[c]) return i;
    }
    for (let i = 0; i < fromIdx; i++) {
      const r = s.dir === 'A' ? s.row : s.row + i;
      const c = s.dir === 'A' ? s.col + i : s.col;
      if (!grid[r]?.[c]) return i;
    }
    return -1; // word is full
  };

  // Ordered list of all slots: across (by number) then down (by number).
  const orderedSlots = () => [
    ...puzzle.across,
    ...puzzle.down,
  ];

  // Find the next slot after the current one that still has empty cells.
  // Wraps around. Returns null if every slot is complete.
  const nextIncompleteSlot = (current, grid) => {
    const all = orderedSlots();
    const startIdx = all.findIndex(s => s.id === current.id);
    for (let k = 1; k <= all.length; k++) {
      const cand = all[(startIdx + k) % all.length];
      if (!isSlotFilled(cand, grid)) return cand;
    }
    return null;
  };

  // Move the cursor to the first empty cell of a slot (or its start).
  const goToSlot = (s, grid) => {
    setPeekEN(false); // new word → English peek resets
    setActiveTab(s.dir); // keep the clue list showing the active direction
    const idx = Math.max(0, nextEmptyInSlot(s, grid, 0));
    const r = s.dir === 'A' ? s.row : s.row + idx;
    const c = s.dir === 'A' ? s.col + idx : s.col;
    setSel({ r, c, dir: s.dir });
  };

  const enterLetter = ch => {
    if (!selectedSlot || sel.r === null) return;
    const s = selectedSlot;
    const ng = userGrid.map(r => [...r]);
    ng[sel.r][sel.c] = ch;
    setUserGrid(ng); setChecked(false);
    setPeekEN(false); // a fresh letter dismisses the English peek

    if (isPuzzleComplete(puzzle.solution, ng)) { setCompleted(true); return; }

    const idx = s.dir === 'A' ? sel.c - s.col : sel.r - s.row;

    // If this letter completed the word, jump to the next incomplete clue.
    if (isSlotFilled(s, ng)) {
      const next = nextIncompleteSlot(s, ng);
      if (next) goToSlot(next, ng);
      return;
    }

    // Otherwise advance to the next EMPTY cell in this word (skip filled).
    const nextIdx = nextEmptyInSlot(s, ng, idx + 1);
    if (nextIdx !== -1) {
      const r = s.dir === 'A' ? s.row : s.row + nextIdx;
      const c = s.dir === 'A' ? s.col + nextIdx : s.col;
      setSel(x => ({ ...x, r, c }));
    }
  };

  const deleteLetter = () => {
    if (!selectedSlot || sel.r === null) return;
    const s = selectedSlot;
    const ng = userGrid.map(r => [...r]);
    if (ng[sel.r][sel.c] !== '') { ng[sel.r][sel.c] = ''; setUserGrid(ng); }
    else {
      const idx = s.dir === 'A' ? sel.c - s.col : sel.r - s.row;
      if (idx > 0) {
        const nr = s.dir === 'A' ? sel.r : s.row + idx - 1;
        const nc = s.dir === 'A' ? s.col + idx - 1 : sel.c;
        ng[nr][nc] = ''; setUserGrid(ng); setSel(x => ({ ...x, r: nr, c: nc }));
      }
    }
  };

  const revealWord = () => {
    if (!selectedSlot) return;
    const s = selectedSlot;
    const newRev = new Set(revealed);
    const ng = userGrid.map(r => [...r]);
    for (let i = 0; i < s.length; i++) {
      const r = s.dir === 'A' ? s.row : s.row + i;
      const c = s.dir === 'A' ? s.col + i : s.col;
      newRev.add(`${r},${c}`);
      ng[r][c] = (puzzle.solution[r][c] || '?').toUpperCase();
    }
    setRevealed(newRev); setUserGrid(ng);
    if (isPuzzleComplete(puzzle.solution, ng)) setCompleted(true);
  };

  // Step to the next / previous clue in reading order (across then down).
  const stepClue = (dir) => {
    if (!puzzle || !selectedSlot) return;
    const all = orderedSlots();
    const i = all.findIndex(s => s.id === selectedSlot.id);
    if (i === -1) return;
    const next = all[(i + (dir === 'next' ? 1 : -1) + all.length) % all.length];
    goToSlot(next, userGrid);
    inputRef.current?.focus();
  };

  // Flip across/down on the current cell, if it belongs to both.
  const toggleDirection = () => {
    if (sel.r === null) return;
    const hasA = puzzle.slots.some(s => s.dir === 'A' && inSlot(s, sel.r, sel.c));
    const hasD = puzzle.slots.some(s => s.dir === 'D' && inSlot(s, sel.r, sel.c));
    if (hasA && hasD) { setPeekEN(false); setSel(s => ({ ...s, dir: s.dir === 'A' ? 'D' : 'A' })); }
  };

  // Move one cell in an arrow direction, staying on white cells.
  const moveCursor = (dr, dc) => {
    if (sel.r === null) return;
    let r = sel.r + dr, c = sel.c + dc;
    while (r >= 0 && r < GS && c >= 0 && c < GS) {
      if (puzzle.template[r][c] === 0) {
        const dir = dr !== 0 ? 'D' : 'A';
        const hasDir = puzzle.slots.some(s => s.dir === dir && inSlot(s, r, c));
        setPeekEN(false);
        setSel({ r, c, dir: hasDir ? dir : sel.dir });
        return;
      }
      r += dr; c += dc;
    }
  };

  const handleKeyDown = (e) => {
    if (!puzzle) return;
    switch (e.key) {
      case 'Backspace': e.preventDefault(); deleteLetter(); break;
      case ' ':         e.preventDefault(); toggleDirection(); break;
      case 'Tab':       e.preventDefault(); stepClue(e.shiftKey ? 'prev' : 'next'); break;
      case 'ArrowUp':   e.preventDefault(); moveCursor(-1, 0); break;
      case 'ArrowDown': e.preventDefault(); moveCursor(1, 0); break;
      case 'ArrowLeft': e.preventDefault(); moveCursor(0, -1); break;
      case 'ArrowRight':e.preventDefault(); moveCursor(0, 1); break;
      default: break;
    }
  };

  const getHint = async () => {
    if (!selectedSlot || hintLoading) return;
    setHintLoading(true);
    try {
      const res = await fetch('/api/hint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word: selectedSlot.key, clue_en: selectedSlot.clue_en, clue_es: selectedSlot.clue_es, language: 'ES' }),
      });
      const data = await res.json();
      setHintText(data.hint || '');
      setTimeout(() => setHintText(''), 7000);
    } catch { setHintText('No hint available.'); }
    finally { setHintLoading(false); }
  };

  // ── Cell color ────────────────────────────────────────────────
  const cellBg = (r, c) => {
    if (!puzzle || puzzle.template[r][c] === 1) return T.black;
    const key = `${r},${c}`, isSel = sel.r === r && sel.c === c;
    const isWord = inSlot(selectedSlot, r, c);
    const letter = userGrid?.[r]?.[c] ?? '';
    const correct = puzzle.solution[r][c] === letter.toLowerCase();
    if (isSel)                        return T.cellSel;
    if (isWord)                       return T.cellWord;
    if (revealed.has(key))            return T.cellHint;
    if (checked && letter && correct) return T.cellOk;
    if (checked && letter)            return T.cellBad;
    return T.cellBg;
  };

  // ── Banner ────────────────────────────────────────────────────
  const vw = Math.min(typeof window !== 'undefined' ? window.innerWidth : 390, 480);
  const cellPx = Math.floor((vw - 16) / GS);

  // Spanish is the default. The English clue shows only while peeking on
  // this word (a deliberate, per-word assist that resets on clue change).
  const showingEN   = peekEN;
  const bannerClue  = hintText || (selectedSlot ? (showingEN ? selectedSlot.clue_en : selectedSlot.clue_es) : null);
  const bannerLabel = hintText ? '💡 Hint' : selectedSlot ? `${selectedSlot.number} ${selectedSlot.dir === 'A' ? 'Across' : 'Down'}` : null;
  const hasEnglish  = selectedSlot && selectedSlot.clue_en && selectedSlot.clue_en !== '…';

  // ── Render ────────────────────────────────────────────────────
  return (
    <div style={{ minHeight:'100dvh', background:T.bg, color:T.text, fontFamily:"'Georgia', serif", display:'flex', flexDirection:'column', maxWidth:480, margin:'0 auto' }}>

      {/* Keyboard capture */}
      <input ref={inputRef} type="text" inputMode="text" autoCapitalize="characters" autoCorrect="off" autoComplete="off" spellCheck={false}
        value={inputVal}
        onChange={e => { const ch=e.target.value.slice(-1).toUpperCase(); if (/[A-Z]/.test(ch)) enterLetter(ch); setInputVal(''); }}
        onKeyDown={handleKeyDown}
        style={{ position:'fixed', top:0, left:0, width:1, height:1, opacity:0.01, fontSize:16, border:'none', padding:0, pointerEvents:'none' }}
      />

      {/* ── Header ── */}
      <div style={{ padding:'10px 14px 8px', background:T.surface, borderBottom:`1px solid ${T.border}`, display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
        <div>
          <div style={{ fontSize:19, fontWeight:700 }}>🧩 El Crucigrama</div>
          <div style={{ fontSize:11, color:T.muted, fontFamily:'sans-serif' }}>Spanish Vocabulary Crossword</div>
        </div>
      </div>

      {/* ── Clue banner ── */}
      <div style={{ minHeight:56, padding:'8px 10px', background:T.card, borderBottom:`1px solid ${T.border}`, display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
        {bannerClue ? (
          <>
            {/* Prev clue */}
            <button onClick={() => stepClue('prev')} aria-label="Previous clue"
              style={{ flexShrink:0, background:'none', border:'none', color:T.muted, fontSize:22, lineHeight:1, cursor:'pointer', padding:'0 4px' }}>‹</button>

            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ color:T.accent, fontWeight:700, fontSize:11, fontFamily:'sans-serif', marginBottom:1 }}>{bannerLabel}{showingEN && !hintText ? ' · EN' : ''}</div>
              <div style={{ fontSize:14, lineHeight:1.35 }}>{bannerClue}</div>
            </div>

            {/* English peek — Spanish-first, tap to reveal English for this word */}
            {!hintText && hasEnglish && (
              <button onClick={() => setPeekEN(p => !p)} aria-label="Toggle English hint"
                style={{ flexShrink:0, background:peekEN?T.accent:T.surface, color:peekEN?T.black:T.muted, border:`1px solid ${T.border}`, borderRadius:12, padding:'5px 10px', fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'sans-serif', whiteSpace:'nowrap' }}>
                {peekEN ? 'Hide' : 'EN hint'}
              </button>
            )}

            {/* Next clue */}
            <button onClick={() => stepClue('next')} aria-label="Next clue"
              style={{ flexShrink:0, background:'none', border:'none', color:T.muted, fontSize:22, lineHeight:1, cursor:'pointer', padding:'0 4px' }}>›</button>
          </>
        ) : (
          <span style={{ color:T.muted, fontSize:13, fontFamily:'sans-serif', padding:'0 4px' }}>
            {puzzle ? 'Tap a cell to begin' : 'Generate a puzzle to start playing'}
          </span>
        )}
      </div>

      {/* ── Grid ── */}
      <div style={{ padding:8, display:'flex', justifyContent:'center', flexShrink:0 }}>
        {loading ? (
          <div style={{ padding:'44px 0', textAlign:'center', width:'100%' }}>
            <div style={{ fontSize:32, marginBottom:10 }}>⏳</div>
            <div style={{ color:T.muted, fontSize:13, fontFamily:'sans-serif' }}>{loadMsg || 'Building puzzle…'}</div>
          </div>
        ) : !puzzle ? (
          <div style={{ padding:'36px 16px', textAlign:'center', width:'100%' }}>
            <div style={{ fontSize:48, marginBottom:14 }}>🧩</div>
            <div style={{ fontSize:17, marginBottom:6 }}>¡Hola! Ready to practice?</div>
            <div style={{ color:T.muted, fontSize:13, fontFamily:'sans-serif', marginBottom:22, lineHeight:1.6 }}>
              Generate a puzzle from your vocabulary list
            </div>
            <button onClick={generatePuzzle} style={bigBtnStyle}>Generate Puzzle</button>
            {error && <div style={{ marginTop:14, color:T.red, fontSize:13, fontFamily:'sans-serif' }}>{error}</div>}
          </div>
        ) : (
          <div style={{ lineHeight:0, border:`2px solid ${T.border}` }}>
            {puzzle.template.map((row, r) => (
              <div key={r} style={{ display:'flex' }}>
                {row.map((cell, c) => {
                  const isBlack = cell === 1;
                  const num = puzzle.cellNums[`${r},${c}`];
                  const letter = userGrid?.[r]?.[c] ?? '';
                  return (
                    <div key={c} onClick={() => handleTap(r, c)} style={{ width:cellPx, height:cellPx, background:cellBg(r,c), borderRight:`1px solid ${isBlack?'#000':'#ccc'}`, borderBottom:`1px solid ${isBlack?'#000':'#ccc'}`, boxSizing:'border-box', position:'relative', cursor:isBlack?'default':'pointer', userSelect:'none', WebkitUserSelect:'none', flexShrink:0 }}>
                      {!isBlack && (
                        <>
                          {num && <span style={{ position:'absolute', top:1, left:1, fontSize:Math.max(7,Math.floor(cellPx*0.23)), lineHeight:1, color:'#555', fontFamily:'sans-serif', fontWeight:500, pointerEvents:'none' }}>{num}</span>}
                          {letter && <span style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:Math.max(12,Math.floor(cellPx*0.55)), fontWeight:700, color:'#111', fontFamily:'sans-serif', pointerEvents:'none' }}>{letter}</span>}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Actions ── */}
      {puzzle && !loading && (
        <div style={{ display:'flex', gap:8, padding:'8px 12px', borderTop:`1px solid ${T.border}`, background:T.surface, flexShrink:0, justifyContent:'center', flexWrap:'wrap' }}>
          <Btn onClick={() => setChecked(true)}>✓ Check</Btn>
          <Btn onClick={getHint} disabled={hintLoading}>{hintLoading ? '…' : '💡 Hint'}</Btn>
          <Btn onClick={revealWord}>👁 Reveal</Btn>
          <Btn onClick={generatePuzzle}>🔄 New</Btn>
        </div>
      )}

      {/* ── Clue lists ── */}
      {puzzle && !loading && (
        <div style={{ flex:1, overflowY:'auto', paddingBottom:20 }}>
          {cluesLoading && (
            <div style={{ padding:'7px 14px', background:T.card, borderBottom:`1px solid ${T.border}`, fontSize:12, color:T.muted, fontFamily:'sans-serif', display:'flex', alignItems:'center', gap:8 }}>
              <span>✍️ Writing clues…</span>
              <span style={{ fontSize:11 }}>the grid is ready to solve now</span>
            </div>
          )}
          <div style={{ display:'flex', background:T.surface, borderBottom:`1px solid ${T.border}` }}>
            {['A','D'].map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{ flex:1, padding:'10px 0', background:'transparent', border:'none', borderBottom:`2px solid ${activeTab===tab?T.accent:'transparent'}`, color:activeTab===tab?T.accent:T.muted, cursor:'pointer', fontFamily:'sans-serif', fontSize:13, fontWeight:activeTab===tab?700:400 }}>
                {tab==='A'?'→ Across':'↓ Down'}
              </button>
            ))}
          </div>
          {(activeTab==='A'?puzzle.across:puzzle.down).map(s => {
            const isActive = selectedSlot===s;
            const done = userGrid && isSlotFilled(s, userGrid);
            return (
              <div key={s.id} onClick={() => { goToSlot(s, userGrid); inputRef.current?.focus(); }}
                style={{ padding:'9px 14px', display:'flex', gap:10, alignItems:'flex-start', background:isActive?T.card:'transparent', borderLeft:`3px solid ${isActive?T.accent:'transparent'}`, borderBottom:`1px solid ${T.border}`, cursor:'pointer', opacity:done && !isActive ? 0.45 : 1 }}>
                <span style={{ color:T.accent, fontWeight:700, fontSize:13, minWidth:22, flexShrink:0, fontFamily:'sans-serif' }}>{s.number}</span>
                <span style={{ fontSize:14, lineHeight:1.4, textDecoration:done?'line-through':'none', textDecorationColor:T.muted }}>{s.clue_es}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Success overlay ── */}
      {completed && (
        <div style={{ position:'fixed', inset:0, zIndex:200, background:'rgba(0,0,0,0.88)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:32 }}>
          <div style={{ fontSize:72, marginBottom:8 }}>🎉</div>
          <div style={{ fontSize:32, fontWeight:700, color:T.accent, marginBottom:8 }}>¡Lo lograste!</div>
          <div style={{ fontSize:15, color:T.text, marginBottom:4 }}>You solved the puzzle!</div>
          <div style={{ fontSize:13, color:T.muted, fontFamily:'sans-serif', marginBottom:36 }}>
            {puzzle.slots.length} words completed
          </div>
          <button onClick={generatePuzzle} style={{ ...bigBtnStyle, fontSize:17, padding:'14px 40px' }}>New Puzzle</button>
          <button onClick={() => setCompleted(false)} style={{ marginTop:16, background:'none', border:'none', color:T.muted, fontSize:13, cursor:'pointer', fontFamily:'sans-serif' }}>
            Keep looking at this one
          </button>
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────
function isPuzzleComplete(solution, userGrid) {
  if (!solution || !userGrid) return false;
  for (let r = 0; r < GS; r++)
    for (let c = 0; c < GS; c++) {
      if (solution[r][c] === null) continue;
      if (!userGrid[r][c] || solution[r][c] !== userGrid[r][c].toLowerCase()) return false;
    }
  return true;
}

const Btn = ({ onClick, children, disabled }) => (
  <button onClick={onClick} disabled={disabled} style={{ background:T.card, color:disabled?T.muted:T.text, border:`1px solid ${T.border}`, borderRadius:20, padding:'7px 14px', fontSize:13, cursor:disabled?'default':'pointer', fontFamily:'sans-serif', WebkitTapHighlightColor:'transparent' }}>
    {children}
  </button>
);

const bigBtnStyle = {
  background:T.accent, color:'#111', border:'none', borderRadius:10,
  padding:'13px 36px', fontSize:16, fontWeight:700, cursor:'pointer',
  fontFamily:'sans-serif', WebkitTapHighlightColor:'transparent',
};
