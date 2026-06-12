export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { csvWords = [], count = 25 } = req.body;

  // Build vocabulary context — use definitions when available for richer clues
  let vocabContext;
  if (csvWords.length > 0) {
    const wordLines = csvWords.slice(0, 30).map(w => {
      const parts = [`"${w.spanish}"`];
      if (w.english)    parts.push(`EN: ${w.english}`);
      if (w.definition) parts.push(`ES def: ${w.definition}`);
      return `- ${parts.join(' | ')}`;
    }).join('\n');

    const hasDefinitions = csvWords.some(w => w.definition);

    vocabContext = `The user is studying these specific Spanish words. Include as many as possible (strip accents for the grid key):
${wordLines}

Clue instructions:
- clue_en: A crossword-style English clue — use the EN hint as context but rephrase it as a clue, not a direct translation. Fill-in-the-blank sentences work great ("___ is what cats say").
- clue_es: ${hasDefinitions
    ? 'Use the provided Spanish definition directly, condensed to clue format (1 short sentence).'
    : 'Write a short Spanish-language definition or fill-in-the-blank clue.'
  }

Fill any remaining slots (up to ${count} total) with other common beginner Spanish vocabulary.`;
  } else {
    vocabContext = `Use common beginner Spanish vocabulary covering everyday topics: home, family, food, animals, colors, numbers, body parts, clothing, weather, common verbs.

- clue_en: A helpful crossword-style English clue (not a direct translation — describe it or use a fill-in-the-blank sentence).
- clue_es: A short Spanish-language definition or clue sentence.`;
  }

  const prompt = `Generate ${count} Spanish vocabulary words for a crossword puzzle.

STRICT WORD REQUIREMENTS:
- The "spanish" field must use ONLY letters a–z — strip ALL accents (árbol → arbol, gato → gato, ahorita → ahorita)
- Word length: 3 to 12 letters only
- No spaces, no hyphens, no punctuation in the "spanish" field
- Mix of short (3–5 letters) and longer (6–10 letters) words for grid variety

VOCABULARY & CLUES:
${vocabContext}

Return ONLY valid JSON, no markdown, no extra text:
{
  "words": [
    {
      "spanish": "gato",
      "clue_en": "This furry pet purrs and chases mice",
      "clue_es": "Animal doméstico que dice miau"
    }
  ]
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    const text = data.content[0].text;
    const parsed = extractJSON(text);
    if (!Array.isArray(parsed.words)) throw new Error('Invalid response shape');
    res.json(parsed);
  } catch (e) {
    console.error('Generate error:', e);
    res.status(500).json({ error: e.message });
  }
}

function extractJSON(text) {
  let s = text.trim()
    .replace(/^```json\s*/m, '').replace(/^```\s*/m, '').replace(/```\s*$/m, '').trim()
    .replace(/,\s*([\]}])/g, '$1')
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
  try { return JSON.parse(s); }
  catch { const m = s.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); throw new Error('Could not parse JSON'); }
}
