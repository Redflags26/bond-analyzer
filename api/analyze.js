/**
 * EXTERNAL DETERMINISTIC METRIC ENGINE
 * Computes precise mathematical pacing weights outside the LLM layer.
 * 1. enrichedText - Chat log with explicit hour-delay markers (excluding sleep/routine).
 * 2. metrics - Raw numerical constraints to lock down the LLM parameters.
 * 3. names - Dynamically resolved names from the parsed chat log.
 */
function calculateTimelineMetrics(text) {
  if (!text || typeof text !== 'string') {
    return { 
      enrichedText: '', 
      metrics: { toxicity: 2, conflictResolution: 70, teamwork: 95, repairPercentage: 100, isShortChat: true, totalDelays: 0 },
      names: { consistentPartner: 'Person 1', asyncPartner: 'Person 2' }
    };
  }

  // Regex to strip emojis and miscellaneous symbols from speaker names
  function stripEmojis(str) {
    if (!str) return '';
    return str
      .replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g, '')
      .replace(/[\u2600-\u26FF]/g, '') 
      .replace(/[\u2700-\u27BF]/g, '') 
      .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '') 
      .replace(/\s+/g, ' ') 
      .trim();
  }

  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  const parsedMessages = [];
  const speakers = new Set();
  const pauseStartHours = [];

  const linePattern = /^\[?(\d{1,4}[:\/\-.]\d{1,4}(?:[:\/\-.]\d{2,4})?),\s*([^\]\-]+)\]?\s*(?:-\s*)?([^:]+):\s*(.*)$/i;

  // PASS 1: Clean hidden WhatsApp characters, build Dates, and collect pause start-hours
  let preLastTimestamp = null;
  for (let line of lines) {
    const cleanLine = line.replace(/\u200e/g, '').replace(/\u202f/g, ' ').trim();
    const match = linePattern.exec(cleanLine);
    
    if (match) {
      try {
        const datePart = match[1];
        const timePart = match[2].trim();
        const rawSpeaker = match[3].trim();
        const content = match[4].trim();

        const speaker = stripEmojis(rawSpeaker) || 'Unknown';

        // Safely split date components
        const dateParts = datePart.split(/[:\/\-.]/);
        if (dateParts.length >= 2) {
          let day = parseInt(dateParts[0], 10);
          let month = parseInt(dateParts[1], 10) - 1; 
          let year = dateParts[2] ? parseInt(dateParts[2], 10) : new Date().getFullYear();

          if (dateParts[2] && day > 1000) {
            const tempYear = day;
            day = year;
            year = tempYear;
          }

          if (year < 100) {
            year = 2000 + year;
          }

          const timeRegex = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?/i;
          const timeMatch = timeRegex.exec(timePart);
          let hours = 0;
          let minutes = 0;
          let seconds = 0;

          if (timeMatch) {
            hours = parseInt(timeMatch[1], 10);
            minutes = parseInt(timeMatch[2], 10);
            if (timeMatch[3]) seconds = parseInt(timeMatch[3], 10);
            const ampm = timeMatch[4];
            if (ampm) {
              if (ampm.toLowerCase() === 'pm' && hours < 12) hours += 12;
              if (ampm.toLowerCase() === 'am' && hours === 12) hours = 0;
            }
          }

          const currentTimestamp = new Date(year, month, day, hours, minutes, seconds).getTime();

          if (currentTimestamp) {
            speakers.add(speaker);
            
            if (preLastTimestamp) {
              const deltaHours = (currentTimestamp - preLastTimestamp) / (1000 * 60 * 60);
              if (deltaHours >= 5 && deltaHours < 2000) {
                const startHour = new Date(preLastTimestamp).getHours();
                pauseStartHours.push(startHour);
              }
            }
            
            parsedMessages.push({ 
              isSystemOrMedia: false, 
              timestamp: currentTimestamp, 
              speaker, 
              content, 
              match, 
              line: cleanLine 
            });
            preLastTimestamp = currentTimestamp;
          } else {
            parsedMessages.push({ isSystemOrMedia: true, line: cleanLine });
          }
        }
      } catch (e) {
        parsedMessages.push({ isSystemOrMedia: true, line: cleanLine });
      }
    } else {
      parsedMessages.push({ isSystemOrMedia: true, line: cleanLine });
    }
  }

  const routineHourCounts = Array(24).fill(0);
  for (const h of pauseStartHours) {
    routineHourCounts[h]++;
    routineHourCounts[(h - 1 + 24) % 24]++;
    routineHourCounts[(h + 1) % 24]++;
  }

  // PASS 2: Exclude sleep/routine pause windows
  const processedLines = [];
  let lastTimestamp = null;
  let totalDelays = 0;
  let delaysWithApologiesOrWarmth = 0;
  const speakerDelayCount = {};
  const speakerChillingCount = {};

  for (let msg of parsedMessages) {
    if (msg.isSystemOrMedia) {
      processedLines.push(msg.line);
      continue;
    }

    const currentTimestamp = msg.timestamp;
    const speaker = msg.speaker;
    const content = msg.content;
    const match = msg.match;

    let delayTag = "";
    if (currentTimestamp && lastTimestamp) {
      const deltaHours = (currentTimestamp - lastTimestamp) / (1000 * 60 * 60);

      if (deltaHours >= 5 && deltaHours < 2000) {
        const lastDate = new Date(lastTimestamp);
        const lastHour = lastDate.getHours();
        const currentDate = new Date(currentTimestamp);
        const currentHour = currentDate.getHours();

        let isSleepGap = false;
        if (deltaHours <= 14) {
          const startsLate = (lastHour >= 21 || lastHour <= 4); 
          const endsNextMorning = (currentHour >= 5 && currentHour <= 11); 
          const differentDay = lastDate.getDate() !== currentDate.getDate();
          if (startsLate && endsNextMorning && differentDay) {
            isSleepGap = true;
          }
        }

        const isRoutineGap = (routineHourCounts[lastHour] >= 2) && (deltaHours <= 16);

        if (!isSleepGap && !isRoutineGap) {
          totalDelays++;
          speakerDelayCount[speaker] = (speakerDelayCount[speaker] || 0) + 1;

          const roundedHours = Math.round(deltaHours);
          delayTag = ` [Asynchronous pause of ${roundedHours} hours]`;

          const lowerContent = content.toLowerCase();
          const warmKeywords = ['sorry', 'guilty', 'babe', 'love', '💕', '❤️', 'haha', 'hey', 'sweet', 'dear', 'thanks', 'hug', 'miss', '🥰', '😘', '😊', 'lol'];
          const hasApology = warmKeywords.some(kw => lowerContent.includes(kw));
          const isChilling = lowerContent.includes('chilling') || lowerContent.includes('relaxing') || lowerContent.includes('scrolling');

          if (hasApology) delaysWithApologiesOrWarmth++;
          if (isChilling) {
            speakerChillingCount[speaker] = (speakerChillingCount[speaker] || 0) + 1;
          }
        }
      }
    }

    const DateComponents = match[1].split(/[:\/\-.]/);
    const dateStr = DateComponents[2] ? `${DateComponents[0]}/${DateComponents[1]}/${DateComponents[2]}` : `${DateComponents[0]}/${DateComponents[1]}`;
    const enhancedLine = `[${dateStr}, ${match[2].trim()}]${delayTag} ${speaker}: ${content}`;
    processedLines.push(enhancedLine);

    if (currentTimestamp) lastTimestamp = currentTimestamp;
  }

  const detectedSpeakers = Array.from(speakers);
  let person1 = detectedSpeakers[0] || 'Person 1';
  let person2 = detectedSpeakers[1] || 'Person 2';

  const delay1 = speakerDelayCount[person1] || 0;
  const delay2 = speakerDelayCount[person2] || 0;

  if (delay1 > delay2) {
    const temp = person1;
    person1 = person2;
    person2 = temp;
  }

  const activeChillingDelays = speakerChillingCount[person2] || 0;

  const validTimestamps = parsedMessages
    .filter(m => !m.isSystemOrMedia && m.timestamp)
    .map(m => m.timestamp);

  let chatSpanDays = 0;
  if (validTimestamps.length >= 2) {
    const minTimestamp = Math.min(...validTimestamps);
    const maxTimestamp = Math.max(...validTimestamps);
    chatSpanDays = (maxTimestamp - minTimestamp) / (1000 * 60 * 60 * 24);
  }

  const isShortChat = chatSpanDays <= 1.5;

  const structuralAsymmetry = totalDelays > 0 ? Math.min(totalDelays * 1.5, 12) : 0; 
  const repairFactor = totalDelays > 0 ? Math.round((delaysWithApologiesOrWarmth / totalDelays) * 100) : 100;
  
  const calculatedToxicity = Math.max(2, Math.min(3 + (activeChillingDelays * 1.5), 10)); 
  const calculatedConflictResolution = Math.max(70, Math.min(70 + (repairFactor * 0.25), 95));
  const calculatedTeamwork = Math.max(75, 95 - structuralAsymmetry);

  return {
    enrichedText: processedLines.join('\n'),
    metrics: {
      toxicity: calculatedToxicity,
      conflictResolution: calculatedConflictResolution,
      teamwork: calculatedTeamwork,
      repairPercentage: repairFactor,
      isShortChat: isShortChat,
      totalDelays: totalDelays
    },
    names: {
      consistentPartner: person1,
      asyncPartner: person2
    }
  };
}

// Clean potential code-block wrappings returned by OpenRouter endpoints
function safeJsonParse(str) {
  if (!str) return null;
  let cleanStr = str.trim();
  if (cleanStr.startsWith("```json")) {
    cleanStr = cleanStr.substring(7);
  } else if (cleanStr.startsWith("```")) {
    cleanStr = cleanStr.substring(3);
  }
  if (cleanStr.endsWith("```")) {
    cleanStr = cleanStr.substring(0, cleanStr.length - 3);
  }
  return JSON.parse(cleanStr.trim());
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { chatLog, userId } = req.body;
  const apiKey = process.env.OPENROUTER_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!apiKey || !supabaseUrl || !supabaseServiceKey) {
    return res.status(500).json({ error: 'Configuration Error: Operational keys are missing from your system panel.' });
  }

  try {
    // Moved evaluation function inside try-catch to avoid uncaught engine crashes
    const { enrichedText, metrics, names } = calculateTimelineMetrics(chatLog);

    const repairPercentage = metrics.repairPercentage !== undefined ? metrics.repairPercentage : 100;
    const minAccountability = Math.max(75, Math.min(75 + Math.round(repairPercentage * 0.15), 90));
    const maxAccountability = Math.max(80, Math.min(80 + Math.round(repairPercentage * 0.15), 95));

    const isShort = metrics.isShortChat || metrics.totalDelays === 0;

    let pacingMandatePersona = "";
    let pacingMandateDynamics = "";

    if (isShort) {
      pacingMandatePersona = `
      CRITICAL OVERRIDE FOR SHORT TIMELINES:
      - This is a brief, highly focused conversation spanning less than 1.5 days. There are no real asynchronous texting gaps.
      - Treat any pauses as entirely normal transitions (such as sleep, work, or travel) and DO NOT mention "pacing lags", "asynchrony", "waiting for responses", or "delayed replies".
      - Base both partners' scores (Security, Regulation, Receptivity, and Owning Errors/Accountability) on high positive baselines (88-95%) due to their continuous, warm, real-time availability and alignment.
      `;

      pacingMandateDynamics = `
      CRITICAL OVERRIDE FOR SHORT TIMELINES:
      - This conversation spans less than 1.5 days. No meaningful asynchronous rhythm exists. Any pauses represent sleep or travel and must be ignored.
      - Toxicity Level: Must be exactly "${metrics.toxicity || 3}%".
      - Conflict Resolution: Must be exactly "${metrics.conflictResolution || 95}%".
      - Relationship Dynamics: Must be exactly "${metrics.teamwork || 95}%".
      - Under bond_strength, bond_positivity, safety_trust_reason, relationship_dynamics_reason, and summary, DO NOT use terms like "asynchronous texting rhythm", "pacing gaps", "delays", or "waiting for replies". Focus instead on their mutual availability, warm real-time emotional connection, and high responsiveness.
      `;
    } else {
      pacingMandatePersona = `
      PRE-CALCULATED STRUCTURAL CONTEXT:
      - ${names.asyncPartner} has a text repair recovery factor of ${repairPercentage}%. This means when they delay, they make up for it with high verbal affection, love notes, or validation ${repairPercentage}% of the time.
      
      SCORING MANDATE:
      - ${names.consistentPartner}: Secure pacing, high availability. Keep their scores (Security, Regulation, Listening, and Owning Personal Errors) high at 85-95%. Since they communicate clearly and don't exhibit long delay patterns, score them high (85-95%) for Owning Personal Errors/Accountability as they actively facilitate repair and show high emotional consistency.
      - ${names.asyncPartner}: 
        * Accountability / Owning Personal Errors: Set this directly to a balanced range of ${minAccountability}-${maxAccountability}% because while they reply late, their repair attempt recovery factor is high at ${repairPercentage}%.
        * Emotional Regulation & Receptivity: Anchor these within 80-90%. They display deep affection and interest when active, but their asynchronous lifestyle slows down the conversational flow. Do not drop below 75% as their text is highly warm and non-defensive.
      `;

      pacingMandateDynamics = `
      DETERMINISTIC METRIC CONSTRAINTS:
      - Toxicity Level: Must be exactly "${metrics.toxicity || 3}%". (Reason: There is zero active conflict or hostility, but a mild ${metrics.toxicity || 3}% asymmetry exists because one partner responds slowly while chilling).
      - Conflict Resolution: Must be exactly "${metrics.conflictResolution || 95}%". (Reason: While direct plans are occasionally deflected, conversational gaps are handled with high emotional reassurance and mutual validation).
      - Relationship Dynamics: Must be exactly "${metrics.teamwork || 95}%". (Reason: Reflects an unequal real-time interactive flow where one partner routinely waits for answers).
      `;
    }

    // ==========================================
    // AGENT 1: PERSONA SPECIALIST
    // ==========================================
    const personaPrompt = `You are a behavioral psychologist profiling conversational patterns.
    Analyze the text, noting the pre-calculated pacing constraints provided below.
    
    ${pacingMandatePersona}

    Return ONLY a valid JSON object matching this exact schema:
    {
      "profiles": [
        {
          "name": "${names.consistentPartner}",
          "attachment_security": "XX%",
          "attachment_security_reason": "1 short phrase balancing text lags vs loving reassurance.",
          "emotional_regulation": "XX%",
          "emotional_regulation_reason": "1 clear sentence about their consistency and interactive speed.",
          "receptivity": "XX%",
          "receptivity_reason": "1 short sentence showing how warmly they receive their partner's check-ins.",
          "owning_personal_errors": "XX%",
          "owning_personal_errors_reason": "1 short sentence about how they handle mistakes, delays, or apologizing during the talk.",
          "accountability": "XX%",
          "accountability_reason": "1 short sentence about how they handle mistakes, delays, or apologizing during the talk."
        },
        {
          "name": "${names.asyncPartner}",
          "attachment_security": "XX%",
          "attachment_security_reason": "1 short phrase balancing text lags vs loving reassurance.",
          "emotional_regulation": "XX%",
          "emotional_regulation_reason": "1 clear sentence about their consistency and interactive speed.",
          "receptivity": "XX%",
          "receptivity_reason": "1 short sentence showing how warmly they receive their partner's check-ins.",
          "owning_personal_errors": "XX%",
          "owning_personal_errors_reason": "1 short sentence about how they handle mistakes, delays, or apologizing during the talk.",
          "accountability": "XX%",
          "accountability_reason": "1 short sentence about how they handle mistakes, delays, or apologizing during the talk."
        }
      ]
    }`;

    // ==========================================
    // AGENT 2: RELATIONSHIP DYNAMICS
    // ==========================================
    const dynamicsPrompt = `You are a relationship counselor evaluating a couple's interaction data.
    You must apply the exact mathematical scores computed by our timeline parsing engine below. Do not deviate from these numbers.

    ${pacingMandateDynamics}

    Return ONLY a valid JSON object matching this exact schema:
    {
      "bond_strength": "XX%",
      "bond_strength_reason": "A supportive sentence combining their deep affection with their asynchronous pacing reality.",
      "bond_positivity": "XX%",
      "bond_positivity_reason": "A warm phrase explaining how loving words and emojis protect the connection atmosphere.",
      "conflict_resolution": "${metrics.conflictResolution || 95}%",
      "conflict_resolution_reason": "1 sentence describing how sweet check-ins and apologies balance out texting gaps.",
      "safety_trust": "XX%",
      "safety_trust_reason": "A warm sentence checking if mutual reassurance successfully keeps anxiety away.",
      "relationship_dynamics": "${metrics.teamwork || 95}%",
      "relationship_dynamics_reason": "A clear, fair look at their turn-taking rhythm, acknowledging the pacing gap.",
      "toxicity": "${metrics.toxicity || 3}%",
      "toxicity_reason": "A realistic view confirming that gaps represent a difference in texting habits, not active hostility.",
      "summary": "A friendly, comforting overview summary explaining what is going well (mutual affection, sweet validation) and what basic alignments they can work on together (improving real-time conversational flow)."
    }`;

    // ==========================================
    // AGENT 3: THE STRATEGIST
    // ==========================================
    const makeStrategistPrompt = (personaData, dynamicsData) => {
      return `You are a behavioral strategist. Review these profile files generated by the analysis agents:
      Individual Profiles: ${JSON.stringify(personaData)}
      Macro Dynamics: ${JSON.stringify(dynamicsData)}
      
      Write exactly 2 actionable next steps for each person using clear, comforting, everyday language. Do not show numbers.
      
      Return ONLY a valid JSON object matching this exact schema:
      {
        "person1_actionables": ["Tip 1", "Tip 2"],
        "person2_actionables": ["Tip 1", "Tip 2"]
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
          temperature: 0.1 
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter query failed with status ${response.status}: ${errorText}`);
      }
      const resData = await response.json();
      
      if (!resData.choices || !resData.choices[0] || !resData.choices[0].message) {
        throw new Error("OpenRouter returned an empty or malformed completion payload.");
      }
      
      const content = resData.choices[0].message.content;
      try {
        return safeJsonParse(content);
      } catch (e) {
        console.error("Agent JSON parsing failed. Content payload was:", content);
        throw new Error(`Failed to parse compliant JSON structure from agent response: ${e.message}`);
      }
    }

    const [personaResults, dynamicsResults] = await Promise.all([
      queryAgent(personaPrompt, enrichedText),
      queryAgent(dynamicsPrompt, enrichedText)
    ]);

    const strategistPrompt = makeStrategistPrompt(personaResults, dynamicsResults);
    const strategies = await queryAgent(strategistPrompt, enrichedText);

    // Defensive fallbacks to avoid unhandled TypeError if LLM structures return partial schemas
    const profile1 = (personaResults && personaResults.profiles && personaResults.profiles[0]) || {
      name: names.consistentPartner,
      attachment_security: "88%",
      attachment_security_reason: "High pacing availability and consistent sweet responses.",
      emotional_regulation: "90%",
      emotional_regulation_reason: "Communicates clearly without defensive reactions.",
      receptivity: "92%",
      receptivity_reason: "Receives messages warmly and validates partner often.",
      owning_personal_errors: "90%",
      owning_personal_errors_reason: "Actively facilitates emotional reassurance.",
      accountability: "90%",
      accountability_reason: "Maintains high, reliable accountability."
    };

    const profile2 = (personaResults && personaResults.profiles && personaResults.profiles[1]) || {
      name: names.asyncPartner,
      attachment_security: "85%",
      attachment_security_reason: "Reassures partner warmly during occasional pauses.",
      emotional_regulation: "85%",
      emotional_regulation_reason: "Maintains affection and warm interaction rhythm.",
      receptivity: "88%",
      receptivity_reason: "Responds with love notes and validation when available.",
      owning_personal_errors: "85%",
      owning_personal_errors_reason: "Welcomes opportunities to check-in.",
      accountability: "85%",
      accountability_reason: "Displays sweet repair validation during pauses."
    };

    const person1_actionables = (strategies && strategies.person1_actionables) || [
      "Keep sharing sweet validations directly to maintain real-time alignment.",
      "Check in naturally without overanalyzing routine daily rest periods."
    ];

    const person2_actionables = (strategies && strategies.person2_actionables) || [
      "Send a quick warm update when transitioning into busy work or sleep blocks.",
      "Continue using high affection and sweet emojis to keep connection safe."
    ];

    const finalAnalyticsResult = {
      bond_strength: dynamicsResults.bond_strength || "90%",
      bond_strength_reason: dynamicsResults.bond_strength_reason || "Displays strong emotional alignment and mutual reassurance.",
      bond_positivity: dynamicsResults.bond_positivity || "92%",
      bond_positivity_reason: dynamicsResults.bond_positivity_reason || "Warm words and sweet emojis protect the overall atmosphere.",
      conflict_resolution: dynamicsResults.conflict_resolution || `${metrics.conflictResolution || 95}%`,
      conflict_resolution_reason: dynamicsResults.conflict_resolution_reason || "Sweet check-ins and warm apologies balance out routine texting gaps.",
      safety_trust: dynamicsResults.safety_trust || "90%",
      safety_trust_reason: dynamicsResults.safety_trust_reason || "Mutual reassurance successfully keeps connection anxiety away.",
      relationship_dynamics: dynamicsResults.relationship_dynamics || `${metrics.teamwork || 95}%`,
      relationship_dynamics_reason: dynamicsResults.relationship_dynamics_reason || "Comfortable, warm turn-taking with clean synchronization.",
      toxicity: dynamicsResults.toxicity || `${metrics.toxicity || 3}%`,
      toxicity_reason: dynamicsResults.toxicity_reason || "Gaps represent standard sleep or busy schedules, not active hostility.",
      summary: dynamicsResults.summary || "A highly aligned, loving interaction with strong real-time responsiveness and deep mutual affection.",
      profiles: [
        {
          ...profile1,
          actionables: person1_actionables
        },
        {
          ...profile2,
          actionables: person2_actionables
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
          full_analytics: finalAnalyticsResult,
          ...(userId ? { user_id: userId } : {})
        })
      });
    } catch (dbError) {
      console.error("Database sync trace bypass:", dbError.message);
    }

    return res.status(200).json({
      modelUsed: "deterministic-hybrid-pipeline",
      analytics: finalAnalyticsResult
    });

  } catch (error) {
    console.error("Pipeline run error:", error.message);
    return res.status(500).json({ error: `Internal execution issue during parsing: ${error.message}` });
  }
}
