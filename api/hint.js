export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { word, clue_en, clue_es, language = 'EN' } = req.body;
  if (!word) return res.status(400).json({ error: 'Missing word' });

  const isSpanish = language === 'ES';

  const prompt = isSpanish
    ? `Un jugador de crucigrama está atascado en una palabra en español.

La palabra es: "${word}"
La pista original en español fue: "${clue_es || clue_en}"

Da UNA pista adicional corta EN ESPAÑOL (1–2 oraciones) que ayude al jugador a deducir la palabra sin revelarla directamente. Puedes:
- Dar un ejemplo de uso en una oración corta
- Mencionar una categoría o contexto donde se usa
- Describir algo relacionado con su significado

Responde ÚNICAMENTE con JSON válido, sin markdown:
{"hint": "tu pista aquí"}`
    : `A crossword puzzle learner is stuck on a Spanish vocabulary word.

The word is: "${word}"
The original clue was: "${clue_en}"

Give ONE short additional hint IN ENGLISH (1–2 sentences) that helps them figure it out without giving the answer away. You can give a memory trick, English cognate, or usage context.

Return ONLY valid JSON, no markdown:
{"hint": "your hint here"}`;

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

    const parsed = extractJSON(data.content[0].text);
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
  try { return JSON.parse(s); }
  catch { const m = s.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); throw new Error('Could not parse hint JSON'); }
}
