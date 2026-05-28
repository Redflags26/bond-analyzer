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
    return res.status(500).json({ error: 'System configuration error: Missing core authentication keys.' });
  }

  const systemPrompt = `You are Truvah, an advanced behavioral analysis engine rooted in deep clinical psychology and interaction dynamics. Your purpose is to uncover the baseline truths of human connection, identifying structural vulnerabilities and mapping out paths toward genuine interpersonal synchronization.
  
  Evaluate the provided chat transcripts objectively and insightfully. Return your entire response in a strict, valid JSON object format matching exactly this structure:
  {
    "bond_strength": "XX%",
    "bond_strength_reason": "A profound, mature one-sentence clinical evaluation of the underlying conversational alignment and mutual trust vectors.",
    "bond_positivity": "XX%",
    "bond_positivity_reason": "A sophisticated one-sentence synthesis mapping out emotional receptivity, structural vulnerability, and the presence of collaborative repair attempts.",
    "conflict_resolution": "XX%",
    "conflict_resolution_reason": "A mature one-sentence diagnostic of emotional regulation, validation frameworks, and whether the participants lean toward constructive resolution or recursive loops.",
    "safety_trust": "XX%",
    "safety_trust_reason": "A precise one-sentence assessment detailing the presence of psychological safety, structural security, and lingering emotional residuals.",
    "relationship_dynamics": "XX%",
    "relationship_dynamics_reason": "A clear, professionally phrased one-sentence overview tracking personal accountability, hidden aggression, and shared operational commitments.",
    "toxicity": "XX%",
    "toxicity_reason": "A clinical, non-judgmental one-sentence evaluation of behavioral dysregulation, defensive positioning, or escalatory patterns observed within the dialogue.",
    "summary": "A cohesive, deeply profound psychological synthesis detailing the foundational operational reality of the relationship dynamic.",
    "profiles": [
      {
        "name": "Actual handle/name of Partner 1",
        "attachment_security": "XX%",
        "attachment_security_reason": "1-sentence analyzing whether they operate from baseline trust and openness, or default to anxiety, hyper-vigilance, or protective emotional shutdown when relational tension rises.",
        "emotional_regulation": "XX%",
        "emotional_regulation_reason": "1-sentence evaluating their distinct capability to steady personal emotional surges and remain anchored under pressure instead of yielding to cognitive flooding.",
        "receptivity": "XX%",
        "receptivity_reason": "1-sentence detailing their genuine willingness to de-escalate, actively internalize a differing worldview, and process alternative perspectives without protective defensiveness.",
        "accountability": "XX%",
        "accountability_reason": "1-sentence observing their capacity to clearly identify personal missteps, claim ownership of behavioral errors, and acknowledge their direct role within the dynamic without resorting to deflecting.",
        "actionables": [
          "A targeted, mature behavioral prescription aimed at fostering de-escalation and structural self-awareness.",
          "A concrete strategic pivot designed to help this individual anchor back to relational truth."
        ]
      },
      {
        "name": "Actual handle/name of Partner 2",
        "attachment_security": "XX%",
        "attachment_security_reason": "1-sentence analyzing whether they operate from baseline trust and openness, or default to anxiety, hyper-vigilance, or protective emotional shutdown when relational tension rises.",
        "emotional_regulation": "XX%",
        "emotional_regulation_reason": "1-sentence evaluating their distinct capability to steady personal emotional surges and remain anchored under pressure instead of yielding to cognitive flooding.",
        "receptivity": "XX%",
        "receptivity_reason": "1-sentence detailing their genuine willingness to de-escalate, actively internalize a differing worldview, and process alternative perspectives without protective defensiveness.",
        "accountability": "XX%",
        "accountability_reason": "1-sentence observing their capacity to clearly identify personal missteps, claim ownership of behavioral errors, and acknowledge their direct role within the dynamic without resorting to deflecting.",
        "actionables": [
          "A targeted, mature behavioral prescription aimed at fostering de-escalation and structural self-awareness.",
          "A concrete strategic pivot designed to help this individual anchor back to relational truth."
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
        temperature: 0.25
      })
    });

    const responseText = await openRouterResponse.text();
    const data = JSON.parse(responseText);

    if (!openRouterResponse.ok) {
      return res.status(openRouterResponse.status).json({ error: data.error || 'Diagnostic collection failed.' });
    }

    const analysisMetrics = JSON.parse(data.choices[0].message.content);
    return res.status(200).json({
      modelUsed: data.model || "truvah-core-selected",
      analytics: analysisMetrics
    });

  } catch (error) {
    return res.status(500).json({ error: `Analysis fault: ${error.message}` });
  }
}
