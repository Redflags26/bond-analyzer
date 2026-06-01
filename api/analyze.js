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

  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  const parsedMessages = [];
  const speakers = new Set();
  const pauseStartHours = [];

  // Super-robust regex to extract Date, Time, Speaker, and Content across iOS/Android formats
  const linePattern = /^\[?(\d{1,4}[:\/\-.]\d{1,4}[:\/\-.]\d{2,4}),\s*([^\]\-]+)\]?\s*(?:-\s*)?([^:]+):\s*(.*)$/i;

  // PASS 1: Clean hidden WhatsApp characters, build Dates, and collect pause start-hours
  let preLastTimestamp = null;
  for (let line of lines) {
    // Strip invisible Left-to-Right Marks (\u200e) and narrow non-break spaces (\u202f) commonly injected by WhatsApp
    const cleanLine = line.replace(/\u200e/g, '').replace(/\u202f/g, ' ').trim();
    const match = linePattern.exec(cleanLine);
    
    if (match) {
      try {
        const datePart = match[1];
        const timePart = match[2].trim();
        const speaker = match[3].trim();
        const content = match[4].trim();

        // Safely split date components on any common separators
        const dateParts = datePart.split(/[\/\-.]/);
        if (dateParts.length >= 3) {
          let day = parseInt(dateParts[0], 10);
          let month = parseInt(dateParts[1], 10) - 1; 
          let year = parseInt(dateParts[2], 10);

          // Handle ISO formats (YYYY-MM-DD) safely
          if (day > 1000) {
            const tempYear = day;
            day = year;
            year = tempYear;
          }

          // Normalize 2-digit years
          if (year < 100) {
            year = 2000 + year;
          }

          // Robust 12h/24h Time Parser
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

  // Frequency-map of conversation pause hours to flag standard daily downtime cycles
  const routineHourCounts = Array(24).fill(0);
  for (const h of pauseStartHours) {
    routineHourCounts[h]++;
    routineHourCounts[(h - 1 + 24) % 24]++;
    routineHourCounts[(h + 1) % 24]++;
  }

  // PASS 2: Exclude sleep/routine pause windows from delay counts
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

    if (currentTimestamp && lastTimestamp) {
      const deltaHours = (currentTimestamp - lastTimestamp) / (1000 * 60 * 60);

      if (deltaHours >= 5 && deltaHours < 2000) {
        const lastDate = new Date(lastTimestamp);
        const lastHour = lastDate.getHours();
        const currentDate = new Date(currentTimestamp);
        const currentHour = currentDate.getHours();

        // 1. Explicit Night Sleep Window Check
        let isSleepGap = false;
        if (deltaHours <= 14) {
          const startsLate = (lastHour >= 21 || lastHour <= 4); 
          const endsNextMorning = (currentHour >= 5 && currentHour <= 11); 
          const differentDay = lastDate.getDate() !== currentDate.getDate();
          if (startsLate && endsNextMorning && differentDay) {
            isSleepGap = true;
          }
        }

        // 2. Routine downtime pause detection
        const isRoutineGap = (routineHourCounts[lastHour] >= 2) && (deltaHours <= 16);

        // Process as active lag ONLY if it's not a sleep break or routine pause
        if (!isSleepGap && !isRoutineGap) {
          totalDelays++;
          speakerDelayCount[speaker] = (speakerDelayCount[speaker] || 0) + 1;

          const roundedHours = Math.round(deltaHours);
          let delayTag = ` [Asynchronous pause of ${roundedHours} hours]`;

          const lowerContent = content.toLowerCase();
          const warmKeywords = ['sorry', 'guilty', 'babe', 'love', '💕', '❤️', 'haha', 'hey', 'sweet', 'dear', 'thanks', 'hug', 'miss', '🥰', '😘', '😊', 'lol'];
          const hasApology = warmKeywords.some(kw => lowerContent.includes(kw));
          const isChilling = lowerContent.includes('chilling') || lowerContent.includes('relaxing') || lowerContent.includes('scrolling');

          if (hasApology) delaysWithApologiesOrWarmth++;
          if (isChilling) {
            speakerChillingCount[speaker] = (speakerChillingCount[speaker] || 0) + 1;
          }

          const DateComponents = match[1].split(/[\/\-.]/);
          const enhancedLine = `[${DateComponents[0]}/${DateComponents[1]}/${DateComponents[2]}, ${match[2]}]${delayTag} ${speaker}: ${content}`;
          processedLines.push(enhancedLine);
          lastTimestamp = currentTimestamp;
          continue;
        }
      }
    }

    if (currentTimestamp) lastTimestamp = currentTimestamp;
    processedLines.push(msg.line);
  }

  // Extract resolved names
  const detectedSpeakers = Array.from(speakers);
  let person1 = detectedSpeakers[0] || 'Person 1';
  let person2 = detectedSpeakers[1] || 'Person 2';

  const delay1 = speakerDelayCount[person1] || 0;
  const delay2 = speakerDelayCount[person2] || 0;

  // Align so person2 is the partner with relatively more delays (if any)
  if (delay1 > delay2) {
    const temp = person1;
    person1 = person2;
    person2 = temp;
  }

  const activeChillingDelays = speakerChillingCount[person2] || 0;

  // Calculate chronological span of the conversation in days
  const validTimestamps = parsedMessages
    .filter(m => !m.isSystemOrMedia && m.timestamp)
    .map(m => m.timestamp);

  let chatSpanDays = 0;
  if (validTimestamps.length >= 2) {
    const minTimestamp = Math.min(...validTimestamps);
    const maxTimestamp = Math.max(...validTimestamps);
    chatSpanDays = (maxTimestamp - minTimestamp) / (1000 * 60 * 60 * 24);
  }

  // Treat chat logs spanning less than 1.5 days as highly synchronous, ignores false "asymmetry"
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

  // Calculate pacing metrics outside LLM context
  const { enrichedText, metrics, names } = calculateTimelineMetrics(chatLog);

  // Dynamic ranges based on calculated metrics to protect parameters from extreme drops
  const minAccountability = Math.max(75, Math.min(75 + Math.round(metrics.repairPercentage * 0.15), 90));
  const maxAccountability = Math.max(80, Math.min(80 + Math.round(metrics.repairPercentage * 0.15), 95));

  // Determine if we should suppress pacing commentary due to a very short time window
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
    - Toxicity Level: Must be exactly "${metrics.toxicity}%".
    - Conflict Resolution: Must be exactly "${metrics.conflictResolution}%".
    - Relationship Dynamics: Must be exactly "${metrics.teamwork}%".
    - Under bond_strength, bond_positivity, safety_trust_reason, relationship_dynamics_reason, and summary, DO NOT use terms like "asynchronous texting rhythm", "pacing gaps", "delays", or "waiting for replies". Focus instead on their mutual availability, warm real-time emotional connection, and high responsiveness.
    `;
  } else {
    pacingMandatePersona = `
    PRE-CALCULATED STRUCTURAL CONTEXT:
    - ${names.asyncPartner} has a text repair recovery factor of ${metrics.repairPercentage}%. This means when they delay, they make up for it with high verbal affection, love notes, or validation ${metrics.repairPercentage}% of the time.
    
    SCORING MANDATE:
    - ${names.consistentPartner}: Secure pacing, high availability. Keep their scores (Security, Regulation, Listening, and Owning Personal Errors) high at 85-95%. Since they communicate clearly and don't exhibit long delay patterns, score them high (85-95%) for Owning Personal Errors/Accountability as they actively facilitate repair and show high emotional consistency.
    - ${names.asyncPartner}: 
      * Accountability / Owning Personal Errors: Set this directly to a balanced range of ${minAccountability}-${maxAccountability}% because while they reply late, their repair attempt recovery factor is high at ${metrics.repairPercentage}%.
      * Emotional Regulation & Receptivity: Anchor these within 80-90%. They display deep affection and interest when active, but their asynchronous lifestyle slows down the conversational flow. Do not drop below 75% as their text is highly warm and non-defensive.
    `;

    pacingMandateDynamics = `
    DETERMINISTIC METRIC CONSTRAINTS:
    - Toxicity Level: Must be exactly "${metrics.toxicity}%". (Reason: There is zero active conflict or hostility, but a mild ${metrics.toxicity}% asymmetry exists because one partner responds slowly while chilling).
    - Conflict Resolution: Must be exactly "${metrics.conflictResolution}%". (Reason: While direct plans are occasionally deflected, conversational gaps are handled with high emotional reassurance and mutual validation).
    - Relationship Dynamics: Must be exactly "${metrics.teamwork}%". (Reason: Reflects an unequal real-time interactive flow where one partner routinely waits for answers).
    `;
  }

  // ==========================================
  // AGENT 1: PERSONA SPECIALIST (Hard Constraints Fed via Context)
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
  // AGENT 2: RELATIONSHIP DYNAMICS (Hard Constraints Fed via Context)
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
    "conflict_resolution": "${metrics.conflictResolution}%",
    "conflict_resolution_reason": "1 sentence describing how sweet check-ins and apologies balance out texting gaps.",
    "safety_trust": "XX%",
    "safety_trust_reason": "A warm sentence checking if mutual reassurance successfully keeps anxiety away.",
    "relationship_dynamics": "${metrics.teamwork}%",
    "relationship_dynamics_reason": "A clear, fair look at their turn-taking rhythm, acknowledging the pacing gap.",
    "toxicity": "${metrics.toxicity}%",
    "toxicity_reason": "A realistic view confirming that gaps represent a difference in texting habits, not active hostility.",
    "summary": "A friendly, comforting overview summary explaining what is going well (mutual affection, sweet validation) and what basic alignments they can work on together (improving real-time conversational flow)."
  }`;

  // ==========================================
  // AGENT 3: THE STRATEGIST (Actionable Tuning)
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
    
    if (!response.ok) throw new Error(`OpenRouter query failed with status ${response.status}`);
    const resData = await response.json();
    return JSON.parse(resData.choices[0].message.content);
  }

  try {
    const [personaResults, dynamicsResults] = await Promise.all([
      queryAgent(personaPrompt, enrichedText),
      queryAgent(dynamicsPrompt, enrichedText)
    ]);

    const strategistPrompt = makeStrategistPrompt(personaResults, dynamicsResults);
    const strategies = await queryAgent(strategistPrompt, enrichedText);

    // Dynamic aggregation pipeline
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
    return res.status(500).json({ error: 'Something went wrong while processing structural interaction profiles.' });
  }
}
