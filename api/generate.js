export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { slots, crossings, csvWords = [] } = req.body;
  if (!slots?.length) return res.status(400).json({ error: 'No slots provided' });

  const aSlots = slots.filter(s => s.dir === 'A').sort((a, b) => a.number - b.number);
  const dSlots = slots.filter(s => s.dir === 'D').sort((a, b) => a.number - b.number);

  // Build slot descriptions
  const slotLines = [
    'ACROSS:',
    ...aSlots.map(s => `  ${s.id} (${s.length} letters): row ${s.row}, cols ${s.col}–${s.col + s.length - 1}`),
    'DOWN:',
    ...dSlots.map(s => `  ${s.id} (${s.length} letters): col ${s.col}, rows ${s.row}–${s.row + s.length - 1}`),
  ].join('\n');

  const crossingLines = crossings.length
    ? crossings.map(c => `  ${c.aId}[${c.aPos}] = ${c.dId}[${c.dPos}]   ← cell (row ${c.row}, col ${c.col})`).join('\n')
    : '  (none)';

  const vocabSection = csvWords.length > 0
    ? `PRIORITY VOCABULARY — use these words wherever they fit the length and letter constraints:\n${
        csvWords.slice(0, 40).map(w =>
          `  "${w.spanish}"${w.definition ? ` — ${w.definition}` : ''} (EN: ${w.english})`
        ).join('\n')
      }`
    : 'Use common beginner-friendly Spanish vocabulary: everyday nouns, simple verbs, adjectives (food, home, animals, nature, travel).';

  const lengthSummary = [...new Set(slots.map(s => s.length))].sort((a, b) => a - b)
    .map(len => `${len}-letter: ${slots.filter(s => s.length === len).length} slots`)
    .join(', ');

  const prompt = `You are constructing a Spanish crossword puzzle. Fill every slot with a real Spanish word, satisfying all crossing constraints.

WORD SLOTS (${slots.length} total — ${lengthSummary}):
${slotLines}

CROSSING CONSTRAINTS (letter at each crossing cell must match EXACTLY):
${crossingLines}

${vocabSection}

RULES:
1. Strip accents — use only a–z lowercase (árbol→arbol, café→cafe, gato→gato)
2. Word length must EXACTLY match each slot
3. Every crossing constraint must be satisfied — if A1[2] = D5[0], the letter at position 2 of A1's word must equal the letter at position 0 of D5's word
4. Words must be real Spanish vocabulary

HOW TO APPROACH:
- Start with the longest slots (they're most constrained)
- For each slot, pick a word whose letters satisfy all crossing constraints with already-placed words
- After placing all words, verify each crossing is satisfied

For clues: clue_en is a short English crossword-style clue; clue_es is a short Spanish definition. The "spanish" field may include accents (for display); "key" must be a–z only (for the grid).

Return ONLY valid JSON — no markdown, no extra text:
{
  "words": {
    "A1": { "key": "gato", "spanish": "gato", "clue_en": "Feline that purrs", "clue_es": "Animal doméstico felino" },
    "D1": { "key": "gas", "spanish": "gas", "clue_en": "Cooking fuel", "clue_es": "Combustible gaseoso" }
  }
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
        max_tokens: 3500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    const text = data.content[0].text;
    const parsed = extractJSON(text);
    if (!parsed.words) throw new Error('No words in response');

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
