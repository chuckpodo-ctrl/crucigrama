// ─────────────────────────────────────────────────────────────
// /api/clues — Generate bilingual crossword clues for placed words.
// ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { words = [] } = req.body || {};
    if (!words.length) {
      return res.status(400).json({ error: 'No words provided' });
    }

    const lines = words.map(w => {
      const gloss = w.english ? ` [${w.english}]` : '';
      return `${w.id}: ${w.spanish}${gloss}`;
    }).join('\n');

    const prompt = `Write crossword clues for these Spanish words. Each entry is "ID: word [optional English meaning]".

${lines}

RULES — read carefully:

1. NEVER use the answer word (or any part of it, or its English translation) inside the clue.
   ✗ BAD: "enamorada" → "Mujer que está enamorada"  (uses the word itself)
   ✗ BAD: "correr" → "To run or correr fast"  (uses the word)
   ✗ BAD: "amor" → "Love, or enamorado feeling"  (uses a derivative)
   ✓ GOOD: "enamorada" → "Woman head over heels" / "Mujer con el corazón robado"

2. Be specific and concrete — describe the actual meaning, not a vague category.
   ✗ BAD: "a feeling" / "related to emotions"
   ✓ GOOD: "What roses and chocolates express" / "Sentimiento entre parejas"

3. Keep it short: 4–8 words in English, 4–8 words in Spanish.

4. For conjugated verbs, clue the conjugated form.
   "como" → "I eat, in Spanish class" / "Primera persona de comer"

5. clue_en: natural English crossword clue (NYT Mini style).
   clue_es: a Spanish synonym, definition, or fill-in-the-blank ("___ de azúcar" style).

Return ONLY valid JSON:
{
  "clues": {
    "A1": { "clue_en": "...", "clue_es": "..." }
  }
}`;

    const result = await callClaude(prompt);

    // Post-generation self-reference check.
    // Build a lookup of word → id so we can check each clue.
    const wordById = {};
    for (const w of words) wordById[w.id] = w;

    const cleaned = {};
    for (const [id, clue] of Object.entries(result.clues || {})) {
      const w = wordById[id];
      if (!w) { cleaned[id] = clue; continue; }

      cleaned[id] = {
        clue_en: sanitizeClue(clue.clue_en, w.spanish, w.english),
        clue_es: sanitizeClue(clue.clue_es, w.spanish, w.english),
      };
    }

    return res.json({ clues: cleaned });

  } catch (err) {
    console.error('clues error:', err.message);
    return res.status(500).json({ error: err.message || 'Clue generation failed' });
  }
}

// Strip accents for comparison only (not for display).
function norm(s) {
  return (s || '').toLowerCase()
    .replace(/[áàâä]/g,'a').replace(/[éèêë]/g,'e')
    .replace(/[íìîï]/g,'i').replace(/[óòôö]/g,'o')
    .replace(/[úùûü]/g,'u').replace(/ñ/g,'n')
    .replace(/[^a-z]/g,' ');
}

// Check whether a clue contains the answer word (or its stem/root).
// If it does, replace the clue with a safe fallback.
function sanitizeClue(clue, spanish, english) {
  if (!clue || clue === '…') return clue;

  const clueNorm = norm(clue);
  const spNorm   = norm(spanish);
  const enNorm   = norm(english || '');

  // Build list of strings to check for — the word, its stem (first 5 chars),
  // and the English translation if short (single word, avoids false positives
  // on common words like "the", "to", "a").
  const checks = [spNorm.trim()];
  if (spNorm.trim().length > 4) checks.push(spNorm.trim().slice(0, 5));
  if (enNorm.trim() && !enNorm.trim().includes(' ') && enNorm.trim().length > 3) {
    checks.push(enNorm.trim());
  }

  const isSelfRef = checks.some(ch => ch && clueNorm.includes(ch));

  if (isSelfRef) {
    // Return a generic but accurate fallback rather than the bad clue.
    // The English gloss (if available) becomes a plain-language clue.
    if (english && !norm(english).includes(spNorm.trim().slice(0,4))) {
      return english.length < 40 ? `Means "${english}"` : english.slice(0, 40);
    }
    return `See: ${spanish}`;
  }

  return clue;
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
      max_tokens: 3000,
      system: 'You are a JSON API for a Spanish crossword. Output ONLY a valid JSON object. No markdown, no preamble, no explanation. Start with { and end with }.',
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const txt = await response.text();
    throw new Error(`API ${response.status}: ${txt.slice(0, 200)}`);
  }

  const data = await response.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));

  const text = (data.content?.[0]?.text || '').trim();
  if (!text) throw new Error('Empty response from Claude');

  return parseJSON(text);
}

function parseJSON(text) {
  let s = text
    .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '')
    .trim();

  try { return JSON.parse(s); } catch {}

  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start !== -1 && end > start) {
    let candidate = s.slice(start, end + 1)
      .replace(/,\s*([\]}])/g, '$1')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"');
    try { return JSON.parse(candidate); } catch {}
  }
  throw new Error('Could not parse JSON from Claude response');
}
