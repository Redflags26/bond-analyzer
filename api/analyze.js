export default async function handler(req, res) {
  // Allow cross-origin requests from local browser execution testing
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
    return res.status(500).json({ error: 'Missing API Key configuration inside Vercel Dashboard.' });
  }

  const systemPrompt = `You are an expert behavioral psychologist. Analyze the provided chat logs. 
  Return your response in a strict, valid JSON object format matching exactly this structure:
  {
    "bond_strength": "A percentage string ending with '%', reflecting conversational sync, trust, and alignment.",
    "summary": "A concise, single-sentence psychological profiling of the nature or core dynamic of the people involved."
  }`;

  try {
    const openRouterResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "openrouter/auto", // Highly stable and ultra-fast alternative
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: chatLog }
        ],
        response_format: { type: "json_object" },
        temperature: 0.3
      })
    });

    const responseText = await openRouterResponse.text();
    
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      return res.status(500).json({ error: `Upstream error. Server didn't send JSON: ${responseText}` });
    }

    if (!openRouterResponse.ok) {
      const errMsg = data.error?.message || data.error || JSON.stringify(data);
      return res.status(openRouterResponse.status).json({ error: `OpenRouter Message: ${errMsg}` });
    }

    // Safely extract the generation block text payload
    const contentText = data.choices[0].message.content;
    const result = JSON.parse(contentText);
    return res.status(200).json(result);

  } catch (error) {
    return res.status(500).json({ error: `System processing fault: ${error.message}` });
  }
}
