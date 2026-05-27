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
    return res.status(500).json({ error: 'Missing API Key configuration inside Vercel Dashboard.' });
  }

  const systemPrompt = `You are an expert behavioral psychologist specializing in couples counseling and interaction analysis. Your task is to evaluate a provided chat log between two partners by systematically breaking it down into a specific behavioral framework, profiling each individual natively, and providing tailored behavioral action items.

  ### ANALYSIS FRAMEWORK
  Before generating the scores, internally evaluate the conversation across these four foundational pillars and their core parameters:
  1. Individual Profile (The "Who"): Attachment Style/Security, Emotional Regulation, Receptivity/Openness, and Self-Awareness/Accountability.
  2. Conversation Style (The "How"): Validation vs. Defensiveness, Aggression Level, Empathy/Attunement, and Clarity/Directness.
  3. The Topic (The "What"): Vulnerability Level, Volatility/Trigger Potential, Solution-Orientation, and Shared Relevance.
  4. Outcome & Actions (The "Where To"): Resolution Status, Repair Attempts, Actionable Commitments, and Emotional Residual.

  ### DRIVERS FOR MACRO TONES
  Derive your percentage metrics by synthesizing the parameters as follows:
  - Bond Positivity: Driven by Receptivity, Empathy, Vulnerability, and Repair Attempts.
  - Conflict Resolution: Driven by Emotional Regulation, Validation, Solution-Orientation, and Agreement Status.
  - Safety & Trust: Driven by Security, Clarity, Vulnerability, and Emotional Residual.
  - Relationship Dynamics: Driven by Accountability, Aggression Level, Shared Relevance, and Actionable Commitments.
  - Toxicity: Driven by Low Regulation, High Aggression, Low Accountability, and High Resentment.
  - Bond Strength: An overall synthesis reflecting conversational synchronization, active engagement, and historical trust indicators.

  Analyze the provided chat logs thoroughly. Return your entire response in a strict, valid JSON object format matching exactly this structure:
  {
    "bond_strength": "A percentage string ending with '%'.",
    "bond_strength_reason": "A concise, single-sentence psychological profiling summarizing conversational synchronization, active engagement, and trust indicators.",
    "bond_positivity": "A percentage string ending with '%'.",
    "bond_positivity_reason": "A concise, single-sentence psychological one-liner mapping out the interaction's Receptivity, Empathy, Vulnerability, and Repair Attempts.",
    "conflict_resolution": "A percentage string ending with '%'.",
    "conflict_resolution_reason": "A concise, single-sentence behavioral one-liner mapping out Emotional Regulation, Validation, Solution-Orientation, and Agreement Status.",
    "safety_trust": "A percentage string ending with '%'.",
    "safety_trust_reason": "A concise, single-sentence diagnostic one-liner mapping out structural Security, Clarity, Vulnerability, and Emotional Residual.",
    "relationship_dynamics": "A percentage string ending with '%'.",
    "relationship_dynamics_reason": "A concise, single-sentence behavioral one-liner mapping out partner Accountability, Aggression Levels, Shared Relevance, and Actionable Commitments.",
    "toxicity": "A percentage string ending with '%'.",
    "toxicity_reason": "A concise, single-sentence clinical one-liner mapping out Low Regulation, High Aggression, Low Accountability, and High Resentment loops.",
    "summary": "A concise, single-sentence psychological profiling of the core dynamic of the people involved.",
    "profiles": [
      {
        "name": "The actual name or handle of Partner 1 extracted from the log",
        "attachment_style": "Identified attachment style dynamic pattern displayed in this interaction context",
        "emotional_regulation": "Brief clinical assessment of how they manage their physiological/verbal triggers here",
        "communication_style": "1-2 word description of their style (e.g., Avoidant-Defensive, Attuned-Expressive)",
        "actionables": [
          "First concrete, highly personalized behavioral recommendation for this specific partner to improve relationship bond strength.",
          "Second concrete, highly personalized behavioral recommendation for this specific partner to improve relationship bond strength."
        ]
      },
      {
        "name": "The actual name or handle of Partner 2 extracted from the log",
        "attachment_style": "Identified attachment style dynamic pattern displayed in this interaction context",
        "emotional_regulation": "Brief clinical assessment of how they manage their physiological/verbal triggers here",
        "communication_style": "1-2 word description of their style",
        "actionables": [
          "First concrete, highly personalized behavioral recommendation for this specific partner to improve relationship bond strength.",
          "Second concrete, highly personalized behavioral recommendation for this specific partner to improve relationship bond strength."
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
    
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      return res.status(500).json({ error: `Upstream server didn't send JSON: ${responseText}` });
    }

    if (!openRouterResponse.ok) {
      const errMsg = data.error?.message || data.error || JSON.stringify(data);
      return res.status(openRouterResponse.status).json({ error: `OpenRouter Message: ${errMsg}` });
    }

    const resolvedModelName = data.model || "openrouter/auto-selected";
    const contentText = data.choices[0].message.content;
    const analysisMetrics = JSON.parse(contentText);
    
    return res.status(200).json({
      modelUsed: resolvedModelName,
      analytics: analysisMetrics
    });

  } catch (error) {
    return res.status(500).json({ error: `System processing fault: ${error.message}` });
  }
}
