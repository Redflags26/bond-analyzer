// ============================================================
//  TRUVAH — ANALYZE CONFIG
//  All tunable constants and prompt templates.
//  analyze.js imports everything from here.
// ============================================================

// ── Model ────────────────────────────────────────────────────
export const OPENROUTER_MODEL  = 'openrouter/auto';
export const AGENT_TEMPERATURE = 0.1;

// ── Parser thresholds ────────────────────────────────────────
export const DELAY_MIN_HOURS           = 5;     // gaps shorter than this are ignored
export const DELAY_MAX_HOURS           = 2000;  // gaps longer than this are data errors
export const SLEEP_GAP_MAX_HOURS       = 14;
export const SLEEP_START_HOUR_MIN      = 21;    // 9 pm — considered "late night"
export const SLEEP_START_HOUR_MAX      = 4;     // 4 am — still "late night"
export const SLEEP_END_HOUR_MIN        = 5;     // 5 am — "morning" starts
export const SLEEP_END_HOUR_MAX        = 11;    // 11 am — "morning" ends
export const ROUTINE_GAP_THRESHOLD     = 2;     // hour must recur ≥ this many times to be routine
export const ROUTINE_GAP_MAX_HOURS     = 16;
export const PAUSE_NEIGHBOURHOOD       = 1;     // ±hours around a pause-start hour

// ── Keywords ─────────────────────────────────────────────────
export const WARM_KEYWORDS     = ['sorry','guilty','babe','love','💕','❤️','haha','hey','sweet','dear','thanks','hug','miss','🥰','😘','😊','lol'];
export const CHILLING_KEYWORDS = ['chilling','relaxing','scrolling'];

// ── Score constants ───────────────────────────────────────────
export const SCORE = {
  TOXICITY_MIN:            2,
  TOXICITY_MAX:            99,
  TOXICITY_CHILLING_STEP:  1.5,

  CONFLICT_BASE:           50,
  CONFLICT_MAX:            99,
  CONFLICT_REPAIR_WEIGHT:  0.25,

  TEAMWORK_BASE:           50,
  TEAMWORK_MAX:            99,
  ASYMMETRY_STEP:          1.5,
  ASYMMETRY_CAP:           12,

  ACCOUNTABILITY_MIN:      50,
  ACCOUNTABILITY_MAX:      99,
  ACCOUNTABILITY_WEIGHT:   0.15,

  OVERALL_DIVISOR:         5,

  FALLBACK_WARMTH:         69,
  FALLBACK_RESOLUTION:     69,
  FALLBACK_SAFETY:         69,
  FALLBACK_DYNAMICS:       69,
  FALLBACK_TOXICITY:       3,
};

// ── Pacing note — only injected when delays are meaningful ───
// Called with { names, metrics }. Returns '' when no signal worth mentioning.
export function buildPacingNote({ names, metrics, minAcc, maxAcc }) {
  if (metrics.totalDelays === 0) return '';

  // Only flag asymmetry when the async partner has notably more delays
  return `
PACING SIGNAL (pre-computed — do not re-derive):
- ${metrics.totalDelays} reply gaps detected after filtering sleep and routine pauses.
- ${names.asyncPartner} carries more of these gaps. When they do reply, they repair ${metrics.repairPercentage}% of the time with warmth or affection.
- Score ${names.asyncPartner}'s Accountability in the ${minAcc}–${maxAcc}% range.
- Score ${names.consistentPartner}'s availability-related metrics higher.
- Toxicity is high when ${metrics.totalDelays} is high.
- Locked scores: Conflict Resolution = ${metrics.conflictResolution}%, Relationship Dynamics = ${metrics.teamwork}%.
- Do not invent delays or pacing issues beyond what the annotated text shows.`.trim();
}

// ── Agent 1: Relationship Dynamics (Macro) ──
export function buildDynamicsPrompt({ metrics, pacingNote }) {
  return `You are a Relationship Counselor. Analyze the dynamic between the pair.
${pacingNote}
Return ONLY valid JSON:
{
  "bond_positivity": "XX%", "bond_positivity_reason": "...",
  "conflict_resolution": "${metrics.conflictResolution}%", "conflict_resolution_reason": "...",
  "safety_trust": "XX%", "safety_trust_reason": "...",
  "relationship_dynamics": "${metrics.teamwork}%", "relationship_dynamics_reason": "...",
  "toxicity": "${metrics.toxicity}%", "toxicity_reason": "..."
}`;
}

// ── Agent 2: Persona (Micro) ──
export function buildPersonaPrompt({ names, pacingNote }) {
  return `You are a Behavioral Psychologist. Profile both individuals.
${pacingNote}
Return ONLY valid JSON:
{
  "profiles": [
    {
      "name": "${names.consistentPartner}",
      "attachment_security": "XX%", "attachment_security_reason": "...",
      "emotional_regulation": "XX%", "emotional_regulation_reason": "...",
      "receptivity": "XX%", "receptivity_reason": "...",
      "accountability": "XX%", "accountability_reason": "..."
    },
    {
      "name": "${names.asyncPartner}",
      "attachment_security": "XX%", "attachment_security_reason": "...",
      "emotional_regulation": "XX%", "emotional_regulation_reason": "...",
      "receptivity": "XX%", "receptivity_reason": "...",
      "accountability": "XX%", "accountability_reason": "..."
    }
  ]
}`;
}

// ── Agent 3: Executive Strategist (Synthesis & Summary) ──
export function buildStrategistPrompt({ names, personaData, dynamicsData }) {
  return `You are a Relationship Coach. Review these findings:
Relationship Analysis: ${JSON.stringify(dynamicsData)}
Individual Profiles: ${JSON.stringify(personaData)}

TASK:
1. Write a 2–3 sentence friendly overview summary: what happened in the chat, why they reacted how they did, and how they can do better together.
2. Provide 2 actionable tips for each person.
3. Determine a final Bond Strength % (ensure it matches the friction described in profiles).

Return ONLY valid JSON:
{
  "bond_strength": "XX%",
  "bond_strength_reason": "Brief synthesis.",
  "summary": "...",
  "actionables": {
    "${names.consistentPartner}": ["Tip 1", "Tip 2"],
    "${names.asyncPartner}": ["Tip 1", "Tip 2"]
  }
}`;
}

// ── Required dynamics keys ────────────────────────────────────
export const REQUIRED_DYNAMICS_KEYS = [
  'bond_positivity','bond_positivity_reason',
  'conflict_resolution','conflict_resolution_reason',
  'safety_trust','safety_trust_reason',
  'relationship_dynamics','relationship_dynamics_reason',
  'toxicity','toxicity_reason',
  'bond_strength','bond_strength_reason',
  'summary',
];
