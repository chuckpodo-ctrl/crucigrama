// ─────────────────────────────────────────────────────────────
// /api/clues — Generate bilingual crossword clues for placed words.
//
// The grid is now filled entirely on the client by the backtracking
// solver, so this endpoint's only job is cluing: given the ~30 words
// that were actually placed, return a short English and Spanish clue
// for each. This is the task Claude is genuinely good at.
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

    // Compact the word list for the prompt: id, spanish, and any English
    // gloss we already have (from the bundled list / CSV) as a hint.
    const lines = words.map(w => {
      const gloss = w.english ? ` [${w.english}]` : '';
      return `${w.id}: ${w.spanish}${gloss}`;
    }).join('\n');

    const prompt = `Write crossword clues for these Spanish words. Each entry is "ID: word [optional English meaning]".

${lines}

For each word, write:
- clue_en: a short, specific English crossword clue (4–7 words). Describe what the word means or how it's used. NYT Mini style.
- clue_es: a short Spanish definition or synonym (4–7 words).

Good clues describe the actual meaning:
  ✓ "Where you sleep at night" / "Lugar donde duermes"
  ✓ "Opposite of cold" / "Lo contrario de frío"
Avoid vague category labels like "a type of thing" or "related word".

If a word is a conjugated verb, clue it as that form (e.g. "I eat" for "como").
If the English meaning is given in brackets, use it to write an accurate clue.

Return ONLY valid JSON, keyed by the IDs shown:
{
  "clues": {
    "A1": { "clue_en": "Feline household pet", "clue_es": "Animal doméstico felino" }
  }
}`;

    const result = await callClaude(prompt);
    return res.json({ clues: result.clues || {} });

  } catch (err) {
    console.error('clues error:', err.message);
    return res.status(500).json({ error: err.message || 'Clue generation failed' });
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
      max_tokens: 3000,
      system: 'You are a JSON API for a Spanish crossword. Output ONLY a valid JSON object. No markdown, no preamble. Start with { and end with }.',
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
