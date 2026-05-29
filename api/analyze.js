/**
 * HELPER: Safely parses both 12-hour (AM/PM) and 24-hour (military) timestamp formats.
 * Wrapped entirely in a try/catch to ensure it never halts execution.
 */
function parseTimeToMinutes(timeStr) {
    if (!timeStr) return null;
    try {
        // Test for 12-hour AM/PM formatting
        let match12 = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
        if (match12) {
            let [_, hours, minutes, ampm] = match12;
            hours = parseInt(hours, 10);
            minutes = parseInt(minutes, 10);
            if (ampm.toUpperCase() === 'PM' && hours < 12) hours += 12;
            if (ampm.toUpperCase() === 'AM' && hours === 12) hours = 0;
            return hours * 60 + minutes;
        }

        // Test for standard 24-hour / military formatting (e.g., "17:21")
        let match24 = timeStr.match(/(\d{1,2}):(\d{2})/);
        if (match24) {
            let hours = parseInt(match24[1], 10);
            let minutes = parseInt(match24[2], 10);
            if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
                return hours * 60 + minutes;
            }
        }
        return null;
    } catch (e) {
        return null;
    }
}

/**
 * 1. ZERO-FAILURE DATA PREPARATION UTILITY LAYER
 * - Aggressively clamps unique speakers to a maximum of 2, hard-shunting any 3rd wheel identities.
 * - Handles diverse global timeline schemas (e.g., [25/01, 17:21] and [12:32 pm, 8/2/2026]).
 * - Automatically neutralizes copied text quote-replies.
 */
function prepareChatData(text) {
    if (!text || typeof text !== 'string') return { cleanTranscript: '', timeMetadata: [] };

    let lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    
    // Catch-all regex patterns to peel off bracketed timelines or standalone timeline headers
    const bracketTimestampRegex = /^\[\d{1,2}[/.\d\s,:]*?(?:\d{1,2}:\d{2})?\s*(?:AM|PM)?.*?\]\s*/i;
    const standaloneTimestampRegex = /\b(\d{1,2}:\d{2})\s*(?:AM|PM)?\b/i;
    const explicitNameRegex = /^([^:\n]{1,30}?):/;

    let nativeNamesDetected = [];
    let processedLines = [];
    let seenMessagesHistory = [];

    for (let line of lines) {
        let messageTime = null;
        let workingLine = line;

        try {
            // 1. Isolate and strip out bracket configurations
            let bracketMatch = workingLine.match(bracketTimestampRegex);
            if (bracketMatch) {
                let timeExtract = bracketMatch[0].match(standaloneTimestampRegex);
                if (timeExtract) messageTime = timeExtract[0];
                workingLine = workingLine.replace(bracketTimestampRegex, '').trim();
            } else {
                let inlineMatch = workingLine.match(standaloneTimestampRegex);
                if (inlineMatch) {
                    messageTime = inlineMatch[0];
                    workingLine = workingLine.replace(standaloneTimestampRegex, '').trim();
                }
            }

            // Strip attachment notifications
            workingLine = workingLine
                .replace(/\[?(photo|image|video|attachment|sticker|location|missed call)\]?/gi, '')
                .trim();

            if (!workingLine) continue;

            // 2. Identify the speaker label
            let nameMatch = workingLine.match(explicitNameRegex);
            if (nameMatch) {
                let foundName = nameMatch[1].trim();
                let actualText = workingLine.replace(explicitNameRegex, '').trim();
                if (!actualText) continue;

                // Neutralize text duplicate loops (quote replies)
                const isQuoteReply = seenMessagesHistory.some(msg => msg.includes(actualText) || actualText.includes(msg));
                
                if (!isQuoteReply) {
                    // CRITICAL GUARDRAIL: Only allow the first 2 unique names into the structural loop
                    if (!nativeNamesDetected.includes(foundName) && nativeNamesDetected.length < 2) {
                        nativeNamesDetected.push(foundName);
                    }
                    processedLines.push({ rawName: foundName, text: actualText, time: messageTime, isQuote: false });
                    seenMessagesHistory.push(actualText);
                } else {
                    processedLines.push({ rawName: foundName, text: actualText, time: messageTime, isQuote: true });
                }
            } else {
                processedLines.push({ rawName: null, text: workingLine, time: messageTime, isQuote: false });
                seenMessagesHistory.push(workingLine);
            }
        } catch (lineError) {
            processedLines.push({ rawName: null, text: line, time: null, isQuote: false });
        }
    }

    // Direct fallback mapping normalization
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
            // HARD CLAMP: If a 3rd speaker slips in, automatically map them to whoever isn't speaking right now
            assignedName = speakerMap[item.rawName] || (fallbackToggle === 1 ? nativeNamesDetected[0] : nativeNamesDetected[1]);
        } else {
            assignedName = fallbackToggle === 1 ? nativeNamesDetected[0] : (nativeNamesDetected[1] || "Person 2");
        }

        if (item.isQuote) {
            finalTranscriptLines.push(`[Quote referenced by speaker]: "${item.text}"`);
            continue; 
        }

        // --- CALC TIME GAP DELTAS ---
        let delayMinutes = 0;
        try {
            let currentMinutes = parseTimeToMinutes(item.time);
            if (currentMinutes !== null && lastMessageMinutes !== null) {
                delayMinutes = currentMinutes - lastMessageMinutes;
                if (delayMinutes < 0) delayMinutes += 1440; 
            }
            if (currentMinutes !== null) lastMessageMinutes = currentMinutes;
        } catch (err) {
            delayMinutes = 0;
        }

        timeMetadataCollection.push({
            speaker: assignedName,
            timestamp: item.time || "N/A",
            elapsedMinutesSinceLastReply: delayMinutes
        });

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
 * 2. MAIN API CONTROLLER ENDPOINT
 */
export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { chatLog } = req.body;
    if (!chatLog) return res.status(400).json({ error: 'Please provide a valid conversation log.' });

    const { cleanTranscript, timeMetadata } = prepareChatData(chatLog);

    const systemPrompt = `You are an expert conversation analyst. Analyze the provided chat transcript.
You may encounter timestamp indicators like "[System Metric: X minutes passed]" or text references like "[Quote referenced by speaker]".

CRITICAL REQUIREMENTS:
1. Treat structural communication delays organically as an auxiliary behavioral evaluation metric.
2. Only highlight timing parameters or quote trends if they directly drive major conversational tension shifts.
3. Your output MUST match the schema format below exactly, yielding an array of EXACTLY 2 profiles. Never return a third profile block.

JSON Output Schema:
{
  "analytics": {
    "bond_strength": "Percentage string",
    "bond_strength_reason": "Overall summary sentence.",
    "bond_positivity": "Percentage string",
    "bond_positivity_reason": "Short contextual critique",
    "conflict_resolution": "Percentage string",
    "conflict_resolution_reason": "Short contextual critique.",
    "safety_trust": "Percentage string",
    "safety_trust_reason": "Short contextual critique",
    "relationship_dynamics": "Percentage string",
    "relationship_dynamics_reason": "Short contextual critique",
    "toxicity": "Percentage string",
    "toxicity_reason": "Short contextual critique highlighting escalations when relevant.",
    "summary": "Final warm takeaway advice line",
    "profiles": [
      {
        "name": "Exact Name of Person 1",
        "attachment_security": "Percentage string",
        "attachment_security_reason": "Short analytical insight",
        "emotional_regulation": "Percentage string",
        "emotional_regulation_reason": "Short analytical insight.",
        "receptivity": "Percentage string",
        "receptivity_reason": "Short analytical insight.",
        "accountability": "Percentage string",
        "accountability_reason": "Short analytical insight",
        "actionables": ["Action step 1", "Action step 2"]
      },
      {
        "name": "Exact Name of Person 2",
        "attachment_security": "Percentage string",
        "attachment_security_reason": "Short analytical insight",
        "emotional_regulation": "Percentage string",
        "emotional_regulation_reason": "Short analytical insight.",
        "receptivity": "Percentage string",
        "receptivity_reason": "Short analytical insight.",
        "accountability": "Percentage string",
        "accountability_reason": "Short analytical insight",
        "actionables": ["Action step 1", "Action step 2"]
      }
    ]
  }
}`;

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
        const analyticalPayload = JSON.parse(rawData.choices[0].message.content);
        return res.status(200).json(analyticalPayload);

    } catch (error) {
        console.error("Pipeline Runtime Exception:", error);
        return res.status(500).json({ error: "Failed to evaluate the chat timeline correctly." });
    }
}
