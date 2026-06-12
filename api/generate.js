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

    const vocab = csvWords.length > 0
      ? `Prefer these words when they fit: ${csvWords.slice(0, 25).map(w => `${w.spanish}=${w.english}`).join(', ')}.`
      : 'Use common Spanish: animals, food, colors, body, home, verbs.';

    // ── Phase 1: Across words ─────────────────────────────────────
    const aList = aSlots.map(s => `"${s.id}":${s.length}letters`).join(', ');
    const p1 = `Fill Spanish crossword across slots.
${vocab}
Slots: ${aList}
Rules: key=accents stripped (árbol→arbol), exact length, real Spanish word. Short clues (≤5 words each).
JSON format exactly:
{"words":{"A1":{"key":"gato","spanish":"gato","clue_en":"Cat, feline pet","clue_es":"Felino doméstico"},"A2":{...}}}`;

    const phase1 = await callClaude(p1);
    const acrossWords = phase1.words || {};

    // ── Build letter pattern from across words ────────────────────
    const fixed = {};
    for (const s of aSlots) {
      const w = acrossWords[s.id];
      if (!w?.key) continue;
      for (let i = 0; i < w.key.length && i < s.length; i++) {
        fixed[`${s.row},${s.col + i}`] = w.key[i];
      }
    }

    // ── Phase 2: Down words ───────────────────────────────────────
    const dList = dSlots.map(s => {
      const pat = Array.from({ length: s.length }, (_, i) =>
        fixed[`${s.row + i},${s.col}`] || '_'
      ).join('');
      return `"${s.id}":${s.length}letters,pattern="${pat}"`;
    }).join(', ');

    const p2 = `Fill Spanish crossword down slots. Pattern letters are FIXED — your word must have those exact letters at those positions.
${vocab}
Slots: ${dList}
Example: length=4,pattern="ca_a" → key could be "cama","cara","cana".
Rules: key=accents stripped, exact length, real Spanish word. Short clues (≤5 words).
JSON format exactly:
{"words":{"D1":{"key":"cama","spanish":"cama","clue_en":"Bed, sleeping furniture","clue_es":"Mueble para dormir"},"D2":{...}}}`;

    const phase2 = await callClaude(p2);
    const downWords = phase2.words || {};

    return res.json({ words: { ...acrossWords, ...downWords } });

  } catch (err) {
    console.error('generate error:', err.message);
    return res.status(500).json({ error: err.message || 'Generation failed' });
  }
}

async function callClaude(userPrompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set in Vercel environment');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      system: 'You are a JSON API. Respond with ONLY a valid JSON object. No markdown fences, no explanation text, no preamble. Your entire response must start with { and end with }.',
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  
  const text = (data.content?.[0]?.text || '').trim();
  if (!text) throw new Error('Empty response from Claude');

  return parseJSON(text);
}

function parseJSON(text) {
  // Strip markdown fences if present
  let s = text
    .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '')
    .trim();

  // Try direct parse first
  try { return JSON.parse(s); } catch {}

  // Extract the outermost {...} block
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    let candidate = s.slice(start, end + 1);
    // Fix trailing commas
    candidate = candidate.replace(/,\s*([\]}])/g, '$1');
    // Fix smart quotes
    candidate = candidate.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
    try { return JSON.parse(candidate); } catch {}
  }

  throw new Error('Could not parse JSON from Claude response');
}
