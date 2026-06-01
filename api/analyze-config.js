/**
 * CONFIGURATION & UNIFIED PROMPTS
 */

export const CONFIG = {
  THRESHOLDS: {
    SLEEP_START_HOUR: 21,
    SLEEP_END_HOUR: 4,
    MORNING_START: 5,
    MORNING_END: 11,
    ROUTINE_GAP_HOURS: 16,
    SHORT_CHAT_DAYS: 1.5,
    MIN_GAP_HOURS: 5
  },
  STRINGS: {
    WARM_KEYWORDS: ['sorry', 'guilty', 'babe', 'love', '💕', '❤️', 'haha', 'hey', 'sweet', 'dear', 'thanks', 'hug', 'miss', '🥰', '😘', '😊', 'lol'],
    CHILL_KEYWORDS: ['chilling', 'relaxing', 'scrolling']
  }
};

/**
 * Generates the conditional injection for chats that have pacing gaps.
 */
export const GET_PACING_INJECTION = (isShort, names, metrics) => {
  if (isShort) return ""; // No special pacing instructions for short chats

  return `
    PACING ANALYSIS REQUIRED:
    - This conversation spans multiple days with notable gaps.
    - ${names.asyncPartner} has a "Repair Factor" of ${metrics.repairPercentage}%. This is how often they use warmth or apologies after a long delay.
    - Factor these delays into "Accountability" and "Emotional Regulation" scores (suggested range: 75-90% if repair is high).
    - In the dynamics, mention how they navigate these response time differences.
  `;
};

export const GET_PERSONA_PROMPT = (names, pacingInjection) => `
  You are a behavioral psychologist. Profile the following two individuals based on their interaction style.
  ${pacingInjection}
  Return ONLY a valid JSON object:
  {
    "profiles": [
      {
        "name": "${names.consistentPartner}",
        "attachment_security": "XX%", "attachment_security_reason": "1 short sentence.",
        "emotional_regulation": "XX%", "emotional_regulation_reason": "1 short sentence.",
        "receptivity": "XX%", "receptivity_reason": "1 short sentence.",
        "accountability": "XX%", "accountability_reason": "1 short sentence."
      },
      {
        "name": "${names.asyncPartner}",
        "attachment_security": "XX%", "attachment_security_reason": "1 short sentence.",
        "emotional_regulation": "XX%", "emotional_regulation_reason": "1 short sentence.",
        "receptivity": "XX%", "receptivity_reason": "1 short sentence.",
        "accountability": "XX%", "accountability_reason": "1 short sentence."
      }
    ]
  }`;

export const GET_DYNAMICS_PROMPT = (names, metrics, pacingInjection) => `
  You are a relationship counselor. Analyze the pair's connection using these calculated metrics:
  - Toxicity: ${metrics.toxicity}% (strictly use this number)
  - Conflict Resolution: ${metrics.conflictResolution}% (strictly use this number)
  - Teamwork: ${metrics.teamwork}% (strictly use this number)
  ${pacingInjection}
  Return ONLY a valid JSON object:
  {
    "bond_strength": "XX%", "bond_strength_reason": "Brief synthesis of emotional alignment.",
    "bond_positivity": "XX%", "bond_positivity_reason": "Comment on tone and affection.",
    "conflict_resolution": "${metrics.conflictResolution}%", "conflict_resolution_reason": "How they handle disagreements or gaps.",
    "safety_trust": "XX%", "safety_trust_reason": "Presence of reassurance.",
    "relationship_dynamics": "${metrics.teamwork}%", "relationship_dynamics_reason": "Turn-taking and responsiveness.",
    "toxicity": "${metrics.toxicity}%", "toxicity_reason": "Reason for the score.",
    "summary": "A friendly, comforting overview of how their personal styles complement each other."
  }`;

export const GET_STRATEGIST_PROMPT = (names, personaData, dynamicsData) => `
  You are a behavioral strategist. Provide exactly 2 actionable tips for each person.
  Profiles: ${JSON.stringify(personaData)}
  Dynamics: ${JSON.stringify(dynamicsData)}
  Return ONLY a JSON object with keys: "${names.consistentPartner}_actionables" and "${names.asyncPartner}_actionables" (arrays of strings).
`;
