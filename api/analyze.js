/**
 * 1. HIGH-STABILITY TIMELINE CONTEXT LAYER
 * Manually parses DD/MM/YYYY elements to prevent native JS date engines 
 * from misreading Indian/European structures as months jumping backward.
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
        // Safe bypass trace
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
  // AGENT 1: PERSONA & SUBJECT SPECIALIST (Balanced Pacing Weight)
  // ==========================================
  const personaPrompt = `You are a psychological behavioral specialist focused exclusively on individual communication profiling. 
  Analyze the chat transcript and identify the two primary speakers. Evaluate their personal connection styles using comforting, clear language.
  
  CRITICAL PACING EVALUATION INSTRUCTIONS:
  - Check the context of '[Replied after a delay of...]' markers carefully.
  - Do not blindly penalize busy work hours or sleeping patterns. 
  - However, if a user is repeatedly delaying responses by 5+ hours while explicitly stating they are 'just relaxing', 'scrolling', or using the delay to deflect specific connection requests ('we'll see', 'maybe later', 'I'll try'), classify this as an asymmetric investment pattern or casual emotional withdrawal. 
  - Reflect this change adequately in their 'emotional_regulation' or 'receptivity' summaries without using clinical jargon.
  
  Return ONLY a valid JSON object matching this exact schema:
  {
    "profiles": [
      {
        "name": "Actual name of Person 1",
        "attachment_security": "XX%",
        "attachment_security_reason": "1 simple sentence explaining if they seem calm and secure, or if they show anxious/avoidant tendencies through pacing.",
        "emotional_regulation": "XX%",
        "emotional_regulation_reason": "1 simple sentence about how consistently they show up and maintain an even interactive flow.",
        "receptivity": "XX%",
        "receptivity_reason": "1 simple sentence evaluating how open they are to real-time sharing vs. keeping a distant conversational boundary.",
        "accountability": "XX%",
        "accountability_reason": "1 simple sentence showing if they acknowledge conversational imbalances or stay surface level."
      },
      {
        "name": "Actual name of Person 2",
        "attachment_security": "XX%",
        "attachment_security_reason": "1 simple sentence explaining if they seem calm and secure, or if they show anxious/avoidant tendencies through pacing.",
        "emotional_regulation": "XX%",
        "emotional_regulation_reason": "1 simple sentence about how consistently they show up and maintain an even interactive flow.",
        "receptivity": "XX%",
        "receptivity_reason": "1 simple sentence evaluating how open they are to real-time sharing vs. keeping a distant conversational boundary.",
        "accountability": "XX%",
        "accountability_reason": "1 simple sentence showing if they acknowledge conversational imbalances or stay surface level."
      }
    ]
  }`;

  // ==========================================
  // AGENT 2: RELATIONSHIP DYNAMICS SPECIALIST (Balanced Pacing Weight)
  // ==========================================
  const dynamicsPrompt = `You are an interpersonal relationship dynamics expert. 
  Analyze the transcript and evaluate macro relationship metrics using warm, comforting language.
  
  CRITICAL TEXT-BALANCE LOGIC:
  - Do not mistake surface-level sweetness (emojis like ❤️, terms like 'babe') for optimal connection if the actual actions show low conversational presence.
  - If a log contains zero arguments but shows one person regularly waiting for hours while the other drops non-committal replies or brushes off requests to meet/call, lower 'conflict_resolution' and 'relationship_dynamics' slightly to reflect an unequal conversational rhythm.
  - Keep 'toxicity' mild (e.g., 15-30%) if it is a low-effort or breadcrumbing texting trend rather than active, aggressive malice.
  
  Return ONLY a valid JSON object matching this exact schema:
  {
    "bond_strength": "XX%",
    "bond_strength_reason": "A simple sentence capturing mutual care while factoring in the impact of regular asynchronous response delays.",
    "bond_positivity": "XX%",
    "bond_positivity_reason": "A simple sentence breaking down sweet verbal language versus actual interactive presence.",
    "conflict_resolution": "XX%",
    "conflict_resolution_reason": "A simple note evaluating how effectively they handle emotional bids for attention or if requests get deflected over time gaps.",
    "safety_trust": "XX%",
    "safety_trust_reason": "A simple sentence showing if the emotional space feels completely secure or slightly imbalanced due to response habits.",
    "relationship_dynamics": "XX%",
    "relationship_dynamics_reason": "A simple breakdown of who drives the momentum and how response lags change the natural conversational balance.",
    "toxicity": "XX%",
    "toxicity_reason": "A non-judgmental sentence tracking if avoidance, non-committal answers, or subtle distance creates a mild underlying tension.",
    "summary": "A warm, helpful summary highlighting what is sweet about the relationship, while giving a clear, realistic critique of conversational pacing and presence imbalances."
  }`;

  // ==========================================
  // AGENT 3: THE STRATEGIST (Actionable Tuning)
  // ==========================================
  const makeStrategistPrompt = (personaData, dynamicsData) => {
    return `You are a relationship counselor and action-oriented strategist.
    Review these structural evaluation profiles compiled by your specialized analysis agents:
    
    Individual Profiles: ${JSON.stringify(personaData)}
    Macro Dynamics: ${JSON.stringify(dynamicsData)}
    
    Based ONLY on this information, generate practical, easy-to-do tips for both individuals.
    If the individual profiles show that one partner regularly deflects plans or uses delays casually, generate action steps that encourage moving from text updates to setting clear expectations for real-time contact. Use plain language. Do not show raw scores.
    
    Return ONLY a valid JSON object matching this exact schema:
    {
      "person1_actionables": [
        "A practical, easy-to-do tip for this person to make the next conversation smoother.",
        "A simple phrase or action they can try next time things feel tense or distant."
      ],
      "person2_actionables": [
        "A practical, easy-to-do tip for this person to make the next conversation smoother.",
        "A simple phrase or action they can try next time things feel tense or distant."
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
