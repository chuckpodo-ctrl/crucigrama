export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { csvWords = [], count = 25 } = req.body;

  const vocabContext = csvWords.length > 0
    ? `PRIORITY — the user is studying these specific words. Include as many as possible: ${
        csvWords
          .slice(0, 30)
          .map(w => `"${w.spanish}" (${w.english})`)
          .join(', ')
      }. Fill remaining slots with other common beginner Spanish vocabulary.`
    : 'Use common beginner Spanish vocabulary covering everyday topics: home, family, food, animals, colors, numbers, body parts, clothing, weather, school.';

  const prompt = `Generate ${count} Spanish vocabulary words formatted for a crossword puzzle.

STRICT REQUIREMENTS:
- Each "spanish" field must use ONLY letters a-z — no accents (árbol → arbol, gato → gato)
- Word length: 3 to 12 letters only
- Mix of short (3–5) and longer (6–10) words for variety
- No compound words, no phrases, no words with spaces or hyphens

VOCABULARY:
${vocabContext}

CLUE RULES:
- clue_en: helpful English clue (not a direct translation — describe it, give context, or use a fill-in-the-blank sentence)
- clue_es: helpful Spanish clue (describe the word in Spanish without using the word itself)
- Both clues should be solvable by a true beginner

Return ONLY valid JSON, no markdown fences, no extra text:
{
  "words": [
    {
      "spanish": "gato",
      "clue_en": "This furry pet purrs and chases mice",
      "clue_es": "Animal doméstico que dice miau"
    },
    {
      "spanish": "agua",
      "clue_en": "You drink this when you're thirsty",
      "clue_es": "Líquido transparente que bebemos"
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

    // Validate shape
    if (!Array.isArray(parsed.words)) throw new Error('Invalid response shape');

    res.json(parsed);
  } catch (e) {
    console.error('Generate error:', e);
    res.status(500).json({ error: e.message });
  }
}

function extractJSON(text) {
  let s = text.trim()
    .replace(/^```json\s*/m, '')
    .replace(/^```\s*/m, '')
    .replace(/```\s*$/m, '')
    .trim();

  // Fix trailing commas before closing brackets
  s = s.replace(/,\s*([\]}])/g, '$1');

  // Normalize smart quotes
  s = s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');

  try {
    return JSON.parse(s);
  } catch {
    // Second attempt: extract just the JSON object
    const match = s.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Could not parse JSON from response');
  }
}
