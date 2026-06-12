import { useState, useRef } from 'react';

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

// ── 9×9 Templates (0=white, 1=black, all 180° rotationally symmetric) ──
const TEMPLATES = [
  // T1 — Classic: two corner clusters, open rows
  [ [0,0,0,1,0,0,0,0,0],
    [0,0,0,1,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [1,1,1,0,0,0,0,0,0],
    [0,0,0,0,1,0,0,0,0],
    [0,0,0,0,0,0,1,1,1],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,1,0,0,0],
    [0,0,0,0,0,1,0,0,0] ],
  // T2 — T1 flipped L-R
  [ [0,0,0,0,0,1,0,0,0],
    [0,0,0,0,0,1,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,1,1,1],
    [0,0,0,0,1,0,0,0,0],
    [1,1,1,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,1,0,0,0,0,0],
    [0,0,0,1,0,0,0,0,0] ],
  // T3 — Diamond: edge walls, open diagonals
  [ [0,0,0,0,1,0,0,0,0],
    [0,0,0,1,0,1,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [1,0,0,0,0,0,0,0,1],
    [1,0,0,0,1,0,0,0,1],
    [1,0,0,0,0,0,0,0,1],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,1,0,1,0,0,0],
    [0,0,0,0,1,0,0,0,0] ],
  // T4 — T1 rotated 90°
  [ [0,0,0,0,0,1,0,0,0],
    [0,0,0,0,0,1,0,0,0],
    [0,0,0,0,0,1,0,0,0],
    [0,0,0,0,0,0,0,1,1],
    [0,0,0,0,1,0,0,0,0],
    [1,1,0,0,0,0,0,0,0],
    [0,0,0,1,0,0,0,0,0],
    [0,0,0,1,0,0,0,0,0],
    [0,0,0,1,0,0,0,0,0] ],
];

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

function computeCrossings(slots) {
  const crossings = [];
  const aSlots = slots.filter(s => s.dir === 'A');
  const dSlots = slots.filter(s => s.dir === 'D');
  for (const a of aSlots) {
    for (const d of dSlots) {
      if (d.col >= a.col && d.col < a.col + a.length &&
          a.row >= d.row && a.row < d.row + d.length) {
        crossings.push({
          aId: a.id, aPos: d.col - a.col,
          dId: d.id, dPos: a.row - d.row,
          row: a.row, col: d.col,
        });
      }
    }
  }
  return crossings;
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

function countViolations(crossings, words) {
  let n = 0;
  for (const c of crossings) {
    const a = (words[c.aId]?.key || '')[c.aPos];
    const d = (words[c.dId]?.key || '')[c.dPos];
    if (a && d && a !== d) n++;
  }
  return n;
}

// ── CSV Parsing ───────────────────────────────────────────────
function parseCSVLine(line) {
  const cols = []; let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
    else { cur += ch; }
  }
  cols.push(cur.trim());
  return cols;
}

const stripAccents = s =>
  s.toLowerCase().replace(/[áàâä]/g,'a').replace(/[éèêë]/g,'e').replace(/[íìîï]/g,'i').replace(/[óòôö]/g,'o').replace(/[úùûü]/g,'u').replace(/ñ/g,'n').replace(/[^a-z]/g,'');

function parseVocabCSV(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return { words: [], error: 'File appears empty' };
  const headers = parseCSVLine(lines[0]).map(h => h.trim());
  const spanishIdx = headers.findIndex(h => /^(spanish\s*(phrase|word|marker)|infinitive|interrogative)/i.test(h));
  const englishIdx = headers.findIndex(h => /english/i.test(h));
  const defIdx     = headers.findIndex(h => /spanish\s*definition/i.test(h));
  if (spanishIdx === -1 || englishIdx === -1) return { words: [], error: `Could not detect columns. Found: ${headers.slice(0,4).join(', ')}` };
  const seen = new Set(); const words = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const spanish = cols[spanishIdx]?.trim(), english = cols[englishIdx]?.trim();
    const definition = defIdx >= 0 ? cols[defIdx]?.trim() : '';
    if (!spanish || !english) continue;
    const key = stripAccents(spanish);
    if (key.length < 3 || key.length > 9 || key.includes(' ') || seen.has(key)) continue;
    seen.add(key); words.push({ spanish, english, definition });
  }
  return { words, error: '' };
}

// ── App ───────────────────────────────────────────────────────
export default function App() {
  const [puzzle,      setPuzzle]      = useState(null);
  const [userGrid,    setUserGrid]    = useState(null);
  const [sel,         setSel]         = useState({ r: null, c: null, dir: 'A' });
  const [clueMode,    setClueMode]    = useState('EN');
  const [peekEN,      setPeekEN]      = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [loadMsg,     setLoadMsg]     = useState('');
  const [error,       setError]       = useState('');
  const [checked,     setChecked]     = useState(false);
  const [revealed,    setRevealed]    = useState(new Set());
  const [inputVal,    setInputVal]    = useState('');
  const [activeTab,   setActiveTab]   = useState('A');
  const [csvWords,    setCsvWords]    = useState([]);
  const [csvStatus,   setCsvStatus]   = useState('');
  const [hintText,    setHintText]    = useState('');
  const [hintLoading, setHintLoading] = useState(false);
  const [completed,   setCompleted]   = useState(false);

  const inputRef = useRef(null);
  const fileRef  = useRef(null);

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

  // ── CSV ──────────────────────────────────────────────────────
  const handleCSV = e => {
    const file = e.target.files?.[0]; if (!file) return; e.target.value = '';
    const reader = new FileReader();
    reader.onload = ev => {
      const { words, error: parseErr } = parseVocabCSV(ev.target.result);
      if (parseErr) { setCsvStatus(`⚠️ ${parseErr}`); setTimeout(() => setCsvStatus(''), 5000); return; }
      setCsvWords(prev => {
        const existing = new Set(prev.map(w => stripAccents(w.spanish)));
        const newWords = words.filter(w => !existing.has(stripAccents(w.spanish)));
        const total = prev.length + newWords.length;
        setCsvStatus(`✓ ${newWords.length} added · ${total} total`);
        setTimeout(() => setCsvStatus(''), 4000);
        return [...prev, ...newWords];
      });
    };
    reader.readAsText(file);
  };

  // ── Generate ─────────────────────────────────────────────────
  const generatePuzzle = async () => {
    setLoading(true); setLoadMsg('Picking template…');
    setError(''); setChecked(false); setRevealed(new Set());
    setHintText(''); setPeekEN(false); setCompleted(false);
    setPuzzle(null); setUserGrid(null);

    try {
      // Pick random template
      const template = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
      const { slots, cellNums, across, down } = computeSlots(template);
      const crossings = computeCrossings(slots);

      setLoadMsg('Generating Spanish words…');

      // Call API (up to 2 attempts)
      let words = null;
      let violations = Infinity;

      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) setLoadMsg('Refining the grid…');
        const res = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slots, crossings, csvWords }),
        });
        const data = await res.json();
        if (!data.words) throw new Error('No words in response');

        // Normalize keys (strip accents)
        const normalized = {};
        for (const [id, w] of Object.entries(data.words)) {
          normalized[id] = {
            ...w,
            key: stripAccents(w.key || w.spanish || ''),
          };
        }

        const v = countViolations(crossings, normalized);
        if (v < violations) { violations = v; words = normalized; }
        if (violations === 0) break;
      }

      if (!words) throw new Error('Could not generate puzzle');

      setLoadMsg('Building grid…');

      // Attach clues to slots
      const enrichedSlots = slots.map(s => ({
        ...s,
        clue_en:  words[s.id]?.clue_en || '—',
        clue_es:  words[s.id]?.clue_es || '—',
        spanish:  words[s.id]?.spanish || words[s.id]?.key || '',
        key:      words[s.id]?.key || '',
      }));

      const solution = buildSolutionGrid(template, enrichedSlots, words);

      const enrichedAcross = enrichedSlots.filter(s => s.dir === 'A').sort((a,b) => a.number - b.number);
      const enrichedDown   = enrichedSlots.filter(s => s.dir === 'D').sort((a,b) => a.number - b.number);

      setPuzzle({ template, solution, slots: enrichedSlots, cellNums, across: enrichedAcross, down: enrichedDown, violations });
      setUserGrid(Array(GS).fill(null).map(() => Array(GS).fill('')));

      const first = enrichedAcross[0] ?? enrichedDown[0];
      if (first) setSel({ r: first.row, c: first.col, dir: first.dir });
      setActiveTab(enrichedAcross.length ? 'A' : 'D');
    } catch (e) {
      setError('Could not generate puzzle — please try again.');
      console.error(e);
    } finally {
      setLoading(false); setLoadMsg('');
    }
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

  const enterLetter = ch => {
    if (!selectedSlot || sel.r === null) return;
    const s = selectedSlot;
    const ng = userGrid.map(r => [...r]);
    ng[sel.r][sel.c] = ch;
    setUserGrid(ng); setChecked(false);
    if (isPuzzleComplete(puzzle.solution, ng)) setCompleted(true);
    const idx = s.dir === 'A' ? sel.c - s.col : sel.r - s.row;
    if (idx < s.length - 1) {
      if (s.dir === 'A') setSel(x => ({ ...x, c: s.col + idx + 1 }));
      else               setSel(x => ({ ...x, r: s.row + idx + 1 }));
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

  const getHint = async () => {
    if (!selectedSlot || hintLoading) return;
    setHintLoading(true);
    try {
      const res = await fetch('/api/hint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word: selectedSlot.key, clue_en: selectedSlot.clue_en, clue_es: selectedSlot.clue_es, language: clueMode }),
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

  const showingEN   = clueMode === 'EN' || peekEN;
  const bannerClue  = hintText || (selectedSlot ? (showingEN ? selectedSlot.clue_en : selectedSlot.clue_es) : null);
  const bannerLabel = hintText ? '💡 Hint' : selectedSlot ? `${selectedSlot.number} ${selectedSlot.dir === 'A' ? 'Across' : 'Down'}` : null;

  // ── Render ────────────────────────────────────────────────────
  return (
    <div style={{ minHeight:'100dvh', background:T.bg, color:T.text, fontFamily:"'Georgia', serif", display:'flex', flexDirection:'column', maxWidth:480, margin:'0 auto' }}>

      {/* Keyboard capture */}
      <input ref={inputRef} type="text" inputMode="text" autoCapitalize="characters" autoCorrect="off" autoComplete="off" spellCheck={false}
        value={inputVal}
        onChange={e => { const ch=e.target.value.slice(-1).toUpperCase(); if (/[A-Z]/.test(ch)) enterLetter(ch); setInputVal(''); }}
        onKeyDown={e => { if (e.key==='Backspace') { e.preventDefault(); deleteLetter(); } }}
        style={{ position:'fixed', top:0, left:0, width:1, height:1, opacity:0.01, fontSize:16, border:'none', padding:0, pointerEvents:'none' }}
      />

      {/* ── Header ── */}
      <div style={{ padding:'10px 14px 8px', background:T.surface, borderBottom:`1px solid ${T.border}`, display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
        <div>
          <div style={{ fontSize:19, fontWeight:700 }}>🧩 El Crucigrama</div>
          <div style={{ fontSize:11, color:T.muted, fontFamily:'sans-serif' }}>Spanish Vocabulary Crossword</div>
        </div>
        <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap', justifyContent:'flex-end' }}>
          <Btn onClick={() => { setClueMode(m => m==='EN'?'ES':'EN'); setPeekEN(false); }}>
            {clueMode === 'EN' ? '🇺🇸 EN' : '🇲🇽 ES'}
          </Btn>
          <Btn onClick={() => fileRef.current?.click()}>
            {csvWords.length ? `📋 ${csvWords.length}w` : '📤 CSV'}
          </Btn>
          {csvWords.length > 0 && (
            <button onClick={() => { setCsvWords([]); setCsvStatus('Cleared'); setTimeout(()=>setCsvStatus(''),2000); }}
              style={{ background:'none', border:'none', color:T.muted, cursor:'pointer', fontSize:16, padding:'4px 2px' }}>✕</button>
          )}
          <input ref={fileRef} type="file" accept=".csv" onChange={handleCSV} style={{ display:'none' }} />
        </div>
      </div>

      {/* CSV status */}
      {csvStatus && (
        <div style={{ padding:'6px 14px', background:csvStatus.startsWith('⚠️')?'#3a1a1a':'#1a3a1a', borderBottom:`1px solid ${T.border}`, fontSize:12, fontFamily:'sans-serif', color:csvStatus.startsWith('⚠️')?'#ffa0a0':'#a0ffa0', flexShrink:0 }}>
          {csvStatus}
        </div>
      )}

      {/* ── Clue banner ── */}
      <div style={{ minHeight:56, padding:'8px 14px', background:T.card, borderBottom:`1px solid ${T.border}`, display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
        {bannerClue ? (
          <>
            <span style={{ color:T.accent, fontWeight:700, fontSize:12, flexShrink:0, fontFamily:'sans-serif', minWidth:58 }}>{bannerLabel}</span>
            <span style={{ fontSize:14, lineHeight:1.4, flex:1 }}>{bannerClue}</span>
            {clueMode === 'ES' && !hintText && selectedSlot && (
              <button onClick={() => setPeekEN(p => !p)} style={{ flexShrink:0, background:peekEN?T.accent:T.surface, color:peekEN?T.black:T.muted, border:`1px solid ${T.border}`, borderRadius:12, padding:'4px 9px', fontSize:11, cursor:'pointer', fontFamily:'sans-serif', whiteSpace:'nowrap' }}>
                {peekEN ? '🇲🇽 ES' : '🇺🇸 EN?'}
              </button>
            )}
          </>
        ) : (
          <span style={{ color:T.muted, fontSize:13, fontFamily:'sans-serif' }}>
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
              {csvWords.length ? `${csvWords.length} words from your vocab list` : 'Upload your CSV or use default beginner vocabulary'}
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
          <div style={{ display:'flex', background:T.surface, borderBottom:`1px solid ${T.border}` }}>
            {['A','D'].map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{ flex:1, padding:'10px 0', background:'transparent', border:'none', borderBottom:`2px solid ${activeTab===tab?T.accent:'transparent'}`, color:activeTab===tab?T.accent:T.muted, cursor:'pointer', fontFamily:'sans-serif', fontSize:13, fontWeight:activeTab===tab?700:400 }}>
                {tab==='A'?'→ Across':'↓ Down'}
              </button>
            ))}
          </div>
          {(activeTab==='A'?puzzle.across:puzzle.down).map(s => {
            const isActive = selectedSlot===s;
            return (
              <div key={s.id} onClick={() => { setSel({r:s.row,c:s.col,dir:s.dir}); inputRef.current?.focus(); }}
                style={{ padding:'9px 14px', display:'flex', gap:10, alignItems:'flex-start', background:isActive?T.card:'transparent', borderLeft:`3px solid ${isActive?T.accent:'transparent'}`, borderBottom:`1px solid ${T.border}`, cursor:'pointer' }}>
                <span style={{ color:T.accent, fontWeight:700, fontSize:13, minWidth:22, flexShrink:0, fontFamily:'sans-serif' }}>{s.number}</span>
                <span style={{ fontSize:14, lineHeight:1.4 }}>{clueMode==='EN'?s.clue_en:s.clue_es}</span>
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
