export default async function handler(req, res) {
  // Enable CORS so your local browser file can talk to it if needed
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { chatLog } = req.body;
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'OpenRouter API key is not configured on Vercel' });
  }

  const systemPrompt = `You are a behavioral psychologist. Analyze the provided chat logs. 
  Return your response in strict JSON format matching exactly this structure:
  {
    "bond_strength": "A percentage string ending with '%', reflecting conversational sync and trust.",
    "summary": "A concise, single-sentence summary profiling the nature or dynamic of the people involved."
  }`;

  try {
    const openRouterResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "deepseek/deepseek-v4-flash:free",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: chatLog }
        ],
        response_format: { type: "json_object" },
        temperature: 0.3
      })
    });

    const data = await openRouterResponse.json();
    
    if (!openRouterResponse.ok) {
      return res.status(openRouterResponse.status).json({ error: data });
    }

    // Pass the AI result back to the frontend
    const content = JSON.parse(data.choices[0].message.content);
    return res.status(200).json(content);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
