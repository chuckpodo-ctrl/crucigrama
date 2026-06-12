import { useState, useRef } from 'react';

// ── Color Tokens ──────────────────────────────────────────────
const T = {
  bg:       '#0f1117',
  surface:  '#1a1d27',
  card:     '#22263a',
  border:   '#2e3147',
  accent:   '#e8aa3e',
  text:     '#f0ede8',
  muted:    '#8a8fa8',
  cellBg:   '#f5f2ec',
  cellSel:  '#f9d423',
  cellWord: '#fdf0b0',
  cellOk:   '#b7e4c7',
  cellBad:  '#ffc4c4',
  cellHint: '#d0b8ff',
  black:    '#111',
  red:      '#c0392b',
};

const GS = 13;

// ── CSV Parsing ───────────────────────────────────────────────

function parseCSVLine(line) {
  const cols = [];
  let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
    else { cur += ch; }
  }
  cols.push(cur.trim());
  return cols;
}

const stripAccents = s =>
  s.toLowerCase()
   .replace(/[áàâä]/g, 'a').replace(/[éèêë]/g, 'e')
   .replace(/[íìîï]/g, 'i').replace(/[óòôö]/g, 'o')
   .replace(/[úùûü]/g, 'u').replace(/ñ/g, 'n')
   .replace(/[^a-z]/g, '');

function parseVocabCSV(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return { words: [], error: 'File appears empty' };
  const headers = parseCSVLine(lines[0]).map(h => h.trim());
  const spanishIdx = headers.findIndex(h => /^(spanish\s*(phrase|word|marker)|infinitive|interrogative)/i.test(h));
  const englishIdx = headers.findIndex(h => /english/i.test(h));
  const defIdx     = headers.findIndex(h => /spanish\s*definition/i.test(h));
  if (spanishIdx === -1 || englishIdx === -1) return { words: [], error: `Could not detect columns. Found: ${headers.slice(0, 4).join(', ')}` };
  const seen = new Set();
  const words = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const spanish = cols[spanishIdx]?.trim(), english = cols[englishIdx]?.trim();
    const definition = defIdx >= 0 ? cols[defIdx]?.trim() : '';
    if (!spanish || !english) continue;
    const key = stripAccents(spanish);
    if (key.length < 3 || key.length > 12 || key.includes(' ') || seen.has(key)) continue;
    seen.add(key);
    words.push({ spanish, english, definition });
  }
  return { words, error: '' };
}

// ── Crossword Placement ───────────────────────────────────────

const emptyGrid = () => Array(GS).fill(null).map(() => Array(GS).fill(null));

function canPlace(grid, word, r0, c0, dir) {
  const len = word.length;
  if (dir === 'A') {
    if (r0 < 0 || r0 >= GS || c0 < 0 || c0 + len > GS) return false;
    if (c0 > 0 && grid[r0][c0 - 1] !== null) return false;
    if (c0 + len < GS && grid[r0][c0 + len] !== null) return false;
  } else {
    if (c0 < 0 || c0 >= GS || r0 < 0 || r0 + len > GS) return false;
    if (r0 > 0 && grid[r0 - 1][c0] !== null) return false;
    if (r0 + len < GS && grid[r0 + len][c0] !== null) return false;
  }
  let crosses = 0;
  const hasAny = grid.some(row => row.some(c => c !== null));
  for (let i = 0; i < len; i++) {
    const r = dir === 'A' ? r0 : r0 + i, c = dir === 'A' ? c0 + i : c0;
    const cell = grid[r][c];
    if (cell === null) {
      if (dir === 'A') { if ((r > 0 && grid[r-1][c] !== null) || (r < GS-1 && grid[r+1][c] !== null)) return false; }
      else             { if ((c > 0 && grid[r][c-1] !== null) || (c < GS-1 && grid[r][c+1] !== null)) return false; }
    } else if (cell === word[i]) { crosses++; } else { return false; }
  }
  return !hasAny || crosses > 0;
}

function applyWord(grid, word, r0, c0, dir) {
  const g = grid.map(r => [...r]);
  for (let i = 0; i < word.length; i++) { const r = dir==='A'?r0:r0+i, c = dir==='A'?c0+i:c0; g[r][c] = word[i]; }
  return g;
}

function buildPuzzle(rawWords) {
  const words = rawWords.map(w => ({ ...w, key: stripAccents(w.spanish) }))
    .filter(w => w.key.length >= 3 && w.key.length <= 12)
    .sort((a, b) => b.key.length - a.key.length).slice(0, 22);
  if (!words.length) return null;
  let grid = emptyGrid();
  const placed = [];
  const [first, ...rest] = words;
  const r0 = Math.floor(GS/2), c0 = Math.floor((GS - first.key.length)/2);
  grid = applyWord(grid, first.key, r0, c0, 'A');
  placed.push({ ...first, row: r0, col: c0, dir: 'A' });
  for (const w of rest) {
    let bestGrid=null, best=null, bestScore=-Infinity;
    for (let r=0; r<GS; r++) for (let c=0; c<GS; c++) for (const dir of ['D','A']) {
      if (!canPlace(grid, w.key, r, c, dir)) continue;
      let crosses=0;
      for (let i=0; i<w.key.length; i++) { const cr=dir==='A'?r:r+i, cc=dir==='A'?c+i:c; if (grid[cr][cc]!==null) crosses++; }
      const score = crosses*10 - (Math.abs(r-GS/2)+Math.abs(c-GS/2))*0.1;
      if (score>bestScore) { bestScore=score; best={r,c,dir}; bestGrid=applyWord(grid,w.key,r,c,dir); }
    }
    if (best && bestGrid) { grid=bestGrid; placed.push({...w,row:best.r,col:best.c,dir:best.dir}); }
  }
  const cellNums={};
  let num=1;
  for (let r=0; r<GS; r++) for (let c=0; c<GS; c++) {
    const sA=placed.some(w=>w.dir==='A'&&w.row===r&&w.col===c);
    const sD=placed.some(w=>w.dir==='D'&&w.row===r&&w.col===c);
    if (sA||sD) {
      cellNums[`${r},${c}`]=num;
      placed.filter(w=>(w.dir==='A'&&w.row===r&&w.col===c)||(w.dir==='D'&&w.row===r&&w.col===c)).forEach(w=>{w.number=num;});
      num++;
    }
  }
  return { grid, words: placed, across: placed.filter(w=>w.dir==='A').sort((a,b)=>a.number-b.number), down: placed.filter(w=>w.dir==='D').sort((a,b)=>a.number-b.number), cellNums };
}

// ── Completion check ──────────────────────────────────────────

function isPuzzleComplete(puzzle, userGrid) {
  if (!puzzle || !userGrid) return false;
  for (let r = 0; r < GS; r++) {
    for (let c = 0; c < GS; c++) {
      if (puzzle.grid[r][c] === null) continue; // black cell
      const letter = userGrid[r][c];
      if (!letter || puzzle.grid[r][c] !== letter.toLowerCase()) return false;
    }
  }
  return true;
}

// ── App ───────────────────────────────────────────────────────

export default function App() {
  const [puzzle,      setPuzzle]      = useState(null);
  const [userGrid,    setUserGrid]    = useState(null);
  const [sel,         setSel]         = useState({ r: null, c: null, dir: 'A' });
  const [clueMode,    setClueMode]    = useState('EN');
  const [peekEN,      setPeekEN]      = useState(false); // EN clue peek while in ES mode
  const [loading,     setLoading]     = useState(false);
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

  const inWord = (w, r, c) => {
    if (!w) return false;
    return w.dir === 'A' ? w.row === r && c >= w.col && c < w.col + w.key.length
                         : w.col === c && r >= w.row && r < w.row + w.key.length;
  };

  const selectedWord = puzzle?.words.find(w => {
    if (w.dir !== sel.dir || sel.r === null) return false;
    return inWord(w, sel.r, sel.c);
  }) ?? null;

  // ── CSV ──────────────────────────────────────────────────────

  const handleCSV = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
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

  // ── Actions ──────────────────────────────────────────────────

  const generatePuzzle = async () => {
    setLoading(true);
    setError('');
    setChecked(false);
    setRevealed(new Set());
    setHintText('');
    setPeekEN(false);
    setCompleted(false);
    setPuzzle(null);
    setUserGrid(null);
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvWords, count: 25 }),
      });
      const data = await res.json();
      if (!data.words?.length) throw new Error('No words returned');
      const puz = buildPuzzle(data.words);
      if (!puz) throw new Error('Could not arrange puzzle');
      setPuzzle(puz);
      setUserGrid(Array(GS).fill(null).map(() => Array(GS).fill('')));
      const first = puz.across[0] ?? puz.down[0];
      if (first) setSel({ r: first.row, c: first.col, dir: first.dir });
      setActiveTab(puz.across.length ? 'A' : 'D');
    } catch (e) {
      setError('Could not generate puzzle — try again.');
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleTap = (r, c) => {
    if (!puzzle || puzzle.grid[r][c] === null) return;
    setHintText('');
    setPeekEN(false);
    const hasA = puzzle.words.some(w => w.dir === 'A' && inWord(w, r, c));
    const hasD = puzzle.words.some(w => w.dir === 'D' && inWord(w, r, c));
    if (sel.r === r && sel.c === c && hasA && hasD) { setSel(s => ({ ...s, dir: s.dir==='A'?'D':'A' })); }
    else { const keepDir = (sel.dir==='A'&&hasA)||(sel.dir==='D'&&hasD); setSel({ r, c, dir: keepDir?sel.dir:(hasA?'A':'D') }); }
    inputRef.current?.focus();
  };

  const enterLetter = ch => {
    if (!selectedWord || sel.r === null) return;
    const w = selectedWord;
    const ng = userGrid.map(row => [...row]);
    ng[sel.r][sel.c] = ch;
    setUserGrid(ng);
    setChecked(false);

    // Check for puzzle completion
    if (isPuzzleComplete(puzzle, ng)) {
      setCompleted(true);
    }

    // Advance cursor within word
    const idx = w.dir === 'A' ? sel.c - w.col : sel.r - w.row;
    if (idx < w.key.length - 1) {
      if (w.dir === 'A') setSel(s => ({ ...s, c: w.col + idx + 1 }));
      else               setSel(s => ({ ...s, r: w.row + idx + 1 }));
    }
  };

  const deleteLetter = () => {
    if (!selectedWord || sel.r === null) return;
    const w = selectedWord;
    const ng = userGrid.map(row => [...row]);
    if (ng[sel.r][sel.c] !== '') { ng[sel.r][sel.c] = ''; setUserGrid(ng); }
    else {
      const idx = w.dir==='A' ? sel.c-w.col : sel.r-w.row;
      if (idx > 0) {
        const nr = w.dir==='A'?sel.r:w.row+idx-1, nc = w.dir==='A'?w.col+idx-1:sel.c;
        ng[nr][nc] = ''; setUserGrid(ng); setSel(s => ({ ...s, r: nr, c: nc }));
      }
    }
  };

  const revealWord = () => {
    if (!selectedWord) return;
    const w = selectedWord;
    const newRev = new Set(revealed);
    const ng = userGrid.map(row => [...row]);
    for (let i = 0; i < w.key.length; i++) {
      const r = w.dir==='A'?w.row:w.row+i, c = w.dir==='A'?w.col+i:w.col;
      newRev.add(`${r},${c}`);
      ng[r][c] = w.key[i].toUpperCase();
    }
    setRevealed(newRev);
    setUserGrid(ng);
    if (isPuzzleComplete(puzzle, ng)) setCompleted(true);
  };

  const getHint = async () => {
    if (!selectedWord || hintLoading) return;
    setHintLoading(true);
    try {
      const res = await fetch('/api/hint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word: selectedWord.key, clue_en: selectedWord.clue_en, clue_es: selectedWord.clue_es, language: clueMode }),
      });
      const data = await res.json();
      setHintText(data.hint || '');
      setTimeout(() => setHintText(''), 7000);
    } catch { setHintText('No hint available.'); }
    finally { setHintLoading(false); }
  };

  // ── Cell color ────────────────────────────────────────────────

  const cellBg = (r, c) => {
    if (!puzzle || puzzle.grid[r][c] === null) return T.black;
    const key = `${r},${c}`, isSel = sel.r===r && sel.c===c, isWord = inWord(selectedWord, r, c);
    const letter = userGrid?.[r]?.[c] ?? '', correct = puzzle.grid[r][c] === letter.toLowerCase();
    if (isSel)                        return T.cellSel;
    if (isWord)                       return T.cellWord;
    if (revealed.has(key))            return T.cellHint;
    if (checked && letter && correct) return T.cellOk;
    if (checked && letter)            return T.cellBad;
    return T.cellBg;
  };

  // ── Banner content ────────────────────────────────────────────

  const vw     = Math.min(typeof window !== 'undefined' ? window.innerWidth : 390, 480);
  const cellPx = Math.floor((vw - 16) / GS);

  // In ES mode: show Spanish clue unless peekEN is active
  // Hint text overrides both
  const showingEN = clueMode === 'EN' || peekEN;
  const bannerClue  = hintText
    ? hintText
    : selectedWord
      ? (showingEN ? selectedWord.clue_en : selectedWord.clue_es)
      : null;
  const bannerLabel = hintText
    ? '💡 Hint'
    : selectedWord
      ? `${selectedWord.number} ${selectedWord.dir === 'A' ? 'Across' : 'Down'}`
      : null;

  // ── Render ────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100dvh', background: T.bg, color: T.text, fontFamily: "'Georgia', serif", display: 'flex', flexDirection: 'column', maxWidth: 480, margin: '0 auto' }}>

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
              style={{ background:'none', border:'none', color:T.muted, cursor:'pointer', fontSize:16, padding:'4px 2px', lineHeight:1 }}>✕</button>
          )}
          <input ref={fileRef} type="file" accept=".csv" onChange={handleCSV} style={{ display:'none' }} />
        </div>
      </div>

      {/* CSV status */}
      {csvStatus && (
        <div style={{ padding:'6px 14px', background: csvStatus.startsWith('⚠️')?'#3a1a1a':'#1a3a1a', borderBottom:`1px solid ${T.border}`, fontSize:12, fontFamily:'sans-serif', color: csvStatus.startsWith('⚠️')?'#ffa0a0':'#a0ffa0', flexShrink:0 }}>
          {csvStatus}
        </div>
      )}

      {/* ── Clue banner ── */}
      <div style={{ minHeight:56, padding:'8px 14px', background:T.card, borderBottom:`1px solid ${T.border}`, display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
        {bannerClue ? (
          <>
            <span style={{ color:T.accent, fontWeight:700, fontSize:12, flexShrink:0, fontFamily:'sans-serif', minWidth:58 }}>{bannerLabel}</span>
            <span style={{ fontSize:14, lineHeight:1.4, flex:1 }}>{bannerClue}</span>
            {/* EN peek button — only show in ES mode when clue is available and no hint showing */}
            {clueMode === 'ES' && !hintText && selectedWord && (
              <button
                onClick={() => setPeekEN(p => !p)}
                style={{
                  flexShrink: 0,
                  background: peekEN ? T.accent : T.surface,
                  color: peekEN ? T.black : T.muted,
                  border: `1px solid ${T.border}`,
                  borderRadius: 12,
                  padding: '4px 9px',
                  fontSize: 11,
                  cursor: 'pointer',
                  fontFamily: 'sans-serif',
                  whiteSpace: 'nowrap',
                }}
              >
                {peekEN ? '🇲🇽 ES' : '🇺🇸 EN?'}
              </button>
            )}
          </>
        ) : (
          <span style={{ color:T.muted, fontSize:13, fontFamily:'sans-serif' }}>
            {puzzle ? 'Tap a cell to select a word' : 'Generate a puzzle to start playing'}
          </span>
        )}
      </div>

      {/* ── Grid ── */}
      <div style={{ padding:8, display:'flex', justifyContent:'center', flexShrink:0 }}>
        {loading ? (
          <div style={{ padding:'44px 0', textAlign:'center', width:'100%' }}>
            <div style={{ fontSize:32 }}>⏳</div>
            <div style={{ marginTop:10, color:T.muted, fontSize:13, fontFamily:'sans-serif' }}>Building your puzzle…</div>
          </div>
        ) : !puzzle ? (
          <div style={{ padding:'36px 16px', textAlign:'center', width:'100%' }}>
            <div style={{ fontSize:48, marginBottom:14 }}>🧩</div>
            <div style={{ fontSize:17, marginBottom:6 }}>¡Hola! Ready to practice?</div>
            <div style={{ color:T.muted, fontSize:13, fontFamily:'sans-serif', marginBottom:22, lineHeight:1.6 }}>
              {csvWords.length ? `${csvWords.length} words loaded from your vocab list` : 'Upload a tab from your vocabulary CSV, or use default beginner words'}
            </div>
            <button onClick={generatePuzzle} style={bigBtnStyle}>Generate Puzzle</button>
            {error && <div style={{ marginTop:14, color:T.red, fontSize:13, fontFamily:'sans-serif' }}>{error}</div>}
          </div>
        ) : (
          <div style={{ lineHeight:0 }}>
            {puzzle.grid.map((row, r) => (
              <div key={r} style={{ display:'flex' }}>
                {row.map((cell, c) => {
                  const isBlack = cell===null, num = puzzle.cellNums[`${r},${c}`], letter = userGrid?.[r]?.[c] ?? '';
                  return (
                    <div key={c} onClick={() => handleTap(r, c)} style={{ width:cellPx, height:cellPx, background:cellBg(r,c), border:`1px solid ${isBlack?'#000':'#bbb'}`, boxSizing:'border-box', position:'relative', cursor:isBlack?'default':'pointer', userSelect:'none', WebkitUserSelect:'none', flexShrink:0 }}>
                      {!isBlack && (
                        <>
                          {num && <span style={{ position:'absolute', top:1, left:1, fontSize:Math.max(6,Math.floor(cellPx*0.22)), lineHeight:1, color:'#444', fontFamily:'sans-serif', pointerEvents:'none' }}>{num}</span>}
                          {letter && <span style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:Math.max(11,Math.floor(cellPx*0.52)), fontWeight:700, color:'#111', fontFamily:'sans-serif', pointerEvents:'none' }}>{letter}</span>}
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

      {/* ── Action bar ── */}
      {puzzle && !loading && (
        <div style={{ display:'flex', gap:8, padding:'8px 12px', borderTop:`1px solid ${T.border}`, background:T.surface, flexShrink:0, justifyContent:'center', flexWrap:'wrap' }}>
          <Btn onClick={() => setChecked(true)}>✓ Check</Btn>
          <Btn onClick={getHint} disabled={hintLoading}>{hintLoading ? '…' : '💡 Hint'}</Btn>
          <Btn onClick={revealWord}>👁 Reveal Word</Btn>
          <Btn onClick={generatePuzzle}>🔄 New Puzzle</Btn>
        </div>
      )}

      {/* ── Clue list ── */}
      {puzzle && !loading && (
        <div style={{ flex:1, overflowY:'auto', paddingBottom:20 }}>
          <div style={{ display:'flex', background:T.surface, borderBottom:`1px solid ${T.border}` }}>
            {['A','D'].map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{ flex:1, padding:'10px 0', background:'transparent', border:'none', borderBottom:`2px solid ${activeTab===tab?T.accent:'transparent'}`, color:activeTab===tab?T.accent:T.muted, cursor:'pointer', fontFamily:'sans-serif', fontSize:13, fontWeight:activeTab===tab?700:400 }}>
                {tab==='A'?'→ Across':'↓ Down'}
              </button>
            ))}
          </div>
          {(activeTab==='A'?puzzle.across:puzzle.down).map(w => {
            const isActive = selectedWord===w;
            return (
              <div key={`${w.dir}-${w.number}`} onClick={() => { setSel({r:w.row,c:w.col,dir:w.dir}); inputRef.current?.focus(); }} style={{ padding:'9px 14px', display:'flex', gap:10, alignItems:'flex-start', background:isActive?T.card:'transparent', borderLeft:`3px solid ${isActive?T.accent:'transparent'}`, borderBottom:`1px solid ${T.border}`, cursor:'pointer' }}>
                <span style={{ color:T.accent, fontWeight:700, fontSize:13, minWidth:22, flexShrink:0, fontFamily:'sans-serif' }}>{w.number}</span>
                <span style={{ fontSize:14, lineHeight:1.4 }}>
                  {clueMode === 'EN' ? w.clue_en : w.clue_es}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Success overlay ── */}
      {completed && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,0.88)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: 32,
        }}>
          <div style={{ fontSize: 72, marginBottom: 8 }}>🎉</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: T.accent, marginBottom: 8 }}>¡Lo lograste!</div>
          <div style={{ fontSize: 15, color: T.text, marginBottom: 4 }}>You solved the puzzle!</div>
          <div style={{ fontSize: 13, color: T.muted, fontFamily: 'sans-serif', marginBottom: 36 }}>
            {puzzle.words.length} {puzzle.words.length === 1 ? 'word' : 'words'} completed
          </div>
          <button onClick={generatePuzzle} style={{ ...bigBtnStyle, fontSize: 17, padding: '14px 40px' }}>
            New Puzzle
          </button>
          <button
            onClick={() => setCompleted(false)}
            style={{ marginTop: 16, background: 'none', border: 'none', color: T.muted, fontSize: 13, cursor: 'pointer', fontFamily: 'sans-serif' }}
          >
            Keep looking at this one
          </button>
        </div>
      )}
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────
const Btn = ({ onClick, children, disabled }) => (
  <button onClick={onClick} disabled={disabled} style={{ background:T.card, color:disabled?T.muted:T.text, border:`1px solid ${T.border}`, borderRadius:20, padding:'7px 14px', fontSize:13, cursor:disabled?'default':'pointer', fontFamily:'sans-serif', WebkitTapHighlightColor:'transparent' }}>
    {children}
  </button>
);

const bigBtnStyle = {
  background: T.accent, color: '#111', border: 'none', borderRadius: 10,
  padding: '13px 36px', fontSize: 16, fontWeight: 700, cursor: 'pointer',
  fontFamily: 'sans-serif', WebkitTapHighlightColor: 'transparent',
};
