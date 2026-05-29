/**
 * HELPER: Safely parses chat timestamp strings into raw minutes.
 * Completely wrapped in a try/catch block to guarantee it never crashes the pipeline.
 */
function parseTimeToMinutes(timeStr) {
    if (!timeStr) return null;
    try {
        const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
        if (!match) return null;
        
        let [_, hours, minutes, ampm] = match;
        hours = parseInt(hours, 10);
        minutes = parseInt(minutes, 10);
        
        if (ampm) {
            if (ampm.toUpperCase() === 'PM' && hours < 12) hours += 12;
            if (ampm.toUpperCase() === 'AM' && hours === 12) hours = 0;
        }
        return hours * 60 + minutes;
    } catch (e) {
        // Fail silently and return null if anything goes wrong during time processing
        return null;
    }
}

/**
 * 1. SAFE DATA PREPARATION UTILITY LAYER
 * - Aggressively scrubs messy date/time wrappers (e.g., "[10:10 pm, 5/11/2025]").
 * - Gracefully processes or completely skips confusing timeline markers to prevent backend crashes.
 * - Strictly enforces the 2-person limit to protect frontend layout grids.
 */
function prepareChatData(text) {
    if (!text || typeof text !== 'string') return { cleanTranscript: '', timeMetadata: [] };

    let lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    
    // Captures structural name patterns right after typical timestamp brackets or line starts
    const explicitNameRegex = /^\[?([A-Z][a-zA-Z0-9_\s]{0,25}?)\]?[:\-\u2014]/;
    
    // Aggressive catch for any variations of brackets containing times/dates: [10:10 pm, 5/11/2025] or [3:22 am]
    const bracketTimestampRegex = /^\[\d{1,2}:\d{2}\s*(?:AM|PM)?(?:[\s,/\d-]*?)[\]\s\-:]*/i;
    // Alternative inline timestamp check (e.g., "10:14 AM - ")
    const standaloneTimestampRegex = /\b(\d{1,2}:\d{2}\s*(?:AM|PM)?)\b/i;
    
    let nativeNamesDetected = [];
    let processedLines = [];

    for (let line of lines) {
        let messageTime = null;
        let workingLine = line;

        try {
            // Extract the timestamp string from brackets if it exists
            let bracketMatch = workingLine.match(bracketTimestampRegex);
            if (bracketMatch) {
                // Pull out the raw time fragment within the bracket for our delta calculations
                let innerTime = bracketMatch[0].match(standaloneTimestampRegex);
                if (innerTime) messageTime = innerTime[1];
                // Strip the entire bracket metadata block from the line
                workingLine = workingLine.replace(bracketTimestampRegex, '').trim();
            } else {
                let inlineMatch = workingLine.match(standaloneTimestampRegex);
                if (inlineMatch) {
                    messageTime = inlineMatch[1];
                    workingLine = workingLine.replace(standaloneTimestampRegex, '').trim();
                }
            }

            // Remove residual chat artifacts
            workingLine = workingLine
                .replace(/\[?(photo|image|video|attachment|sticker|location|missed call)\]?/gi, '')
                .trim();

            if (!workingLine) continue;

            let nameMatch = workingLine.match(explicitNameRegex);
            if (nameMatch) {
                let foundName = nameMatch[1].trim();
                let actualText = workingLine.replace(explicitNameRegex, '').trim();
                if (!actualText) continue;

                if (!nativeNamesDetected.includes(foundName) && nativeNamesDetected.length < 2) {
                    nativeNamesDetected.push(foundName);
                }
                processedLines.push({ rawName: foundName, text: actualText, time: messageTime });
            } else {
                processedLines.push({ rawName: null, text: workingLine, time: messageTime });
            }
        } catch (lineError) {
            // If an individual line acts weirdly, ignore the time extraction and salvage the pure raw text
            processedLines.push({ rawName: null, text: line, time: null });
        }
    }

    // Resolve structural naming identities cleanly
    let speakerMap = {};
    if (nativeNamesDetected.length === 2) {
        speakerMap[nativeNamesDetected[0]] = nativeNamesDetected[0];
        speakerMap[nativeNamesDetected[1]] = nativeNamesDetected[1];
    } else if (nativeNamesDetected.length === 1) {
        speakerMap[nativeNamesDetected[0]] = nativeNamesDetected[0];
        speakerMap["__fallback_other__"] = "Person 2";
    } else {
        nativeNamesDetected = ["Person 1", "Person 2"];
    }

    let finalTranscriptLines = [];
    let timeMetadataCollection = [];
    let fallbackToggle = 1;
    let lastMessageMinutes = null;

    for (let item of processedLines) {
        let assignedName = "";

        if (item.rawName) {
            assignedName = speakerMap[item.rawName] || (fallbackToggle === 1 ? nativeNamesDetected[0] : nativeNamesDetected[1]);
        } else {
            assignedName = fallbackToggle === 1 ? nativeNamesDetected[0] : (nativeNamesDetected[1] || "Person 2");
        }

        // --- SAFE CHRONOLOGICAL PAUSES ---
        let delayMinutes = 0;
        try {
            let currentMinutes = parseTimeToMinutes(item.time);
            if (currentMinutes !== null && lastMessageMinutes !== null) {
                delayMinutes = currentMinutes - lastMessageMinutes;
                if (delayMinutes < 0) delayMinutes += 1440; // Handle midnight wrap
            }
            if (currentMinutes !== null) lastMessageMinutes = currentMinutes;
        } catch (timeCalcError) {
            delayMinutes = 0; // Absolute safety fallback
        }

        timeMetadataCollection.push({
            speaker: assignedName,
            timestamp: item.time || "N/A",
            elapsedMinutesSinceLastReply: delayMinutes
        });

        // Inject conditional metric updates ONLY if we calculated a valid, meaningful gap
        if (delayMinutes >= 20 && delayMinutes < 180) {
            finalTranscriptLines.push(`[System Metric: ${delayMinutes} minutes passed before this reply]`);
        } else if (delayMinutes >= 180) {
            finalTranscriptLines.push(`[System Metric: Several hours passed before this reply]`);
        }

        finalTranscriptLines.push(`${assignedName}: ${item.text}`);
        fallbackToggle = (assignedName === nativeNamesDetected[0]) ? 2 : 1;
    }

    return {
        cleanTranscript: finalTranscriptLines.length > 0 ? finalTranscriptLines.join('\n') : text,
        timeMetadata: timeMetadataCollection
    };
}

/**
 * 2. MAIN UNIFIED API ROUTE CONTROLLER
 */
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { chatLog } = req.body;
    if (!chatLog) {
        return res.status(400).json({ error: 'Please provide a valid conversation log.' });
    }

    // --- STEP A: SCRUB LOGS AND RESOLVE TEMPORAL MATRICES SAFELY ---
    const { cleanTranscript, timeMetadata } = prepareChatData(chatLog);

    // --- STEP B: ENGINEERED SYSTEM PROMPT MATRIX ---
    const systemPrompt = `You are an expert conversation analyst. Analyze the provided chat transcript.
You may encounter embedded timestamp tracking indicators such as "[System Metric: X minutes passed before this reply]". 

CRITICAL COGNITIVE REQUIREMENTS:
1. Core Metrics & Timing: Treat structural communication delays as an auxiliary behavioral parameter. Consider how response latency impacts safety, emotional control, or defensiveness when visible. 
2. Relevant Highlighting Rule: Only highlight timing parameters in your text analysis summaries if they are uniquely significant to the conversation's trajectory. If metrics are missing or unclear, prioritize your analytical evaluation purely on the textual context and tone.
3. Structural Enforcement: The input text contains exactly two main actors. Your "profiles" array output MUST contain exactly 2 objects—one mapped to each participant. Never return an alternative length array.

You must output a single, well-formed JSON object matching the schema below:
{
  "analytics": {
    "bond_strength": "Percentage string",
    "bond_strength_reason": "Overall summary sentence reflecting alignment and communication response rhythms.",
    "bond_positivity": "Percentage string",
    "bond_positivity_reason": "Short contextual critique",
    "conflict_resolution": "Percentage string",
    "conflict_resolution_reason": "Short contextual critique evaluating cooling periods or text behavior.",
    "safety_trust": "Percentage string",
    "safety_trust_reason": "Short contextual critique",
    "relationship_dynamics": "Percentage string",
    "relationship_dynamics_reason": "Short contextual critique",
    "toxicity": "Percentage string",
    "toxicity_reason": "Short contextual critique highlighting escalations, text bursts, or avoidant withdrawals when relevant.",
    "summary": "Final warm takeaway advice line",
    "profiles": [
      {
        "name": "Exact Name of Person 1",
        "attachment_security": "Percentage string",
        "attachment_security_reason": "Short analytical insight",
        "emotional_regulation": "Percentage string",
        "emotional_regulation_reason": "Short analytical insight explaining how they managed emotional gaps, sudden pauses, or reaction rhythms.",
        "receptivity": "Percentage string",
        "receptivity_reason": "Short analytical insight mentioning if they were present to listen or withdrew emotionally.",
        "accountability": "Percentage string",
        "accountability_reason": "Short analytical insight",
        "actionables": ["Action step 1", "Action step 2"]
      },
      {
        "name": "Exact Name of Person 2",
        "attachment_security": "Percentage string",
        "attachment_security_reason": "Short analytical insight",
        "emotional_regulation": "Percentage string",
        "emotional_regulation_reason": "Short analytical insight explaining how they managed emotional gaps, sudden pauses, or reaction rhythms.",
        "receptivity": "Percentage string",
        "receptivity_reason": "Short analytical insight mentioning if they were present to listen or withdrew emotionally.",
        "accountability": "Percentage string",
        "accountability_reason": "Short analytical insight",
        "actionables": ["Action step 1", "Action step 2"]
      }
    ]
  }
}`;

    // --- STEP C: DISPATCH SINGLE UNIFIED API PIPELINE CALL ---
    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "google/gemini-2.5-flash", 
                response_format: { type: "json_object" }, 
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: cleanTranscript }
                ]
            })
        });

        const rawData = await response.json();
        
        if (!rawData.choices || rawData.choices.length === 0) {
            throw new Error("Invalid completion return block from OpenRouter endpoint source.");
        }

        const analyticalPayload = JSON.parse(rawData.choices[0].message.content);
        return res.status(200).json(analyticalPayload);

    } catch (error) {
        console.error("Pipeline Runtime Exception:", error);
        return res.status(500).json({ error: "Failed to evaluate the chat timeline correctly." });
    }
}
