/**
 * HELPER: Parses standard chat timestamp strings into raw minutes for delta calculations.
 * Supports standard mobile extraction patterns like "10:15 AM", "22:30", "14:05 -", etc.
 */
function parseTimeToMinutes(timeStr) {
    if (!timeStr) return null;
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
}

/**
 * 1. DATA PREPARATION UTILITY LAYER
 * - Scrubs system UI noise (e.g., [Photo], [Attachment], missed calls).
 * - Extracts temporal timestamps and determines conversational delay markers.
 * - Enforces a hard, structural 2-person limit to safeguard the frontend dashboard layout grids.
 */
function prepareChatData(text) {
    if (!text || typeof text !== 'string') return { cleanTranscript: '', timeMetadata: [] };

    let lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    const explicitNameRegex = /^\[?([A-Z][a-zA-Z0-9_\s]{0,15}?)\]?[:\-\u2014]/;
    const timestampRegex = /\b(\d{1,2}:\d{2}\s*(?:AM|PM)?)\b/i;
    
    let nativeNamesDetected = [];
    let processedLines = [];

    for (let line of lines) {
        // Extract raw timestamp values if present before cleaning text
        let timeMatch = line.match(timestampRegex);
        let messageTime = timeMatch ? timeMatch[1] : null;

        // Clear out messaging artifacts, media indicators, and timestamps from the dialogue sequence
        let cleanLine = line
            .replace(/\[?(photo|image|video|attachment|sticker|location|missed call)\]?/gi, '')
            .replace(timestampRegex, '') 
            .trim();

        if (!cleanLine) continue;
        let nameMatch = cleanLine.match(explicitNameRegex);
        
        if (nameMatch) {
            let foundName = nameMatch[1].trim();
            let actualText = cleanLine.replace(explicitNameRegex, '').trim();
            if (!actualText) continue;

            if (!nativeNamesDetected.includes(foundName) && nativeNamesDetected.length < 2) {
                nativeNamesDetected.push(foundName);
            }
            processedLines.push({ rawName: foundName, text: actualText, time: messageTime });
        } else {
            processedLines.push({ rawName: null, text: cleanLine, time: messageTime });
        }
    }

    // Resolve structural target identities
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

    for (let i = 0; i < processedLines.length; i++) {
        let item = processedLines[i];
        let assignedName = "";

        if (item.rawName) {
            assignedName = speakerMap[item.rawName] || (fallbackToggle === 1 ? nativeNamesDetected[0] : nativeNamesDetected[1]);
        } else {
            assignedName = fallbackToggle === 1 ? nativeNamesDetected[0] : (nativeNamesDetected[1] || "Person 2");
        }

        // --- CALCULATE CHRONOLOGICAL PAUSES ---
        let delayMinutes = 0;
        let currentMinutes = parseTimeToMinutes(item.time);
        
        if (currentMinutes !== null && lastMessageMinutes !== null) {
            delayMinutes = currentMinutes - lastMessageMinutes;
            if (delayMinutes < 0) delayMinutes += 1440; // Handle midnight wraps cleanly
        }
        if (currentMinutes !== null) lastMessageMinutes = currentMinutes;

        // Populate storage array snapshots for custom DB metric parameter logging if needed
        timeMetadataCollection.push({
            speaker: assignedName,
            timestamp: item.time,
            elapsedMinutesSinceLastReply: delayMinutes
        });

        // Conditionally inject system tracking notes so the LLM processes significant conversational rhythms
        if (delayMinutes >= 20 && delayMinutes < 180) {
            finalTranscriptLines.push(`[System Metric: ${delayMinutes} minutes passed before this reply]`);
        } else if (delayMinutes >= 180) {
            finalTranscriptLines.push(`[System Metric: Several hours passed before this reply]`);
        }

        finalTranscriptLines.push(`${assignedName}: ${item.text}`);
        fallbackToggle = (assignedName === nativeNamesDetected[0]) ? 2 : 1;
    }

    return {
        cleanTranscript: finalTranscriptLines.join('\n'),
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

    // --- STEP A: RUN ISOLATED TEXT AND TEMPORAL BALANCING LAYER ---
    const { cleanTranscript, timeMetadata } = prepareChatData(chatLog);

    // --- STEP B: ENGINEERED SYSTEM PROMPT MATRIX ---
    const systemPrompt = `You are an expert conversation analyst. Analyze the provided chat transcript.
You may encounter embedded timestamp tracking indicators such as "[System Metric: X minutes passed before this reply]". 

CRITICAL COGNITIVE REQUIREMENTS:
1. Core Metrics & Timing: Treat structural communication delays as a key behavioral parameter. Consider how response latency impacts safety, emotional control, or defensiveness. Rapid-fire messaging sequences can indicate escalation or agitation, while lengthy silent gaps can reflect strategic cooling-off periods OR avoidant stonewalling. 
2. Relevant Highlighting Rule: Only highlight timing parameters in your text analysis summaries if they are uniquely significant to the conversation's trajectory. Do not force repetitive descriptions if the delays are normal or irrelevant. If rapid bursts or long silent windows actively shape the tension, weave observations like "rapid text bursts," "sudden cooling breaks," or "hours of silence" directly into the appropriate text feedback properties.
3. Structural Enforcement: The input text contains exactly two main actors. Your "profiles" array output MUST contain exactly 2 objects—one mapped to each participant. Never return an alternative length array.

You must output a single, well-formed JSON object matching the schema below:
{
  "analytics": {
    "bond_strength": "Percentage string",
    "bond_strength_reason": "Overall summary sentence reflecting alignment and communication response speed rhythms.",
    "bond_positivity": "Percentage string",
    "bond_positivity_reason": "Short contextual critique",
    "conflict_resolution": "Percentage string",
    "conflict_resolution_reason": "Short contextual critique evaluating cooling periods or sudden text drops.",
    "safety_trust": "Percentage string",
    "safety_trust_reason": "Short contextual critique",
    "relationship_dynamics": "Percentage string",
    "relationship_dynamics_reason": "Short contextual critique",
    "toxicity": "Percentage string",
    "toxicity_reason": "Short contextual critique highlighting text bursts, high-frequency escalation or avoidant withdrawals when relevant.",
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
