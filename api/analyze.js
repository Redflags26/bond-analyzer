/**
 * UPGRADED TIMELINE CONTEXT LAYER
 * Binds the time delay directly to the speaker who took long to reply.
 * This directly forces the LLM to score their personal accountability and emotional regulation.
 */
function injectTimeGapContext(text) {
  if (!text || typeof text !== 'string') return '';

  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  const processedLines = [];
  let lastTimestamp = null;

  // Pattern to extract timestamp inside brackets and the rest of the line
  const timestampRegex = /^\[([^\]]+)\](.*)$/;

  for (let line of lines) {
    const match = timestampRegex.exec(line);
    
    if (match) {
      try {
        const rawDateStr = match[1].replace(/([ap]m)/i, ' $1');
        const remainingLineContent = match[2];
        const currentTimestamp = Date.parse(rawDateStr) || new Date(rawDateStr).getTime();

        if (currentTimestamp && lastTimestamp) {
          const deltaMilliseconds = currentTimestamp - lastTimestamp;
          const deltaHours = deltaMilliseconds / (1000 * 60 * 60);

          // If there is a meaningful delay (6 hours or more)
          if (deltaHours >= 6) {
            const roundedHours = Math.round(deltaHours);
            let delayTag = ` [Replied after a delay of ${roundedHours} hours]`;
            
            if (deltaHours >= 24) {
              const roundedDays = Math.round(deltaHours / 24);
              delayTag = ` [Replied after a long delay of ${roundedDays} day(s)]`;
            }

            // INJECTION MATRIX: Inject the delay note directly into this speaker's message header
            const enhancedLine = `[${match[1]}]${delayTag}${remainingLineContent}`;
            processedLines.push(enhancedLine);
            lastTimestamp = currentTimestamp;
            continue;
          }
        }

        if (currentTimestamp) {
          lastTimestamp = currentTimestamp;
        }
      } catch (e) {
        // Safe fallback tracking
      }
    }
    processedLines.push(line);
  }

  return processedLines.join('\n');
}

export default async function handler(req, res) {
  // CORS Security Handlers
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
  // AGENT 1: PERSONA & SUBJECT SPECIALIST (Sharpened for Gaps)
  // ==========================================
  const personaPrompt = `You are a psychological behavioral specialist focused on individual profiling. 
  Analyze the provided chat transcript, identify the two primary speakers, and evaluate their traits.
  
  CRITICAL INPUT CRITERIA: Look for explicit '[Replied after a delay of...]' tags attached to message headers. 
  - Treat unannounced multi-hour or multi-day delays as avoidant behavior, emotional withdrawal, or a struggle with emotional regulation.
  - If a speaker consistently leaves the other hanging, heavily penalize their 'emotional_regulation' and 'receptivity' scores, and document it in their reason string.
  
  Return ONLY a valid JSON object matching this exact schema:
  {
    "profiles": [
      {
        "name": "Actual name of Person 1",
        "attachment_security": "XX%",
        "attachment_security_reason": "1 simple sentence explaining if they seem calm and secure, or if they withdraw/get anxious using text delays.",
        "emotional_regulation": "XX%",
        "emotional_regulation_reason": "1 simple sentence about how well they manage their response pacing, delays, or irritation during the talk.",
        "receptivity": "XX%",
        "receptivity_reason": "1 simple sentence on how open they are to listening, taking into account if they shut down or delay responding.",
        "accountability": "XX%",
        "accountability_reason": "1 simple sentence showing if they acknowledge their delays or admit to mistakes."
      },
      {
        "name": "Actual name of Person 2",
        "attachment_security": "XX%",
        "attachment_security_reason": "1 simple sentence explaining if they seem calm and secure, or if they withdraw/get anxious using text delays.",
        "emotional_regulation": "XX%",
        "emotional_regulation_reason": "1 simple sentence about how well they manage their response pacing, delays, or irritation during the talk.",
        "receptivity": "XX%",
        "receptivity_reason": "1 simple sentence on how open they are to listening, taking into account if they shut down or delay responding.",
        "accountability": "XX%",
        "accountability_reason": "1 simple sentence showing if they acknowledge their delays or admit to mistakes."
      }
    ]
  }`;

  // ==========================================
  // AGENT 2: RELATIONSHIP DYNAMICS SPECIALIST (Sharpened for Gaps)
  // ==========================================
  const dynamicsPrompt = `You are an interpersonal relationship dynamics expert. 
  Analyze the provided chat transcript and evaluate macro connection metrics.
  
  CRITICAL INPUT CRITERIA: Pay heavy attention to '[Replied after a delay of...]' metrics.
  - Long unaddressed time gaps signal communication breakdowns, stonewalling, or a lack of real-time conversational momentum.
  - Adjust 'conflict_resolution' lower if arguments are left unresolved for days.
  - Adjust 'toxicity' higher if the delay functions as a silent treatment or passive-aggressive block.
  
  Return ONLY a valid JSON object matching this exact schema:
  {
    "bond_strength": "XX%",
    "bond_strength_reason": "A simple sentence explaining how well they connect, incorporating the impact of conversational pacing and pauses.",
    "bond_positivity": "XX%",
    "bond_positivity_reason": "A simple description of warmth vs. cold distances/delays in this talk.",
    "conflict_resolution": "XX%",
    "conflict_resolution_reason": "A simple note on whether they resolve issues quickly or let them fester over long time gaps.",
    "safety_trust": "XX%",
    "safety_trust_reason": "A simple view on how secure both feel, or if text delays create conversational anxiety.",
    "relationship_dynamics": "XX%",
    "relationship_dynamics_reason": "A simple breakdown of the conversational rhythm, turn-taking, and response lag handling.",
    "toxicity": "XX%",
    "toxicity_reason": "A simple note on tension, defense mechanisms, or frustration caused by silent gaps.",
    "summary": "A warm, helpful summary explaining relationship health and how to handle communication pacing or response delays together."
  }`;

  // ==========================================
  // AGENT 3: THE STRATEGIST (Sharpened for Gaps)
  // ==========================================
  const makeStrategistPrompt = (personaData, dynamicsData) => {
    return `You are a relationship counselor and action-oriented strategist.
    Review these structural evaluation profiles compiled by your specialized analysis agents:
    
    Individual Profiles: ${JSON.stringify(personaData)}
    Macro Dynamics: ${JSON.stringify(dynamicsData)}
    
    Based ONLY on this information, generate practical, customized tips for both individuals.
    If long response gaps or silent intervals were noted, generate at least one action step specifically advising how to communicate response expectations better (e.g., 'Let the other person know if you need space instead of dropping off'). Do not reference scores.
    
    Return ONLY a valid JSON object matching this exact schema:
    {
      "person1_actionables": [
        "A practical, easy-to-do tip for this person to make the next conversation smoother.",
        "A simple phrase or action they can try next time things feel tense or delayed."
      ],
      "person2_actionables": [
        "A practical, easy-to-do tip for this person to make the next conversation smoother.",
        "A simple phrase or action they can try next time things feel tense or delayed."
      ]
    }`;
  };

  // Helper function to call OpenRouter via fetch
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
