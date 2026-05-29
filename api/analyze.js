/**
 * 1. HIGH-STABILITY TIMELINE CONTEXT LAYER
 * - Manually splits DD/MM/YYYY sequences to guarantee 100% precision with Indian/European log structures.
 * - Injects context tags inline next to the user's name metadata so the models assign the pacing accurately.
 */
function injectTimeGapContext(text) {
  if (!text || typeof text !== 'string') return '';

  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  const processedLines = [];
  let lastTimestamp = null;

  // Strict regex extraction pattern for format: [DD/MM/YYYY, HH:MM AM/PM]
  const linePattern = /^\[(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4}),\s*([^\]]+)\](.*)$/;

  for (let line of lines) {
    const match = linePattern.exec(line);
    
    if (match) {
      try {
        const day = parseInt(match[1], 10);
        const month = parseInt(match[2], 10) - 1; // JS months are zero-indexed (0 = Jan, 5 = June)
        const year = parseInt(match[3], 10);
        let timePart = match[4].trim();
        const remainingLineContent = match[5];

        // Format standard string for reliable time construction mapping
        const standardizedTimeStr = `${year}/${month + 1}/${day} ${timePart.replace(/([ap]m)/i, ' $1')}`;
        const currentTimestamp = new Date(standardizedTimeStr).getTime();

        if (currentTimestamp && lastTimestamp) {
          const deltaMilliseconds = currentTimestamp - lastTimestamp;
          const deltaHours = deltaMilliseconds / (1000 * 60 * 60);

          // Only process positive gaps of 6 hours or greater to filter out normal message rhythms
          if (deltaHours >= 6 && deltaHours < 2000) { 
            const roundedHours = Math.round(deltaHours);
            let delayTag = ` [Replied after a delay of ${roundedHours} hours]`;
            
            if (deltaHours >= 24) {
              const roundedDays = Math.round(deltaHours / 24);
              delayTag = ` [Replied after a long delay of ${roundedDays} day(s)]`;
            }

            // Bind the delay metric straight inside the bracket metadata line boundary
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
        console.error("Date extraction bypass note:", e.message);
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
    return res.status(500).json({ error: 'Configuration Error: Operational keys are missing from your Settings panel.' });
  }

  // Pre-process the raw text to execute accurate, bullet-proof timeline tracking
  const enrichedChatLog = injectTimeGapContext(chatLog);

  // ==========================================
  // AGENT 1: PERSONA & SUBJECT SPECIALIST
  // ==========================================
  const personaPrompt = `You are a psychological behavioral specialist focused exclusively on individual profiling. 
  Analyze the provided chat transcript, identify the two primary speakers, and evaluate their traits using simple language.
  
  CRITICAL EVALUATION REGULATION:
  - Look for '[Replied after a delay of...]' metrics inside message headers. 
  - Evaluate text delays based on the context of the transcript. Only treat delays as avoidant if there is active conflict or evasion. 
  - If a sequence consists of affectionate, everyday, friendly, or asynchronous check-ins, treat delays of 6-24 hours as standard routine breaks due to work or sleep schedules, maintaining high scores.
  
  Return ONLY a valid JSON object matching this exact schema:
  {
    "profiles": [
      {
        "name": "Actual name of Person 1",
        "attachment_security": "XX%",
        "attachment_security_reason": "1 simple sentence explaining if they seem calm and secure, or if they get anxious or close off when upset.",
        "emotional_regulation": "XX%",
        "emotional_regulation_reason": "1 simple sentence about how well they manage their anger, frustration, or conversational pacing.",
        "receptivity": "XX%",
        "receptivity_reason": "1 simple sentence on how open they are to listening to the other person's side of the story.",
        "accountability": "XX%",
        "accountability_reason": "1 simple sentence showing if they are willing to say sorry or admit to their own mistakes."
      },
      {
        "name": "Actual name of Person 2",
        "attachment_security": "XX%",
        "attachment_security_reason": "1 simple sentence explaining if they seem calm and secure, or if they get anxious or close off when upset.",
        "emotional_regulation": "XX%",
        "emotional_regulation_reason": "1 simple sentence about how well they manage their anger, frustration, or conversational pacing.",
        "receptivity": "XX%",
        "receptivity_reason": "1 simple sentence on how open they are to listening to the other person's side of the story.",
        "accountability": "XX%",
        "accountability_reason": "1 simple sentence showing if they are willing to say sorry or admit to their own mistakes."
      }
    ]
  }`;

  // ==========================================
  // AGENT 2: RELATIONSHIP DYNAMICS SPECIALIST
  // ==========================================
  const dynamicsPrompt = `You are an interpersonal relationship dynamics expert. 
  Analyze the provided chat transcript and evaluate the macro connection metrics between the speakers. Use comforting language.
  
  CRITICAL EVALUATION REGULATION:
  - Base your insights strictly on what occurs in the text. Do not assume or hallucinate severe distress or ghosting patterns unless explicitly stated by the participants.
  - Review any '[Replied after a delay of...]' markers. If the dialogue is consistently warm, loving, and reciprocal with no arguments, do not penalize 'conflict_resolution' or inflate 'toxicity' blindly for standard daily work/sleep delays.
  
  Return ONLY a valid JSON object matching this exact schema:
  {
    "bond_strength": "XX%",
    "bond_strength_reason": "A simple, encouraging one-sentence explanation of how well these two people are connecting and listening to each other right now.",
    "bond_positivity": "XX%",
    "bond_positivity_reason": "A simple one-sentence description of the warmth, kindness, and openness shown in this talk.",
    "conflict_resolution": "XX%",
    "conflict_resolution_reason": "A simple one-sentence note on how well they handle disagreements, response pacing, and if they try to find common ground.",
    "safety_trust": "XX%",
    "safety_trust_reason": "A simple one-sentence view on how safe and secure both people feel sharing their true thoughts without fear.",
    "relationship_dynamics": "XX%",
    "relationship_dynamics_reason": "A simple one-sentence breakdown of how they share the conversation and treat each other's points.",
    "toxicity": "XX%",
    "toxicity_reason": "A simple, non-judgmental one-sentence note on any genuine tension, defensive attitudes, or frustration in the text.",
    "summary": "A warm, helpful summary explaining what is going well in the relationship and what basic things they can work on together."
  }`;

  // ==========================================
  // AGENT 3: THE STRATEGIST (ACTIONABLES ENGINE)
  // ==========================================
  const makeStrategistPrompt = (personaData, dynamicsData) => {
    return `You are a relationship counselor and action-oriented strategist.
    Review these structural evaluation profiles compiled by your specialized analysis agents:
    
    Individual Profiles: ${JSON.stringify(personaData)}
    Macro Dynamics: ${JSON.stringify(dynamicsData)}
    
    Based ONLY on this information, generate practical, customized, easy-to-do tips for both individuals.
    Use comforting, plain language. Do not reference raw scores or numbers in the text.
    
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
    // RUN AGENT 1 & AGENT 2 AT THE EXACT SAME TIME
    const [personaResults, dynamicsResults] = await Promise.all([
      queryAgent(personaPrompt, enrichedChatLog),
      queryAgent(dynamicsPrompt, enrichedChatLog)
    ]);

    // RUN AGENT 3
    const strategistPrompt = makeStrategistPrompt(personaResults, dynamicsResults);
    const strategies = await queryAgent(strategistPrompt, enrichedChatLog);

    // PIPELINE AGGREGATION: Compiles perfectly into your layout structure
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

    // SAVE RESULTS TO SUPABASE
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
