// CommonJS — safer for Vercel Node.js runtime
const https = require('https');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { slots = [], crossings = [], csvWords = [] } = req.body || {};
  if (!slots.length) return res.status(400).json({ error: 'No slots provided' });

  const aSlots = slots.filter(s => s.dir === 'A').sort((a, b) => a.number - b.number);
  const dSlots = slots.filter(s => s.dir === 'D').sort((a, b) => a.number - b.number);

  const lengthCount = {};
  for (const s of slots) lengthCount[s.length] = (lengthCount[s.length] || 0) + 1;
  const lengthSummary = Object.entries(lengthCount).sort(([a],[b])=>a-b)
    .map(([len, n]) => `${n}×${len}-letter`).join(', ');

  const vocabList = csvWords.length > 0
    ? `PRIORITY WORDS (use these when they fit):\n${csvWords.slice(0,40).map(w=>`  ${w.spanish} = ${w.english}`).join('\n')}`
    : 'Use common beginner Spanish vocabulary (animals, food, home, travel, nature, verbs).';

  // ── Phase 1: fill ACROSS slots (no crossing constraints) ────
  const acrossLines = aSlots.map(s =>
    `  ${s.id} (${s.length} letters, row ${s.row})`
  ).join('\n');

  const prompt1 = `Fill these Spanish crossword ACROSS slots. Each needs a real Spanish word of the exact length shown. Strip all accents (use a-z only for "key"; keep accents in "spanish" for display).

SLOTS:
${acrossLines}

${vocabList}

Return ONLY valid JSON:
{
  "words": {
    "A1": { "key": "gato", "spanish": "gato", "clue_en": "Feline pet", "clue_es": "Animal doméstico" },
    "A3": { "key": "mesa", "spanish": "mesa", "clue_en": "Dining surface", "clue_es": "Mueble para comer" }
  }
}`;

  let acrossWords;
  try {
    const r1 = await callClaude(prompt1);
    acrossWords = r1.words || {};
  } catch (e) {
    console.error('Phase 1 error:', e.message);
    return res.status(500).json({ error: `Phase 1 failed: ${e.message}` });
  }

  // ── Build fixed-letter map from across words ─────────────────
  const fixed = {}; // "row,col" -> letter
  for (const as of aSlots) {
    const word = acrossWords[as.id];
    if (!word?.key) continue;
    for (let i = 0; i < word.key.length && i < as.length; i++) {
      fixed[`${as.row},${as.col + i}`] = word.key[i];
    }
  }

  // ── Phase 2: fill DOWN slots using fixed letters as patterns ─
  const downLines = dSlots.map(s => {
    const pattern = Array.from({ length: s.length }, (_, i) => {
      const letter = fixed[`${s.row + i},${s.col}`];
      return letter ? letter : '_';
    }).join('');
    const constraints = Array.from({ length: s.length }, (_, i) => {
      const letter = fixed[`${s.row + i},${s.col}`];
      return letter ? `pos ${i}='${letter}'` : null;
    }).filter(Boolean).join(', ');
    return `  ${s.id} (${s.length} letters, col ${s.col}): pattern "${pattern}"${constraints ? ` [${constraints}]` : ''}`;
  }).join('\n');

  const prompt2 = `Fill these Spanish crossword DOWN slots. Each must exactly match the letter pattern shown (letters shown must appear at those positions; "_" means you choose).

SLOTS:
${downLines}

${vocabList}

IMPORTANT: The letters shown in each pattern MUST appear at exactly those positions. For example, pattern "ca_a" means a 4-letter word starting with "ca" and ending with "a" — like "cama" or "cara".

Strip all accents (key: a-z only; spanish: keep accents for display).

Return ONLY valid JSON:
{
  "words": {
    "D1": { "key": "cama", "spanish": "cama", "clue_en": "Sleeping furniture", "clue_es": "Mueble para dormir" }
  }
}`;

  let downWords;
  try {
    const r2 = await callClaude(prompt2);
    downWords = r2.words || {};
  } catch (e) {
    console.error('Phase 2 error:', e.message);
    // Don't fail completely — return what we have with empty down words
    downWords = {};
  }

  const allWords = { ...acrossWords, ...downWords };
  return res.json({ words: allWords });
};

// ── Anthropic API call ────────────────────────────────────────
function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
          const text = parsed.content?.[0]?.text || '';
          resolve(extractJSON(text));
        } catch (e) {
          reject(new Error(`Parse error: ${e.message} — raw: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(25000, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(body);
    req.end();
  });
}

function extractJSON(text) {
  let s = text.trim()
    .replace(/^```json\s*/m, '').replace(/^```\s*/m, '').replace(/```\s*$/m, '').trim()
    .replace(/,\s*([\]}])/g, '$1')
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
  try { return JSON.parse(s); }
  catch {
    const m = s.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch {} }
    throw new Error('Could not parse JSON from response');
  }
}
