/**
 * 1. HIGH-STABILITY TIMELINE CONTEXT LAYER
 * Safely handles parsing without breaking regional date formatting structures.
 */
function injectTimeGapContext(text) {
  if (!text || typeof text !== 'string') return '';

  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  const processedLines = [];
  let lastTimestamp = null;

  const linePattern = /^\[(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4}),\s*([^\]]+)\](.*)$/;

  for (let line of lines) {
    const match = linePattern.exec(line);
    
    if (match) {
      try {
        const day = parseInt(match[1], 10);
        const month = parseInt(match[2], 10) - 1; 
        const year = parseInt(match[3], 10);
        let timePart = match[4].trim();
        const remainingLineContent = match[5];

        const standardizedTimeStr = `${year}/${month + 1}/${day} ${timePart.replace(/([ap]m)/i, ' $1')}`;
        const currentTimestamp = new Date(standardizedTimeStr).getTime();

        if (currentTimestamp && lastTimestamp) {
          const deltaMilliseconds = currentTimestamp - lastTimestamp;
          const deltaHours = deltaMilliseconds / (1000 * 60 * 60);

          if (deltaHours >= 6 && deltaHours < 2000) { 
            const roundedHours = Math.round(deltaHours);
            let delayTag = ` [Replied after a delay of ${roundedHours} hours]`;
            
            if (deltaHours >= 24) {
              const roundedDays = Math.round(deltaHours / 24);
              delayTag = ` [Replied after a long delay of ${roundedDays} day(s)]`;
            }

            const enhancedLine = `[${match[1]}/${match[2]}/${match[3]}, ${match[4]}]${delayTag}${remainingLineContent}`;
            processedLines.push(enhancedLine);
            lastTimestamp = currentTimestamp;
            continue;
          }
        }

        if (currentTimestamp) {
          lastTimestamp = currentTimestamp;
        }
      } catch (e) {
        // Safe bypass tracking
      }
    }
    processedLines.push(line);
  }

  return processedLines.join('\n');
}

export default async function handler(req, res) {
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
    return res.status(500).json({ error: 'Configuration Error: Operational keys are missing.' });
  }

  const enrichedChatLog = injectTimeGapContext(chatLog);

  // ==========================================
  // AGENT 1: PERSONA & SUBJECT SPECIALIST (Dramatically Calibrated)
  // ==========================================
  const personaPrompt = `You are a psychological behavioral specialist focused on individual communication profiling. 
  Analyze the chat transcript and evaluate their traits using comforting, simple language.
  
  CRITICAL SCORING WEIGHT CALIBRATION:
  - Look for '[Replied after a delay of...]' markers, but evaluate them dynamically alongside the reply text.
  - REPAIR ATTEMPT CREDIT: If a person replies late but immediately apologizes ('sorry', 'guilty'), gives context ('hectic day', 'busy'), or proactively validates the other partner ('you're special', 'always on my mind'), you MUST reward this behavior. Boost their 'accountability' and 'attachment_security' scores significantly.
  - Only apply scoring penalties if the delay is met with coldness, zero explanation, complete deflection, or a total avoidance of the partner's emotional bids.
  
  Return ONLY a valid JSON object matching this exact schema:
  {
    "profiles": [
      {
        "name": "Actual name of Person 1",
        "attachment_security": "XX%",
        "attachment_security_reason": "1 simple sentence taking into account both text delays and any warm validation/apologies offered.",
        "emotional_regulation": "XX%",
        "emotional_regulation_reason": "1 simple sentence about how smoothly they manage response pacing or make up for delays.",
        "receptivity": "XX%",
        "receptivity_reason": "1 simple sentence on how open they are to listening and responding warm-heartedly.",
        "accountability": "XX%",
        "accountability_reason": "1 simple sentence tracking if they explicitly own up to their response lags or text absences."
      },
      {
        "name": "Actual name of Person 2",
        "attachment_security": "XX%",
        "attachment_security_reason": "1 simple sentence taking into account both text delays and any warm validation/apologies offered.",
        "emotional_regulation": "XX%",
        "emotional_regulation_reason": "1 simple sentence about how smoothly they manage response pacing or make up for delays.",
        "receptivity": "XX%",
        "receptivity_reason": "1 simple sentence on how open they are to listening and responding warm-heartedly.",
        "accountability": "XX%",
        "accountability_reason": "1 simple sentence tracking if they explicitly own up to their response lags or text absences."
      }
    ]
  }`;

  // ==========================================
  // AGENT 2: RELATIONSHIP DYNAMICS SPECIALIST (Dramatically Calibrated)
  // ==========================================
  const dynamicsPrompt = `You are an interpersonal relationship dynamics expert. 
  Analyze the transcript and evaluate macro connection metrics using warm, comforting language.
  
  CRITICAL SCORING WEIGHT CALIBRATION:
  - Do not blindly tank metrics for conversational pauses if the couple exhibits a healthy asynchronous flow.
  - REPAIR ATTEMPT IMPACT: If delays are consistently balanced by verbal reassurance, sweet check-ins, or explicit accountability, elevate 'conflict_resolution' and 'safety_trust' to reflect that the relationship handles pauses with high security.
  - 'toxicity' must stay extremely low (0-10%) if delays are benign or accompanied by loving repair statements, scaling up only if the silence is weaponized or hostile.
  
  Return ONLY a valid JSON object matching this exact schema:
  {
    "bond_strength": "XX%",
    "bond_strength_reason": "A warm, balanced summary sentence factoring in mutual affection alongside response delays.",
    "bond_positivity": "XX%",
    "bond_positivity_reason": "A simple sentence acknowledging how warmth and repair strategies protect the relationship mood.",
    "conflict_resolution": "XX%",
    "conflict_resolution_reason": "A simple sentence tracking how well apologies and assurances smooth over communication gaps.",
    "safety_trust": "XX%",
    "safety_trust_reason": "A simple view of security, weighing whether proactive reassurances effectively minimize conversational anxiety.",
    "relationship_dynamics": "XX%",
    "relationship_dynamics_reason": "A descriptive analysis of how their texting rhythm works when factoring in sweet repairs.",
    "toxicity": "XX%",
    "toxicity_reason": "A clear, fair look at whether gaps produce true stress or if they are softened by affectionate care.",
    "summary": "A warm, realistic, helpful summary highlighting the mutual affection and comforting repairs, while offering gentle guidance on aligning texting rhythms."
  }`;

  // ==========================================
  // AGENT 3: THE STRATEGIST
  // ==========================================
  const makeStrategistPrompt = (personaData, dynamicsData) => {
    return `You are a relationship counselor and action-oriented strategist.
    Review these structural evaluation profiles compiled by your specialized analysis agents:
    
    Individual Profiles: ${JSON.stringify(personaData)}
    Macro Dynamics: ${JSON.stringify(dynamicsData)}
    
    Based ONLY on this information, generate practical, easy-to-do tips for both individuals.
    If the data shows that apologies and warm validation are already present, tailor action steps to help them maintain that secure habit while finding better real-time alignments. Use plain language. Do not show raw numbers.
    
    Return ONLY a valid JSON object matching this exact schema:
    {
      "person1_actionables": [
        "A practical, easy-to-do tip for this person to make the next conversation smoother.",
        "A simple phrase or action they can try next time things feel tense."
      ],
      "person2_actionables": [
        "A practical, easy-to-do tip for this person to make the next conversation smoother.",
        "A simple phrase or action they can try next time things feel tense."
      ]
    }`;
  };

  async function queryAgent(systemInstructions, userContent) {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "openrouter/auto", 
        messages: [
          { role: "system", content: systemInstructions },
          { role: "user", content: userContent }
        ],
        response_format: { type: "json_object" },
        temperature: 0.3
      })
    });
    
    if (!response.ok) throw new Error(`OpenRouter agent call failed with status ${response.status}`);
    const resData = await response.json();
    return JSON.parse(resData.choices[0].message.content);
  }

  try {
    const [personaResults, dynamicsResults] = await Promise.all([
      queryAgent(personaPrompt, enrichedChatLog),
      queryAgent(dynamicsPrompt, enrichedChatLog)
    ]);

    const strategistPrompt = makeStrategistPrompt(personaResults, dynamicsResults);
    const strategies = await queryAgent(strategistPrompt, enrichedChatLog);

    const finalAnalyticsResult = {
      bond_strength: dynamicsResults.bond_strength,
      bond_strength_reason: dynamicsResults.bond_strength_reason,
      bond_positivity: dynamicsResults.bond_positivity,
      bond_positivity_reason: dynamicsResults.bond_positivity_reason,
      conflict_resolution: dynamicsResults.conflict_resolution,
      conflict_resolution_reason: dynamicsResults.conflict_resolution_reason,
      safety_trust: dynamicsResults.safety_trust,
      safety_trust_reason: dynamicsResults.safety_trust_reason,
      relationship_dynamics: dynamicsResults.relationship_dynamics,
      relationship_dynamics_reason: dynamicsResults.relationship_dynamics_reason,
      toxicity: dynamicsResults.toxicity,
      toxicity_reason: dynamicsResults.toxicity_reason,
      summary: dynamicsResults.summary,
      profiles: [
        {
          ...personaResults.profiles[0],
          actionables: strategies.person1_actionables
        },
        {
          ...personaResults.profiles[1],
          actionables: strategies.person2_actionables
        }
      ]
    };

    try {
      const cleanDbUrl = supabaseUrl.replace(/\/$/, "");
      await fetch(`${cleanDbUrl}/rest/v1/conversations`, {
        method: "POST",
        headers: {
          "apikey": supabaseServiceKey,
          "Authorization": `Bearer ${supabaseServiceKey}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({
          bond_strength: finalAnalyticsResult.bond_strength,
          summary: finalAnalyticsResult.summary,
          full_analytics: finalAnalyticsResult
        })
      });
    } catch (dbError) {
      console.error("Database storage tracking failure:", dbError.message);
    }

    return res.status(200).json({
      modelUsed: "multi-agent-pipeline",
      analytics: finalAnalyticsResult
    });

  } catch (error) {
    console.error("Pipeline breakdown error:", error.message);
    return res.status(500).json({ error: 'Something went wrong while executing focused agent pipelines.' });
  }
}
