import { OpenRouterClient } from 'your-llm-library'; // Adjust based on your actual LLM wrapper

/**
 * 1. DATA PREPARATION UTILITY
 * Cleans out system noise and strictly forces a 2-person boundary matrix.
 */
function prepareChatData(text) {
    if (!text || typeof text !== 'string') return '';
    let lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    const explicitNameRegex = /^\[?([A-Z][a-zA-Z0-9_\s]{0,15}?)\]?[:\-\u2014]/;
    
    let nativeNamesDetected = [];
    let processedLines = [];

    for (let line of lines) {
        let cleanLine = line
            .replace(/\[?(photo|image|video|attachment|sticker|location|missed call)\]?/gi, '')
            .replace(/\b\d{1,2}:\d{2}\s*(?:AM|PM)?\b/gi, '')
            .trim();

        if (!cleanLine) continue;
        let match = cleanLine.match(explicitNameRegex);
        
        if (match) {
            let foundName = match[1].trim();
            let actualText = cleanLine.replace(explicitNameRegex, '').trim();
            if (!actualText) continue;

            if (!nativeNamesDetected.includes(foundName) && nativeNamesDetected.length < 2) {
                nativeNamesDetected.push(foundName);
            }
            processedLines.push({ rawName: foundName, text: actualText });
        } else {
            processedLines.push({ rawName: null, text: cleanLine });
        }
    }

    let speakerMap = {};
    if (nativeNamesDetected.length === 2) {
        speakerMap[nativeNamesDetected[0]] = nativeNamesDetected[0];
        speakerMap[nativeNamesDetected[1]] = nativeNamesDetected[1];
    } else if (nativeNamesDetected.length === 1) {
        speakerMap[nativeNamesDetected[0]] = nativeNamesDetected[0];
        speakerMap["__fallback_other__"] = "Person 2";
    } else {
        let finalOutput = [];
        let currentToggle = 1;
        for (let item of processedLines) {
            finalOutput.push(`Person ${currentToggle}: ${item.text}`);
            currentToggle = currentToggle === 1 ? 2 : 1; 
        }
        return finalOutput.join('\n');
    }

    let finalOutput = [];
    let fallbackToggle = 1;

    for (let item of processedLines) {
        let assignedName = "";
        if (item.rawName) {
            if (speakerMap[item.rawName]) {
                assignedName = speakerMap[item.rawName];
            } else {
                assignedName = fallbackToggle === 1 ? nativeNamesDetected[0] : nativeNamesDetected[1];
            }
        } else {
            assignedName = fallbackToggle === 1 ? nativeNamesDetected[0] : (nativeNamesDetected[1] || "Person 2");
        }
        finalOutput.push(`${assignedName}: ${item.text}`);
        fallbackToggle = (assignedName === nativeNamesDetected[0]) ? 2 : 1;
    }
    return finalOutput.join('\n');
}

/**
 * 2. MAIN API ROUTE HANDLER
 */
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { chatLog } = req.body;
    if (!chatLog) {
        return res.status(400).json({ error: 'Please provide a valid conversation log.' });
    }

    // --- STEP A: PREPARE THE DATA (RUNS SEPARATELY FIRST) ---
    const cleanChatTranscript = prepareChatData(chatLog);

    // --- STEP B: UNIFIED AI PIPELINE SYSTEM PROMPT ---
    const systemPrompt = `You are an expert conversation analyst. Analyze the provided chat transcript. 
You must output a single, well-formed JSON object matching the schema below.

CRITICAL INSTRUCTIONS:
1. The transcript will feature exactly two people. Use their exact names as found in the transcript line prefixes.
2. Provide precise scores (percentage strings, e.g., "75%") and contextual logic reasoning.
3. You must output EXACTLY 2 entries in the "profiles" array—one for each person. Never more, never less.

JSON Schema Output Format:
{
  "analytics": {
    "bond_strength": "Percentage string",
    "bond_strength_reason": "Overall summary sentence",
    "bond_positivity": "Percentage string",
    "bond_positivity_reason": "Short contextual critique",
    "conflict_resolution": "Percentage string",
    "conflict_resolution_reason": "Short contextual critique",
    "safety_trust": "Percentage string",
    "safety_trust_reason": "Short contextual critique",
    "relationship_dynamics": "Percentage string",
    "relationship_dynamics_reason": "Short contextual critique",
    "toxicity": "Percentage string",
    "toxicity_reason": "Short contextual critique",
    "summary": "Final warm takeaway advice line",
    "profiles": [
      {
        "name": "Exact Name of Person 1",
        "attachment_security": "Percentage string",
        "attachment_security_reason": "Short analytical insight",
        "emotional_regulation": "Percentage string",
        "emotional_regulation_reason": "Short analytical insight",
        "receptivity": "Percentage string",
        "receptivity_reason": "Short analytical insight",
        "accountability": "Percentage string",
        "accountability_reason": "Short analytical insight",
        "actionables": ["Action step 1", "Action step 2"]
      },
      {
        "name": "Exact Name of Person 2",
        "attachment_security": "Percentage string",
        "attachment_security_reason": "Short analytical insight",
        "emotional_regulation": "Percentage string",
        "emotional_regulation_reason": "Short analytical insight",
        "receptivity": "Percentage string",
        "receptivity_reason": "Short analytical insight",
        "accountability": "Percentage string",
        "accountability_reason": "Short analytical insight",
        "actionables": ["Action step 1", "Action step 2"]
      }
    ]
  }
}`;

    // --- STEP C: EXECUTE THE UNIFIED AI CALL ---
    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "google/gemini-2.5-flash", // Or your preferred active model
                response_format: { type: "json_object" }, // Forces structured JSON parsing
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: cleanChatTranscript }
                ]
            })
        });

        const rawData = await response.json();
        
        // Extract and pass the clean parsed analytics payload right back to the frontend
        const analyticalPayload = JSON.parse(rawData.choices[0].message.content);
        return res.status(200).json(analyticalPayload);

    } catch (error) {
        console.error("Pipeline Error:", error);
        return res.status(500).json({ error: "Failed to evaluate the chat timeline correctly." });
    }
}
