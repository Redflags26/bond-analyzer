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
    return res.status(500).json({ error: 'System configuration error: Missing connection keys.' });
  }

  const systemPrompt = `You are Truvah, an AI helper designed to read chat conversations and provide gentle, easy-to-understand insights into how two people talk to each other. Your goal is to help them communicate better, avoid arguments, and understand each other's feelings.

  Use simple, conversational, and comforting language that a regular person would easily understand. Avoid technical jargon or complicated psychological terms.
  
  Read the chat transcript and reply ONLY with a valid JSON object matching exactly this structure:
  {
    "bond_strength": "XX%",
    "bond_strength_reason": "A simple, encouraging one-sentence explanation of how well these two people are connecting and listening to each other right now.",
    "bond_positivity": "XX%",
    "bond_positivity_reason": "A simple one-sentence description of the warmth, kindness, and openness shown in this talk.",
    "conflict_resolution": "XX%",
    "conflict_resolution_reason": "A simple one-sentence note on how well they handle disagreements and if they try to find common ground.",
    "safety_trust": "XX%",
    "safety_trust_reason": "A simple one-sentence view on how safe and secure both people feel sharing their true thoughts without fear.",
    "relationship_dynamics": "XX%",
    "relationship_dynamics_reason": "A simple one-sentence breakdown of how they share the conversation and treat each other's points.",
    "toxicity": "XX%",
    "toxicity_reason": "A simple, non-judgmental one-sentence note on any tension, defensive attitudes, or frustration in the text.",
    "summary": "A warm, helpful summary explaining what is going well in the relationship and what basic things they can work on together.",
    "profiles": [
      {
        "name": "Actual name of Person 1",
        "attachment_security": "XX%",
        "attachment_security_reason": "1 simple sentence explaining if they seem calm and secure, or if they get anxious or close off when upset.",
        "emotional_regulation": "XX%",
        "emotional_regulation_reason": "1 simple sentence about how well they manage their anger or frustration during the talk.",
        "receptivity": "XX%",
        "receptivity_reason": "1 simple sentence on how open they are to listening to the other person's side of the story.",
        "accountability": "XX%",
        "accountability_reason": "1 simple sentence showing if they are willing to say sorry or admit to their own mistakes.",
        "actionables": [
          "A practical, easy-to-do tip for this person to make the next conversation smoother.",
          "A simple phrase or action they can try next time things feel tense."
        ]
      },
      {
        "name": "Actual name of Person 2",
        "attachment_security": "XX%",
        "attachment_security_reason": "1 simple sentence explaining if they seem calm and secure, or if they get anxious or close off when upset.",
        "emotional_regulation": "XX%",
        "emotional_regulation_reason": "1 simple sentence about how well they manage their anger or frustration during the talk.",
        "receptivity": "XX%",
        "receptivity_reason": "1 simple sentence on how open they are to listening to the other person's side of the story.",
        "accountability": "XX%",
        "accountability_reason": "1 simple sentence showing if they are willing to say sorry or admit to their own mistakes.",
        "actionables": [
          "A practical, easy-to-do tip for this person to make the next conversation smoother.",
          "A simple phrase or action they can try next time things feel tense."
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
      return res.status(openRouterResponse.status).json({ error: 'Could not read conversation properly.' });
    }

    const analysisMetrics = JSON.parse(data.choices[0].message.content);
    return res.status(200).json({
      modelUsed: data.model || "truvah-core",
      analytics: analysisMetrics
    });

  } catch (error) {
    return res.status(500).json({ error: 'Something went wrong while reading the chat.' });
  }
}
