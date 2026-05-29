/**
 * 1. HIGH-STABILITY RAW DIALOGUE PROCESSING LAYER
 * - Safely handles mixed text structures, standard text-replies, and layout configurations.
 * - Strips out temporal indicators uniformly to completely eliminate mathematical calculation errors.
 */
function prepareChatData(text) {
    if (!text || typeof text !== 'string') return { cleanTranscript: '', names: ["Person 1", "Person 2"] };

    let lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    
    const bracketPattern = /\[[^\]]*\]/g;
    const fallbackDatePattern = /\b\d{1,2}[/\-.]\d{1,2}(?[/\-.]\d{2,4})?\b/g;
    const fallbackTimePattern = /\b\d{1,2}:\d{2}(\s*[AP]M)?\b/i;

    let nativeNamesDetected = [];
    let processedLines = [];
    let seenMessagesHistory = [];

    for (let line of lines) {
        let workingLine = line;
        try {
            // Unify lines by stripping timestamps and bracket metrics completely
            workingLine = workingLine.replace(bracketPattern, '').trim();
            workingLine = workingLine.replace(fallbackDatePattern, '').replace(fallbackTimePattern, '').trim();
            workingLine = workingLine.replace(/^(photo|image|video|attachment|sticker|location|missed call)$/gi, '').trim();

            if (!workingLine) continue;

            let colonIndex = workingLine.indexOf(':');
            if (colonIndex !== -1) {
                let rawName = workingLine.substring(0, colonIndex).trim();
                let actualText = workingLine.substring(colonIndex + 1).trim();
                
                // Keep speaker keys perfectly clean of leading/trailing text dust
                let foundName = rawName.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9\s()]+$/g, '').trim();
                
                if (!foundName || !actualText) continue;

                const isQuoteReply = seenMessagesHistory.some(msg => msg.includes(actualText) || actualText.includes(msg));
                
                if (!isQuoteReply) {
                    if (!nativeNamesDetected.includes(foundName) && nativeNamesDetected.length < 2) {
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

    // Lock in the final 2-actor name identities cleanly
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
        let assignedName = item.rawName ? (speakerMap[item.rawName] || (fallbackToggle === 1 ? nativeNamesDetected[0] : nativeNamesDetected[1])) : (fallbackToggle === 1 ? nativeNamesDetected[0] : nativeNamesDetected[1]);

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
 * 2. PRIMARY ENDPOINT IMPLEMENTATION
 */
export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { chatLog } = req.body;
    if (!chatLog) return res.status(400).json({ error: 'Please provide a valid conversation log.' });

    const { cleanTranscript, names } = prepareChatData(chatLog);

    const systemPrompt = `Analyze the conversation transcript provided. Return ONLY a valid, tightly packed JSON object matching the schema below.
The profiles array MUST contain exactly 2 items mapping directly to "${names[0]}" and "${names[1]}".

JSON Schema Structure:
{
  "analytics": {
    "bond_strength": "Percentage string",
    "bond_strength_reason": "Concise summary sentence.",
    "bond_positivity": "Percentage string",
    "bond_positivity_reason": "Short contextual critique.",
    "conflict_resolution": "Percentage string",
    "conflict_resolution_reason": "Short contextual critique.",
    "safety_trust": "Percentage string",
    "safety_trust_reason": "Short contextual critique.",
    "relationship_dynamics": "Percentage string",
    "relationship_dynamics_reason": "Short contextual critique.",
    "toxicity": "Percentage string",
    "toxicity_reason": "Short critique reviewing presence of friction.",
    "summary": "Final concise takeaway advice line.",
    "profiles": [
      {
        "name": "${names[0]}",
        "attachment_security": "Percentage string", "attachment_security_reason": "Short insight.",
        "emotional_regulation": "Percentage string", "emotional_regulation_reason": "Short insight.",
        "receptivity": "Percentage string", "receptivity_reason": "Short insight.",
        "accountability": "Percentage string", "accountability_reason": "Short insight.",
        "actionables": ["Action step 1", "Action step 2"]
      },
      {
        "name": "${names[1]}",
        "attachment_security": "Percentage string", "attachment_security_reason": "Short insight.",
        "emotional_regulation": "Percentage string", "emotional_regulation_reason": "Short insight.",
        "receptivity": "Percentage string", "receptivity_reason": "Short insight.",
        "accountability": "Percentage string", "accountability_reason": "Short insight.",
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
                ],
                temperature: 0.1,
                max_tokens: 800
            })
        });

        // Fail early if upstream server anomalies occur
        if (!response.ok) {
            throw new Error(`Upstream gateway responded with status: ${response.status}`);
        }

        const rawData = await response.json();
        let payloadString = rawData.choices?.[0]?.message?.content;
        
        if (!payloadString) {
            throw new Error("Empty model content stream returned.");
        }

        const analyticalPayload = JSON.parse(payloadString);

        // Core array structure enforcement safety check
        if (!analyticalPayload.analytics || !analyticalPayload.analytics.profiles || analyticalPayload.analytics.profiles.length < 2) {
            throw new Error("Incomplete profile data schema configuration.");
        }

        return res.status(200).json(analyticalPayload);

    } catch (error) {
        console.error("Pipeline Parsing Catch Block Activated:", error);
        return res.status(500).json({ error: "Analysis process encountered an unexpected issue. Please refine text data and try again." });
    }
}
