Because your code attempts to parse that html error string as JSON, it trips over the very first letter **"A"** in *"A server error..."*, prompting your browser alert: `Unexpected token 'A'... is not valid JSON`.

---

## 🛠️ The Absolute Fixes

To resolve both issues simultaneously, we need to apply two explicit updates to your `pages/api/analyze.js` file:
1. **Unify the Object Mapping:** Explicitly match the returned JSON keys to ensure `accountability` cleanly populates your UI's `owning_personal_errors` state properties.
2. **Add an Automatic Markdown / Prose Stripper:** Implement a robust Regex cleaner function right before `JSON.parse()` handles any LLM string payload.

Here is the fully stabilized code snippet with the updated keys and structural guards:

```javascript
// Add this helper function at the top of your file to bulletproof all JSON parsing calls
function cleanAndParseJSON(rawString) {
  if (!rawString || typeof rawString !== 'string') {
    throw new Error("Target payload is empty or invalid.");
  }
  
  // Strip away accidental markdown wrap blocks if the model includes them
  let cleanStr = rawString.trim();
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

// =========================================================================
// UPDATE AGENT 1 PROMPT: Align keys explicitly with your UI state expectations
// =========================================================================
const personaPrompt = `You are a behavioral psychologist profiling conversational patterns.
Analyze the text, noting the pre-calculated pacing constraints provided below.

PRE-CALCULATED STRUCTURAL CONTEXT:
- Rohan has a text repair recovery factor of ${metrics.repairPercentage}%.

SCORING MANDATE:
- Aditi: Secure pacing, high availability. Keep her scores high at 85-95%.
- Rohan: Anchor within 70-80%. He displays deep affection but his lifestyle slows down conversational pacing.

Return ONLY a valid JSON object matching this exact schema:
{
  "profiles": [
    {
      "name": "Actual name of Person 1",
      "attachment_security": "XX%",
      "attachment_security_reason": "1 short sentence balancing text lags vs loving reassurance.",
      "emotional_regulation": "XX%",
      "emotional_regulation_reason": "1 clear sentence about their consistency and interactive speed.",
      "receptivity": "XX%",
      "receptivity_reason": "1 short sentence showing how warmly they receive their partner's check-ins.",
      "owning_personal_errors": "XX%",
      "owning_personal_errors_reason": "1 short sentence assessing their repair behavior after time delays or structural texting gaps."
    },
    {
      "name": "Actual name of Person 2",
      "attachment_security": "XX%",
      "attachment_security_reason": "1 short sentence balancing text lags vs loving reassurance.",
      "emotional_regulation": "XX%",
      "emotional_regulation_reason": "1 clear sentence about their consistency and interactive speed.",
      "receptivity": "XX%",
      "receptivity_reason": "1 short sentence showing how warmly they receive their partner's check-ins.",
      "owning_personal_errors": "XX%",
      "owning_personal_errors_reason": "1 short sentence assessing their repair behavior after time delays or structural texting gaps."
    }
  ]
}`;

// =========================================================================
// UPDATE THE AGENT QUERY EXECUTION WRAPPER
// =========================================================================
async function queryAgent(systemInstructions, userContent) {
  const response = await fetch("[https://openrouter.ai/api/v1/chat/completions](https://openrouter.ai/api/v1/chat/completions)", {
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
  
  // Catch server crashes before they can break the JSON parser downstream
  if (!response.ok) {
    throw new Error(`OpenRouter gateway error encountered. Status code: ${response.status}`);
  }
  
  const resData = await response.json();
  const rawContent = resData.choices[0].message.content;
  
  // Use our clean guard instead of vulnerable native JSON.parse()
  return cleanAndParseJSON(rawContent);
}
