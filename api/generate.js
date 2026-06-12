// ESM — matches Vercel's expected format for .js API routes
// Using fetch (built into Node 18+, Edge Runtime, everywhere) instead of require('https')

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { slots = [], csvWords = [] } = req.body || {};
    if (!slots.length) {
      return res.status(400).json({ error: 'No slots provided' });
    }

    const aSlots = slots.filter(s => s.dir === 'A').sort((a, b) => a.number - b.number);
    const dSlots = slots.filter(s => s.dir === 'D').sort((a, b) => a.number - b.number);

    const vocabNote = csvWords.length > 0
      ? `Prefer these Spanish words when they fit the length: ${csvWords.slice(0, 30).map(w => `${w.spanish}(${w.english})`).join(', ')}`
      : 'Use common beginner Spanish vocabulary (animals, food, home, verbs, colors, numbers).';

    // ── Phase 1: fill ACROSS slots (no letter constraints) ────────
    const p1Lines = aSlots.map(s => `${s.id}:${s.length}`).join(', ');
    const p1 = `Give me Spanish words for these crossword ACROSS slots (format: slotId:length).
Slots: ${p1Lines}
${vocabNote}
Rules: lowercase a-z only (strip accents: árbol→arbol, café→cafe). Exact length required.
Return only JSON: {"words":{"A1":{"key":"gato","spanish":"gato","clue_en":"Feline pet","clue_es":"Animal doméstico"}}}`;

    const r1 = await callClaude(p1, 700);
    const acrossWords = r1.words || {};

    // ── Build fixed-letter map from across words ───────────────────
    const fixed = {};
    for (const s of aSlots) {
      const w = acrossWords[s.id];
      if (!w?.key) continue;
      for (let i = 0; i < w.key.length && i < s.length; i++) {
        fixed[`${s.row},${s.col + i}`] = w.key[i];
      }
    }

    // ── Phase 2: fill DOWN slots with letter patterns ──────────────
    const p2Lines = dSlots.map(s => {
      const pattern = Array.from({ length: s.length }, (_, i) =>
        fixed[`${s.row + i},${s.col}`] || '_'
      ).join('');
      return `${s.id}(${s.length}): "${pattern}"`;
    }).join(' | ');

    const p2 = `Fill these Spanish crossword DOWN slots. Each pattern shows fixed letters ('_' = your choice).
Slots: ${p2Lines}
${vocabNote}
The fixed letters in each pattern MUST appear at those exact positions. Example: "ca_a" → "cama" or "cara".
Rules: lowercase a-z only (strip accents). Exact length required.
Return only JSON: {"words":{"D1":{"key":"cama","spanish":"cama","clue_en":"Bed","clue_es":"Mueble para dormir"}}}`;

    const r2 = await callClaude(p2, 700);
    const downWords = r2.words || {};

    return res.json({ words: { ...acrossWords, ...downWords } });

  } catch (err) {
    console.error('generate error:', err);
    return res.status(500).json({ error: err.message || 'Generation failed' });
  }
}

async function callClaude(prompt, maxTokens = 700) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  if (!data.content?.[0]?.text) throw new Error('Empty response from Claude');

  return extractJSON(data.content[0].text);
}

function extractJSON(text) {
  let s = text.trim()
    .replace(/^```json\s*/m, '').replace(/^```\s*/m, '').replace(/```\s*$/m, '').trim()
    .replace(/,\s*([\]}])/g, '$1')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"');
  try {
    return JSON.parse(s);
  } catch {
    const m = s.match(/\{[\s\S]*\}/);
    if (m) try { return JSON.parse(m[0]); } catch {}
    throw new Error('Could not parse JSON from Claude response');
  }
}
