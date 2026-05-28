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

  const systemPrompt = `You are the core analysis engine for RedFlags, an expert behavioral psychologist platform designed to catch relationship warning signs, evaluate macro metrics, and build individual deep-dive profiles using four specific core psychological dimensions.
  
  Analyze the provided chat logs thoroughly. Return your entire response in a strict, valid JSON object format matching exactly this structure:
  {
    "bond_strength": "XX%",
    "bond_strength_reason": "A concise, single-sentence psychological profiling summarizing conversational synchronization and trust indicators.",
    "bond_positivity": "XX%",
    "bond_positivity_reason": "A concise, single-sentence psychological one-liner mapping out the interaction's Receptivity, Empathy, Vulnerability, and Repair Attempts.",
    "conflict_resolution": "XX%",
    "conflict_resolution_reason": "A concise, single-sentence behavioral one-liner mapping out Emotional Regulation, Validation, Solution-Orientation, and Agreement Status.",
    "safety_trust": "XX%",
    "safety_trust_reason": "A concise, single-sentence diagnostic one-liner mapping out structural Security, Clarity, Vulnerability, and Emotional Residual.",
    "relationship_dynamics": "XX%",
    "relationship_dynamics_reason": "A concise, single-sentence behavioral one-liner mapping out partner Accountability, Aggression Levels, Shared Relevance, and Actionable Commitments.",
    "toxicity": "XX%",
    "toxicity_reason": "A concise, single-sentence clinical one-liner mapping out Low Regulation, High Aggression, Low Accountability, and High Resentment loops.",
    "summary": "A concise, single-sentence psychological profiling of the core dynamic of the people involved.",
    "profiles": [
      {
        "name": "Actual handle/name of Partner 1",
        "attachment_security": "XX%",
        "attachment_security_reason": "1-sentence reflecting whether they approach connections with baseline trust or default to anxiety, clinginess, or emotional shutdown when tension arises.",
        "emotional_regulation": "XX%",
        "emotional_regulation_reason": "1-sentence on their distinct ability to manage personal emotional spikes and stay grounded under pressure rather than succumbing to emotional flooding.",
        "receptivity": "XX%",
        "receptivity_reason": "1-sentence on their genuine willingness to listen, actively absorb another's point of view, and consider alternative perspectives without getting defensive.",
        "accountability": "XX%",
        "accountability_reason": "1-sentence on their capacity to recognize personal faults, own up to mistakes, and acknowledge their role instead of playing the victim or deflecting blame.",
        "actionables": [
          "Personalized growth recommendation 1 to help this specific individual break these negative patterns.",
          "Personalized growth recommendation 2 to help this specific individual break these negative patterns."
        ]
      },
      {
        "name": "Actual handle/name of Partner 2",
        "attachment_security": "XX%",
        "attachment_security_reason": "1-sentence reflecting whether they approach connections with baseline trust or default to anxiety, clinginess, or emotional shutdown when tension arises.",
        "emotional_regulation": "XX%",
        "emotional_regulation_reason": "1-sentence on their distinct ability to manage personal emotional spikes and stay grounded under pressure rather than succumbing to emotional flooding.",
        "receptivity": "XX%",
        "receptivity_reason": "1-sentence on their genuine willingness to listen, actively absorb another's point of view, and consider alternative perspectives without getting defensive.",
        "accountability": "XX%",
        "accountability_reason": "1-sentence on their capacity to recognize personal faults, own up to mistakes, and acknowledge their role instead of playing the victim or deflecting blame.",
        "actionables": [
          "Personalized growth recommendation 1 to help this specific individual break these negative patterns.",
          "Personalized growth recommendation 2 to help this specific individual break these negative patterns."
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
