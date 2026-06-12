export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { word, clue_en } = req.body;
  if (!word) return res.status(400).json({ error: 'Missing word' });

  const prompt = `A crossword puzzle learner is stuck on a Spanish vocabulary word.

The word is: "${word}"
The original clue was: "${clue_en}"

Give ONE short additional hint in English (1–2 sentences) that helps them figure it out without giving the answer away. You can:
- Give a memory trick or mnemonic
- Mention a related English cognate if one exists
- Add more context about when or how this word is used in everyday Spanish
- Relate it to a category or concept

Return ONLY valid JSON, no markdown:
{"hint": "your one hint here"}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    const text = data.content[0].text;
    const parsed = extractJSON(text);
    res.json(parsed);
  } catch (e) {
    console.error('Hint error:', e);
    res.status(500).json({ error: e.message });
  }
}

function extractJSON(text) {
  let s = text.trim()
    .replace(/^```json\s*/m, '').replace(/```\s*$/m, '').trim()
    .replace(/,\s*([\]}])/g, '$1')
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
  try {
    return JSON.parse(s);
  } catch {
    const match = s.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Could not parse hint JSON');
  }
}
