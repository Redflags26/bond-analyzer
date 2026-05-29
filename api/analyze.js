export default async function handler(req, res) {
  // Configure cross-origin safety configurations (CORS)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { chatLog } = req.body;
  const apiKey = process.env.OPENROUTER_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!apiKey || !supabaseUrl || !supabaseServiceKey) {
    return res.status(500).json({ error: 'Configuration Error: Operational keys are missing from your Vercel Settings panel.' });
  }

  const systemPrompt = `You are Truvah, an AI helper designed to read chat conversations and provide gentle, easy-to-understand insights into how two people talk to each other.
  Read the chat transcript and reply ONLY with a valid JSON object matching exactly this structure:
  {
    "bond_strength": "XX%",
    "bond_strength_reason": "A simple sentence explanation.",
    "bond_positivity": "XX%",
    "bond_positivity_reason": "A simple description.",
    "conflict_resolution": "XX%",
    "conflict_resolution_reason": "A simple note.",
    "safety_trust": "XX%",
    "safety_trust_reason": "A simple view.",
    "relationship_dynamics": "XX%",
    "relationship_dynamics_reason": "A simple breakdown.",
    "toxicity": "XX%",
    "toxicity_reason": "A simple note.",
    "summary": "A warm, helpful summary.",
    "profiles": [
      {
        "name": "Person 1",
        "attachment_security": "XX%",
        "attachment_security_reason": "One sentence.",
        "emotional_regulation": "XX%",
        "emotional_regulation_reason": "One sentence.",
        "receptivity": "XX%",
        "receptivity_reason": "One sentence.",
        "accountability": "XX%",
        "accountability_reason": "One sentence.",
        "actionables": ["Tip 1", "Tip 2"]
      },
      {
        "name": "Person 2",
        "attachment_security": "XX%",
        "attachment_security_reason": "One sentence.",
        "emotional_regulation": "XX%",
        "emotional_regulation_reason": "One sentence.",
        "receptivity": "XX%",
        "receptivity_reason": "One sentence.",
        "accountability": "XX%",
        "accountability_reason": "One sentence.",
        "actionables": ["Tip 1", "Tip 2"]
      }
    ]
  }`;

  try {
    const openRouterResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openrouter/auto", 
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: chatLog }],
        response_format: { type: "json_object" },
        temperature: 0.3
      })
    });

    const data = await openRouterResponse.json();
    const analysisMetrics = JSON.parse(data.choices[0].message.content);

    // Save to your controlled Supabase Cloud Storage using a zero-install network fetch
    try {
      await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/conversations`, {
        method: "POST",
        headers: {
          "apikey": supabaseServiceKey,
          "Authorization": `Bearer ${supabaseServiceKey}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({
          bond_strength: analysisMetrics.bond_strength,
          summary: analysisMetrics.summary,
          full_analytics: analysisMetrics
        })
      });
    } catch (dbError) { 
      console.error("Database tracking sync failed:", dbError.message); 
    }

    return res.status(200).json({ modelUsed: data.model, analytics: analysisMetrics });
  } catch (error) {
    return res.status(500).json({ error: 'Something went wrong while reading the chat.' });
  }
}
