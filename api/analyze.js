/**
 * 1. HIGH-STABILITY CONVERSATION EXTRACTION LAYER
 * - Wipes away raw metadata blocks, dates, and brackets cleanly.
 * - Extracts clean names and text strings completely decoupled from date anomalies.
 */
function prepareChatData(text) {
    if (!text || typeof text !== 'string') return { cleanTranscript: '', names: ["Person 1", "Person 2"] };

    let lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    
    // Comprehensive patterns to aggressively target bracket data configurations
    const bracketPattern = /\[[^\]]*\]/g;
    const fallbackDatePattern = /\b\d{1,2}[/\-.]\d{1,2}(?[/\-.]\d{2,4})?\b/g;
    const fallbackTimePattern = /\b\d{1,2}:\d{2}(\s*[AP]M)?\b/i;

    let nativeNamesDetected = [];
    let processedLines = [];
    let seenMessagesHistory = [];

    for (let line of lines) {
        let workingLine = line;

        try {
            // Step A: Strip bracket segments completely
            workingLine = workingLine.replace(bracketPattern, '').trim();
            // Step B: Strip any loose, non-bracketed timeline artifacts 
            workingLine = workingLine.replace(fallbackDatePattern, '').replace(fallbackTimePattern, '').trim();

            // Clear media notifications
            workingLine = workingLine
                .replace(/^(photo|image|video|attachment|sticker|location|missed call)$/gi, '')
                .trim();

            if (!workingLine) continue;

            // Step C: Isolate the core speaker label up to the first colon split
            let colonIndex = workingLine.indexOf(':');
            if (colonIndex !== -1) {
                let rawName = workingLine.substring(0, colonIndex).trim();
                let actualText = workingLine.substring(colonIndex + 1).trim();

                // Clean the name string of any residual non-alphanumeric punctuation junk
                let foundName = rawName.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9\s()]+$/g, '').trim();
                if (!foundName || !actualText) continue;

                // Handle duplication / copy-paste quote-reply tracks safely
                const isQuoteReply = seenMessagesHistory.some(msg => msg.includes(actualText) || actualText.includes(msg));
                
                if (!isQuoteReply) {
                    if (!nativeNamesDetected.includes(foundName) && nativeNamesDetected.length < 2) {
                        // Enforce uniqueness between highly similar name nodes
                        if (nativeNamesDetected.length === 1 && foundName.split(' ')[0].toLowerCase() === nativeNamesDetected[0].split(' ')[0].toLowerCase()) {
                            foundName = foundName + " (2)"; 
                        }
                        nativeNamesDetected.push(foundName);
                    }
                    processedLines.push({ rawName: foundName, text: actualText, isQuote: false });
                    seenMessagesHistory.push(actualText);
                } else {
                    processedLines.push({ rawName: foundName, text: actualText, isQuote: true });
                }
            } else {
                processedLines.push({ rawName: null, text: workingLine, isQuote: false });
                seenMessagesHistory.push(workingLine);
            }
        } catch (err) {
            processedLines.push({ rawName: null, text: line, isQuote: false });
        }
    }

    // Resolve name array configuration
    let speakerMap = {};
    if (nativeNamesDetected.length === 2) {
        speakerMap[nativeNamesDetected[0]] = nativeNamesDetected[0];
        speakerMap[nativeNamesDetected[1]] = nativeNamesDetected[1];
    } else if (nativeNamesDetected.length === 1) {
        speakerMap[nativeNamesDetected[0]] = nativeNamesDetected[0];
        speakerMap["__fallback_other__"] = "Person 2";
        nativeNamesDetected.push("Person 2");
    } else {
        nativeNamesDetected = ["Person 1", "Person 2"];
    }

    let finalTranscriptLines = [];
    let fallbackToggle = 1;

    for (let item of processedLines) {
        let assignedName = "";

        if (item.rawName) {
            assignedName = speakerMap[item.rawName] || (fallbackToggle === 1 ? nativeNamesDetected[0] : nativeNamesDetected[1]);
        } else {
            assignedName = fallbackToggle === 1 ? nativeNamesDetected[0] : nativeNamesDetected[1];
        }

        if (item.isQuote) {
            finalTranscriptLines.push(`[Quote referenced by speaker]: "${item.text}"`);
            continue; 
        }

        finalTranscriptLines.push(`${assignedName}: ${item.text}`);
        fallbackToggle = (assignedName === nativeNamesDetected[0]) ? 2 : 1;
    }

    return {
        cleanTranscript: finalTranscriptLines.join('\n'),
        names: nativeNamesDetected
    };
}

/**
 * 2. MAIN ENDPOINT ROUTE
 */
export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { chatLog } = req.body;
    if (!chatLog) return res.status(400).json({ error: 'Please provide a valid conversation log.' });

    const { cleanTranscript, names } = prepareChatData(chatLog);

    const systemPrompt = `You are an expert conversation analyst. Analyze the provided chat transcript.

CRITICAL STRUCTURAL COMPLIANCE:
1. Your output must be a single valid JSON object matching the exact schema structure below.
2. The transcript strictly contains two primary actors: "${names[0]}" and "${names[1]}".
3. The "profiles" array output MUST contain exactly 2 elements—the first element must be mapped to "${names[0]}", and the second element must be mapped to "${names[1]}". Never skip or alter this array size.

JSON Output Schema:
{
  "analytics": {
    "bond_strength": "Percentage string",
    "bond_strength_reason": "Overall summary sentence evaluating core conversation dynamics.",
    "bond_positivity": "Percentage string",
    "bond_positivity_reason": "Short critique assessing communication health.",
    "conflict_resolution": "Percentage string",
    "conflict_resolution_reason": "Short critique analyzing responses, resolution markers, and pacing.",
    "safety_trust": "Percentage string",
    "safety_trust_reason": "Short contextual critique evaluating alignment.",
    "relationship_dynamics": "Percentage string",
    "relationship_dynamics_reason": "Short contextual critique outlining interaction style.",
    "toxicity": "Percentage string",
    "toxicity_reason": "Short critique reviewing presence of passive-aggressive behaviors or tension drops.",
    "summary": "Final concise takeaway advice line.",
    "profiles": [
      {
        "name": "${names[0]}",
        "attachment_security": "Percentage string",
        "attachment_security_reason": "Short insight.",
        "emotional_regulation": "Percentage string",
        "emotional_regulation_reason": "Short insight regarding conversational style.",
        "receptivity": "Percentage string",
        "receptivity_reason": "Short insight regarding response style.",
        "accountability": "Percentage string",
        "accountability_reason": "Short analytical insight.",
        "actionables": ["Action step 1", "Action step 2"]
      },
      {
        "name": "${names[1]}",
        "attachment_security": "Percentage string",
        "attachment_security_reason": "Short insight.",
        "emotional_regulation": "Percentage string",
        "emotional_regulation_reason": "Short insight regarding conversational style.",
        "receptivity": "Percentage string",
        "receptivity_reason": "Short insight regarding response style.",
        "accountability": "Percentage string",
        "accountability_reason": "Short analytical insight.",
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
        let payloadString = rawData.choices[0].message.content;
        const analyticalPayload = JSON.parse(payloadString);

        // Validation guardrail to protect array lengths
        if (!analyticalPayload.analytics || !analyticalPayload.analytics.profiles || analyticalPayload.analytics.profiles.length < 2) {
            throw new Error("Invalid schema shape returned by endpoint.");
        }

        return res.status(200).json(analyticalPayload);

    } catch (error) {
        console.error("Pipeline Parsing Exception:", error);
        return res.status(500).json({ error: "Failed to parse conversation analytics payload." });
    }
}
