export default async function handler(req, res) {
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
    return res.status(500).json({ error: 'Missing API Key configuration.' });
  }

  // CHANGED: Completely overhauled the system prompt schema to generate percentage metrics & specific 1-liners for the 4 new dimensions
  const systemPrompt = `You are an expert behavioral psychologist. Analyze the provided chat log between two partners.
  Evaluate macro relationship metrics and build individual deep-dive profiles using four specific core psychological dimensions.
  
  Return your response in a strict, valid JSON object format matching exactly this structure:
  {
    "bond_strength": "XX%",
    "bond_strength_reason": "...",
    "bond_positivity": "XX%",
    "bond_positivity_reason": "...",
    "conflict_resolution": "XX%",
    "conflict_resolution_reason": "...",
    "safety_trust": "XX%",
    "safety_trust_reason": "...",
    "relationship_dynamics": "XX%",
    "relationship_dynamics_reason": "...",
    "toxicity": "XX%",
    "toxicity_reason": "...",
    "summary": "...",
    "profiles": [
      {
        "name": "Actual handle/name of Partner 1",
        "attachment_security": "XX%",
        "attachment_security_reason": "1-sentence on whether they lean secure, anxious/clingy, or avoidant/shutdown here.",
        "emotional_regulation": "XX%",
        "emotional_regulation_reason": "1-sentence on their ability to stay grounded under pressure vs succumbing to flooding.",
        "receptivity": "XX%",
        "receptivity_reason": "1-sentence on willingness to absorb perspectives without immediately getting defensive.",
        "accountability": "XX%",
        "accountability_reason": "1-sentence on owning their mistakes and specific role vs deflecting/playing the victim.",
        "actionables": [
          "Personalized growth recommendation 1",
          "Personalized growth recommendation 2"
        ]
      },
      {
        "name": "Actual handle/name of Partner 2",
        "attachment_security": "XX%",
        "attachment_security_reason": "1-sentence on whether they lean secure, anxious/clingy, or avoidant/shutdown here.",
        "emotional_regulation": "XX%",
        "emotional_regulation_reason": "1-sentence on their ability to stay grounded under pressure vs succumbing to flooding.",
        "receptivity": "XX%",
        "receptivity_reason": "1-sentence on willingness to absorb perspectives without immediately getting defensive.",
        "accountability": "XX%",
        "accountability_reason": "1-sentence on owning their mistakes and specific role vs deflecting/playing the victim.",
        "actionables": [
          "Personalized growth recommendation 1",
          "Personalized growth recommendation 2"
        ]
      }
    ]
  }`;

  try {
    const openRouterResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "openrouter/auto", 
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: chatLog }
        ],
        response_format: { type: "json_object" },
        temperature: 0.3
      })
    });

    const responseText = await openRouterResponse.text();
    const data = JSON.parse(responseText);

    if (!openRouterResponse.ok) {
      return res.status(openRouterResponse.status).json({ error: data.error || 'API Error' });
    }

    const analysisMetrics = JSON.parse(data.choices[0].message.content);
    return res.status(200).json({
      modelUsed: data.model || "openrouter/auto-selected",
      analytics: analysisMetrics
    });

  } catch (error) {
    return res.status(500).json({ error: `System processing fault: ${error.message}` });
  }
}
