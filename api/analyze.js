/**
 * HELPER: Parses standard chat timestamp strings into raw minutes for delta calculations.
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
        return null;
    }
}

/**
 * 1. HIGH-TOLERANCE DATA PREPARATION UTILITY LAYER
 * - Scrubs system noise and normalizes text streams.
 * - Detects and neutralizes text-duplication Quote/Reply loops.
 * - Enforces absolute 2-person boundaries to protect the frontend dashboard.
 */
function prepareChatData(text) {
    if (!text || typeof text !== 'string') return { cleanTranscript: '', timeMetadata: [] };

    let lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    
    const explicitNameRegex = /^\[?([A-Z][a-zA-Z0-9_\s]{0,25}?)\]?[:\-\u2014]/;
    const bracketTimestampRegex = /^\[\d{1,2}:\d{2}\s*(?:AM|PM)?(?:[\s,/\d-]*?)[\]\s\-:]*/i;
    const standaloneTimestampRegex = /\b(\d{1,2}:\d{2}\s*(?:AM|PM)?)\b/i;
    
    let nativeNamesDetected = [];
    let processedLines = [];
    let seenMessagesHistory = []; // Tracks previously processed text blocks to spot quote-replies

    for (let line of lines) {
        let messageTime = null;
        let workingLine = line;

        try {
            // Extract and normalize metadata timestamps
            let bracketMatch = workingLine.match(bracketTimestampRegex);
            if (bracketMatch) {
                let innerTime = bracketMatch[0].match(standaloneTimestampRegex);
                if (innerTime) messageTime = innerTime[1];
                workingLine = workingLine.replace(bracketTimestampRegex, '').trim();
            } else {
                let inlineMatch = workingLine.match(standaloneTimestampRegex);
                if (inlineMatch) {
                    messageTime = inlineMatch[1];
                    workingLine = workingLine.replace(standaloneTimestampRegex, '').trim();
                }
            }

            // Remove media wrappers
            workingLine = workingLine
                .replace(/\[?(photo|image|video|attachment|sticker|location|missed call)\]?/gi, '')
                .trim();

            if (!workingLine) continue;

            let nameMatch = workingLine.match(explicitNameRegex);
            if (nameMatch) {
                let foundName = nameMatch[1].trim();
                let actualText = workingLine.replace(explicitNameRegex, '').trim();
                if (!actualText) continue;

                // --- QUOTE-REPLY DUP DETECTION LOGIC ---
                // If this exact text block was already said earlier by someone else, 
                // it's an inline quote/reply fragment. We skip tracking this user label as an actor.
                const isQuoteReply = seenMessagesHistory.some(msg => msg.includes(actualText) || actualText.includes(msg));
                
                if (!isQuoteReply) {
                    if (!nativeNamesDetected.includes(foundName) && nativeNamesDetected.length < 2) {
                        nativeNamesDetected.push(foundName);
                    }
                    processedLines.push({ rawName: foundName, text: actualText, time: messageTime, isQuote: false });
                    seenMessagesHistory.push(actualText);
                } else {
                    // Flag it as a quote line so the structure compiler handles it cleanly
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

    // Assign fallback roles cleanly
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

        // Quote Adjustment Guardrail: If this line was flagged as a quote, it means the current speaker 
        // is just referencing the other person's old message. The text belongs to the conversation, 
        // but we ensure the *next* actual text line maps back to the current user cleanly.
        if (item.isQuote) {
            finalTranscriptLines.push(`[Quote referenced by speaker]: "${item.text}"`);
            continue; // Skip calculating deltas or mapping turns on a echoed quote line
        }

        // --- TIME DELTA PROCESSING ---
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
        cleanTranscript: finalTranscriptLines.join('\n'),
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
3. Your output MUST match the schema format below exactly, yielding an array of EXACTLY 2 profiles.

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
