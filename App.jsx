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

const GS = 13; // grid size

// ── Crossword Placement ───────────────────────────────────────

const emptyGrid = () =>
  Array(GS).fill(null).map(() => Array(GS).fill(null));

const stripAccents = s =>
  s.toLowerCase()
   .replace(/[áàâä]/g, 'a').replace(/[éèêë]/g, 'e')
   .replace(/[íìîï]/g, 'i').replace(/[óòôö]/g, 'o')
   .replace(/[úùûü]/g, 'u').replace(/ñ/g, 'n')
   .replace(/[^a-z]/g, '');

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
    const r = dir === 'A' ? r0 : r0 + i;
    const c = dir === 'A' ? c0 + i : c0;
    const cell = grid[r][c];

    if (cell === null) {
      if (dir === 'A') {
        if ((r > 0 && grid[r - 1][c] !== null) || (r < GS - 1 && grid[r + 1][c] !== null))
          return false;
      } else {
        if ((c > 0 && grid[r][c - 1] !== null) || (c < GS - 1 && grid[r][c + 1] !== null))
          return false;
      }
    } else if (cell === word[i]) {
      crosses++;
    } else {
      return false;
    }
  }
  return !hasAny || crosses > 0;
}

function applyWord(grid, word, r0, c0, dir) {
  const g = grid.map(r => [...r]);
  for (let i = 0; i < word.length; i++) {
    const r = dir === 'A' ? r0 : r0 + i;
    const c = dir === 'A' ? c0 + i : c0;
    g[r][c] = word[i];
  }
  return g;
}

function buildPuzzle(rawWords) {
  const words = rawWords
    .map(w => ({ ...w, key: stripAccents(w.spanish) }))
    .filter(w => w.key.length >= 3 && w.key.length <= 12)
    .sort((a, b) => b.key.length - a.key.length)
    .slice(0, 22);

  if (!words.length) return null;

  let grid = emptyGrid();
  const placed = [];

  // Place first word horizontally, centered
  const [first, ...rest] = words;
  const r0 = Math.floor(GS / 2);
  const c0 = Math.floor((GS - first.key.length) / 2);
  grid = applyWord(grid, first.key, r0, c0, 'A');
  placed.push({ ...first, row: r0, col: c0, dir: 'A' });

  for (const w of rest) {
    let bestGrid = null, best = null, bestScore = -Infinity;

    for (let r = 0; r < GS; r++) {
      for (let c = 0; c < GS; c++) {
        for (const dir of ['D', 'A']) {
          if (!canPlace(grid, w.key, r, c, dir)) continue;
          let crosses = 0;
          for (let i = 0; i < w.key.length; i++) {
            const cr = dir === 'A' ? r : r + i;
            const cc = dir === 'A' ? c + i : c;
            if (grid[cr][cc] !== null) crosses++;
          }
          const centerDist = Math.abs(r - GS / 2) + Math.abs(c - GS / 2);
          const score = crosses * 10 - centerDist * 0.1;
          if (score > bestScore) {
            bestScore = score;
            best = { r, c, dir };
            bestGrid = applyWord(grid, w.key, r, c, dir);
          }
        }
      }
    }

    if (best && bestGrid) {
      grid = bestGrid;
      placed.push({ ...w, row: best.r, col: best.c, dir: best.dir });
    }
  }

  // Number cells top-left → bottom-right
  const cellNums = {};
  let num = 1;
  for (let r = 0; r < GS; r++) {
    for (let c = 0; c < GS; c++) {
      const startsA = placed.some(w => w.dir === 'A' && w.row === r && w.col === c);
      const startsD = placed.some(w => w.dir === 'D' && w.row === r && w.col === c);
      if (startsA || startsD) {
        cellNums[`${r},${c}`] = num;
        placed
          .filter(
            w =>
              (w.dir === 'A' && w.row === r && w.col === c) ||
              (w.dir === 'D' && w.row === r && w.col === c)
          )
          .forEach(w => { w.number = num; });
        num++;
      }
    }
  }

  return {
    grid,
    words: placed,
    across: placed.filter(w => w.dir === 'A').sort((a, b) => a.number - b.number),
    down:   placed.filter(w => w.dir === 'D').sort((a, b) => a.number - b.number),
    cellNums,
  };
}

// ── App ───────────────────────────────────────────────────────

export default function App() {
  const [puzzle,      setPuzzle]      = useState(null);
  const [userGrid,    setUserGrid]    = useState(null);
  const [sel,         setSel]         = useState({ r: null, c: null, dir: 'A' });
  const [clueMode,    setClueMode]    = useState('EN');
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [checked,     setChecked]     = useState(false);
  const [revealed,    setRevealed]    = useState(new Set());
  const [inputVal,    setInputVal]    = useState('');
  const [activeTab,   setActiveTab]   = useState('A');
  const [csvWords,    setCsvWords]    = useState([]);
  const [hintText,    setHintText]    = useState('');
  const [hintLoading, setHintLoading] = useState(false);

  const inputRef = useRef(null);
  const fileRef  = useRef(null);

  // ── Derived ──────────────────────────────────────────────────

  const inWord = (w, r, c) => {
    if (!w) return false;
    return w.dir === 'A'
      ? w.row === r && c >= w.col && c < w.col + w.key.length
      : w.col === c && r >= w.row && r < w.row + w.key.length;
  };

  const selectedWord = puzzle?.words.find(w => {
    if (w.dir !== sel.dir || sel.r === null) return false;
    return inWord(w, sel.r, sel.c);
  }) ?? null;

  // ── Actions ──────────────────────────────────────────────────

  const generatePuzzle = async () => {
    setLoading(true);
    setError('');
    setChecked(false);
    setRevealed(new Set());
    setHintText('');
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

    const hasA = puzzle.words.some(w => w.dir === 'A' && inWord(w, r, c));
    const hasD = puzzle.words.some(w => w.dir === 'D' && inWord(w, r, c));

    if (sel.r === r && sel.c === c && hasA && hasD) {
      setSel(s => ({ ...s, dir: s.dir === 'A' ? 'D' : 'A' }));
    } else {
      const keepDir = (sel.dir === 'A' && hasA) || (sel.dir === 'D' && hasD);
      setSel({ r, c, dir: keepDir ? sel.dir : (hasA ? 'A' : 'D') });
    }
    inputRef.current?.focus();
  };

  const enterLetter = ch => {
    if (!selectedWord || sel.r === null) return;
    const w = selectedWord;
    const ng = userGrid.map(row => [...row]);
    ng[sel.r][sel.c] = ch;
    setUserGrid(ng);
    setChecked(false);

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

    if (ng[sel.r][sel.c] !== '') {
      ng[sel.r][sel.c] = '';
      setUserGrid(ng);
    } else {
      const idx = w.dir === 'A' ? sel.c - w.col : sel.r - w.row;
      if (idx > 0) {
        const nr = w.dir === 'A' ? sel.r : w.row + idx - 1;
        const nc = w.dir === 'A' ? w.col + idx - 1 : sel.c;
        ng[nr][nc] = '';
        setUserGrid(ng);
        setSel(s => ({ ...s, r: nr, c: nc }));
      }
    }
  };

  const revealWord = () => {
    if (!selectedWord) return;
    const w = selectedWord;
    const newRev = new Set(revealed);
    const ng = userGrid.map(row => [...row]);
    for (let i = 0; i < w.key.length; i++) {
      const r = w.dir === 'A' ? w.row : w.row + i;
      const c = w.dir === 'A' ? w.col + i : w.col;
      newRev.add(`${r},${c}`);
      ng[r][c] = w.key[i].toUpperCase();
    }
    setRevealed(newRev);
    setUserGrid(ng);
  };

  const getHint = async () => {
    if (!selectedWord || hintLoading) return;
    setHintLoading(true);
    try {
      const res = await fetch('/api/hint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word: selectedWord.key, clue_en: selectedWord.clue_en }),
      });
      const data = await res.json();
      setHintText(data.hint || '');
      setTimeout(() => setHintText(''), 7000);
    } catch {
      setHintText('No hint available.');
    } finally {
      setHintLoading(false);
    }
  };

  const handleCSV = e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const lines = ev.target.result.split('\n').filter(l => l.trim());
      const words = lines.slice(1).flatMap(line => {
        const [spanish, english] = line.split(',').map(s => s?.trim().replace(/^"|"$/g, ''));
        return spanish && english ? [{ spanish, english }] : [];
      });
      setCsvWords(words);
    };
    reader.readAsText(file);
  };

  // ── Cell style ───────────────────────────────────────────────

  const cellBg = (r, c) => {
    if (!puzzle || puzzle.grid[r][c] === null) return T.black;
    const key    = `${r},${c}`;
    const isSel  = sel.r === r && sel.c === c;
    const isWord = inWord(selectedWord, r, c);
    const letter = userGrid?.[r]?.[c] ?? '';
    const correct = puzzle.grid[r][c] === letter.toLowerCase();

    if (isSel)                        return T.cellSel;
    if (isWord)                       return T.cellWord;
    if (revealed.has(key))            return T.cellHint;
    if (checked && letter && correct) return T.cellOk;
    if (checked && letter)            return T.cellBad;
    return T.cellBg;
  };

  // ── Layout ───────────────────────────────────────────────────

  const vw      = Math.min(typeof window !== 'undefined' ? window.innerWidth : 390, 480);
  const cellPx  = Math.floor((vw - 16) / GS);

  const clueLabel  = selectedWord
    ? `${selectedWord.number} ${selectedWord.dir === 'A' ? 'Across' : 'Down'}`
    : null;
  const activeClue = selectedWord
    ? (clueMode === 'EN' ? selectedWord.clue_en : selectedWord.clue_es)
    : null;

  const bannerText  = hintText || activeClue;
  const bannerLabel = hintText ? '💡 Hint' : clueLabel;

  // ── Render ───────────────────────────────────────────────────

  return (
    <div style={{
      minHeight: '100dvh', background: T.bg, color: T.text,
      fontFamily: "'Georgia', serif",
      display: 'flex', flexDirection: 'column',
      maxWidth: 480, margin: '0 auto',
    }}>

      {/* Keyboard capture input */}
      <input
        ref={inputRef}
        type="text"
        inputMode="text"
        autoCapitalize="characters"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        value={inputVal}
        onChange={e => {
          const ch = e.target.value.slice(-1).toUpperCase();
          if (/[A-Z]/.test(ch)) enterLetter(ch);
          setInputVal('');
        }}
        onKeyDown={e => {
          if (e.key === 'Backspace') { e.preventDefault(); deleteLetter(); }
        }}
        style={{
          position: 'fixed', top: 0, left: 0,
          width: 1, height: 1, opacity: 0.01,
          fontSize: 16, border: 'none', padding: 0,
          pointerEvents: 'none',
        }}
      />

      {/* ── Header ── */}
      <div style={{
        padding: '10px 14px 8px', background: T.surface,
        borderBottom: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 19, fontWeight: 700 }}>🧩 El Crucigrama</div>
          <div style={{ fontSize: 11, color: T.muted, fontFamily: 'sans-serif' }}>
            Spanish Vocabulary Crossword
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Btn onClick={() => setClueMode(m => m === 'EN' ? 'ES' : 'EN')}>
            {clueMode === 'EN' ? '🇺🇸 EN' : '🇲🇽 ES'}
          </Btn>
          <Btn onClick={() => fileRef.current?.click()}>
            {csvWords.length ? `📋 ${csvWords.length}w` : '📤 CSV'}
          </Btn>
          <input
            ref={fileRef} type="file" accept=".csv"
            onChange={handleCSV} style={{ display: 'none' }}
          />
        </div>
      </div>

      {/* ── Clue / hint banner ── */}
      <div style={{
        minHeight: 52, padding: '10px 14px',
        background: T.card, borderBottom: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
      }}>
        {bannerText ? (
          <>
            <span style={{
              color: T.accent, fontWeight: 700, fontSize: 12,
              flexShrink: 0, fontFamily: 'sans-serif', minWidth: 58,
            }}>
              {bannerLabel}
            </span>
            <span style={{ fontSize: 14, lineHeight: 1.4 }}>{bannerText}</span>
          </>
        ) : (
          <span style={{ color: T.muted, fontSize: 13, fontFamily: 'sans-serif' }}>
            {puzzle ? 'Tap a cell to select a word' : 'Generate a puzzle to start playing'}
          </span>
        )}
      </div>

      {/* ── Grid ── */}
      <div style={{ padding: 8, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
        {loading ? (
          <div style={{ padding: '44px 0', textAlign: 'center', width: '100%' }}>
            <div style={{ fontSize: 32 }}>⏳</div>
            <div style={{ marginTop: 10, color: T.muted, fontSize: 13, fontFamily: 'sans-serif' }}>
              Building your puzzle…
            </div>
          </div>
        ) : !puzzle ? (
          <div style={{ padding: '36px 16px', textAlign: 'center', width: '100%' }}>
            <div style={{ fontSize: 48, marginBottom: 14 }}>🧩</div>
            <div style={{ fontSize: 17, marginBottom: 6 }}>¡Hola! Ready to practice?</div>
            <div style={{
              color: T.muted, fontSize: 13, fontFamily: 'sans-serif',
              marginBottom: 22, lineHeight: 1.6,
            }}>
              {csvWords.length
                ? `${csvWords.length} words loaded from your vocab list`
                : 'Upload your vocabulary CSV, or use default beginner words'}
            </div>
            <button onClick={generatePuzzle} style={bigBtnStyle}>
              Generate Puzzle
            </button>
            {error && (
              <div style={{ marginTop: 14, color: T.red, fontSize: 13, fontFamily: 'sans-serif' }}>
                {error}
              </div>
            )}
          </div>
        ) : (
          <div style={{ lineHeight: 0 }}>
            {puzzle.grid.map((row, r) => (
              <div key={r} style={{ display: 'flex' }}>
                {row.map((cell, c) => {
                  const isBlack = cell === null;
                  const num    = puzzle.cellNums[`${r},${c}`];
                  const letter = userGrid?.[r]?.[c] ?? '';

                  return (
                    <div
                      key={c}
                      onClick={() => handleTap(r, c)}
                      style={{
                        width: cellPx, height: cellPx,
                        background: cellBg(r, c),
                        border: `1px solid ${isBlack ? '#000' : '#bbb'}`,
                        boxSizing: 'border-box',
                        position: 'relative',
                        cursor: isBlack ? 'default' : 'pointer',
                        userSelect: 'none', WebkitUserSelect: 'none',
                        flexShrink: 0,
                      }}
                    >
                      {!isBlack && (
                        <>
                          {num && (
                            <span style={{
                              position: 'absolute', top: 1, left: 1,
                              fontSize: Math.max(6, Math.floor(cellPx * 0.22)),
                              lineHeight: 1, color: '#444',
                              fontFamily: 'sans-serif', fontWeight: 400,
                              pointerEvents: 'none',
                            }}>
                              {num}
                            </span>
                          )}
                          {letter && (
                            <span style={{
                              position: 'absolute', inset: 0,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: Math.max(11, Math.floor(cellPx * 0.52)),
                              fontWeight: 700, color: '#111',
                              fontFamily: 'sans-serif',
                              pointerEvents: 'none',
                            }}>
                              {letter}
                            </span>
                          )}
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
        <div style={{
          display: 'flex', gap: 8, padding: '8px 12px',
          borderTop: `1px solid ${T.border}`, background: T.surface,
          flexShrink: 0, justifyContent: 'center', flexWrap: 'wrap',
        }}>
          <Btn onClick={() => setChecked(true)}>✓ Check</Btn>
          <Btn onClick={getHint} disabled={hintLoading}>
            {hintLoading ? '…' : '💡 Hint'}
          </Btn>
          <Btn onClick={revealWord}>👁 Reveal Word</Btn>
          <Btn onClick={generatePuzzle}>🔄 New Puzzle</Btn>
        </div>
      )}

      {/* ── Clue list ── */}
      {puzzle && !loading && (
        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 20 }}>
          <div style={{
            display: 'flex', background: T.surface,
            borderBottom: `1px solid ${T.border}`,
          }}>
            {['A', 'D'].map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{
                flex: 1, padding: '10px 0', background: 'transparent', border: 'none',
                borderBottom: `2px solid ${activeTab === tab ? T.accent : 'transparent'}`,
                color: activeTab === tab ? T.accent : T.muted,
                cursor: 'pointer', fontFamily: 'sans-serif', fontSize: 13,
                fontWeight: activeTab === tab ? 700 : 400,
              }}>
                {tab === 'A' ? '→ Across' : '↓ Down'}
              </button>
            ))}
          </div>

          {(activeTab === 'A' ? puzzle.across : puzzle.down).map(w => {
            const isActive = selectedWord === w;
            return (
              <div
                key={`${w.dir}-${w.number}`}
                onClick={() => {
                  setSel({ r: w.row, c: w.col, dir: w.dir });
                  inputRef.current?.focus();
                }}
                style={{
                  padding: '9px 14px',
                  display: 'flex', gap: 10, alignItems: 'flex-start',
                  background: isActive ? T.card : 'transparent',
                  borderLeft: `3px solid ${isActive ? T.accent : 'transparent'}`,
                  borderBottom: `1px solid ${T.border}`,
                  cursor: 'pointer',
                }}
              >
                <span style={{
                  color: T.accent, fontWeight: 700, fontSize: 13,
                  minWidth: 22, flexShrink: 0, fontFamily: 'sans-serif',
                }}>
                  {w.number}
                </span>
                <span style={{ fontSize: 14, lineHeight: 1.4 }}>
                  {clueMode === 'EN' ? w.clue_en : w.clue_es}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Shared components & styles ────────────────────────────────

const Btn = ({ onClick, children, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      background: T.card, color: disabled ? T.muted : T.text,
      border: `1px solid ${T.border}`, borderRadius: 20,
      padding: '7px 14px', fontSize: 13,
      cursor: disabled ? 'default' : 'pointer',
      fontFamily: 'sans-serif',
      WebkitTapHighlightColor: 'transparent',
    }}
  >
    {children}
  </button>
);

const bigBtnStyle = {
  background: T.accent, color: '#111', border: 'none',
  borderRadius: 10, padding: '13px 36px', fontSize: 16,
  fontWeight: 700, cursor: 'pointer', fontFamily: 'sans-serif',
  WebkitTapHighlightColor: 'transparent',
};
