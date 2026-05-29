/**
 * Truvah Chat Log Preprocessor Utility
 * * Main Responsibilities:
 * 1. Cleans out platform-specific messaging noise (timestamps, attachment text).
 * 2. Smart-detects speaker names or alternating text blocks.
 * 3. Strictly enforces a maximum of 2 distinct actors to protect frontend layouts.
 */

function prepareChatData(text) {
    if (!text || typeof text !== 'string') return '';

    let lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    
    // Capture explicit speaker prefixes at line starts (e.g., "Alex:", "Jordan -", "[Sam]")
    const explicitNameRegex = /^\[?([A-Z][a-zA-Z0-9_\s]{0,15}?)\]?[:\-\u2014]/;
    
    let nativeNamesDetected = [];
    let processedLines = [];

    // --- STEP 1: REMOVE METADATA NOISE & ISOLATE ACTORS ---
    for (let line of lines) {
        // Strip app-specific system notifications, media tags, and standard time structures
        let cleanLine = line
            .replace(/\[?(photo|image|video|attachment|sticker|location|missed call)\]?/gi, '')
            .replace(/\b\d{1,2}:\d{2}\s*(?:AM|PM)?\b/gi, '')
            .trim();

        if (!cleanLine) continue;

        let match = cleanLine.match(explicitNameRegex);
        
        if (match) {
            let foundName = match[1].trim();
            let actualText = cleanLine.replace(explicitNameRegex, '').trim();
            
            if (!actualText) continue; // Ignore lines that only contained structural labels

            // Register names sequentially up to an absolute limit of 2
            if (!nativeNamesDetected.includes(foundName) && nativeNamesDetected.length < 2) {
                nativeNamesDetected.push(foundName);
            }

            processedLines.push({
                rawName: foundName,
                text: actualText
            });
        } else {
            // Handle raw continuous chat transcripts that lack explicit prefix tracking
            processedLines.push({
                rawName: null,
                text: cleanLine
            });
        }
    }

    // --- STEP 2: RESOLVE SPEAKER IDENTITIES AND CLAMP TO 2 ---
    let speakerMap = {};
    
    if (nativeNamesDetected.length === 2) {
        // Balanced Scenario: Two clean names found natively.
        speakerMap[nativeNamesDetected[0]] = nativeNamesDetected[0];
        speakerMap[nativeNamesDetected[1]] = nativeNamesDetected[1];
    } else if (nativeNamesDetected.length === 1) {
        // Asymmetric Scenario: Only one clear speaker tracked. Fallback second user to 'Person 2'.
        speakerMap[nativeNamesDetected[0]] = nativeNamesDetected[0];
        speakerMap["__fallback_other__"] = "Person 2";
    } else {
        // Fallback Scenario: No clean name structures found OR more than 2 distinct cross-talking labels.
        // Force a strict Person 1 / Person 2 alternating ping-pong array.
        let finalOutput = [];
        let currentToggle = 1;
        
        for (let item of processedLines) {
            finalOutput.push(`Person ${currentToggle}: ${item.text}`);
            currentToggle = currentToggle === 1 ? 2 : 1; 
        }
        return finalOutput.join('\n');
    }

    // --- STEP 3: CONSOLIDATE FINAL TWO-PERSON BOUNDARY TRANSCRIPT ---
    let finalOutput = [];
    let fallbackToggle = 1;

    for (let item of processedLines) {
        let assignedName = "";

        if (item.rawName) {
            if (speakerMap[item.rawName]) {
                assignedName = speakerMap[item.rawName];
            } else {
                // Layout Guardrail: If a 3rd speaker/group message label hits, force-route the line 
                // to whoever didn't take the immediate last turn to prevent layout duplication breaks.
                assignedName = fallbackToggle === 1 ? nativeNamesDetected[0] : nativeNamesDetected[1];
            }
        } else {
            // Unlabeled alternating blocks get tracked back to known actors
            assignedName = fallbackToggle === 1 ? nativeNamesDetected[0] : (nativeNamesDetected[1] || "Person 2");
        }

        finalOutput.push(`${assignedName}: ${item.text}`);
        
        // Cache the toggle state tracking context
        fallbackToggle = (assignedName === nativeNamesDetected[0]) ? 2 : 1;
    }

    return finalOutput.join('\n');
}

// Export for application architecture consumption
module.exports = { prepareChatData };
