// ============================================================
//  TRUVAH — ANALYZE CONFIG
// ============================================================

// ── Model ────────────────────────────────────────────────────
export const OPENROUTER_MODEL  = 'openrouter/auto';
export const AGENT_TEMPERATURE = 0.1;

// ── Parser thresholds ────────────────────────────────────────
export const DELAY_MIN_HOURS       = 8;
export const DELAY_MAX_HOURS       = 2000;
export const SLEEP_GAP_MAX_HOURS   = 14;
export const SLEEP_START_HOUR_MIN  = 21;
export const SLEEP_START_HOUR_MAX  = 4;
export const SLEEP_END_HOUR_MIN    = 5;
export const SLEEP_END_HOUR_MAX    = 11;
export const ROUTINE_GAP_THRESHOLD = 3;
export const ROUTINE_GAP_MAX_HOURS = 16;
export const PAUSE_NEIGHBOURHOOD   = 1;

// ── Keywords ─────────────────────────────────────────────────
export const WARM_KEYWORDS     = ['sorry','guilty','babe','love','💕','❤️','haha','hey','sweet','dear','thanks','hug','miss','🥰','😘','😊','lol'];
export const CHILLING_KEYWORDS = ['chilling','relaxing','scrolling'];

// ── Score constants (engine only) ────────────────────────────
export const SCORE = {
  TOXICITY_CHILLING_STEP: 1.5,
  CONFLICT_REPAIR_WEIGHT: 0.25,
  ASYMMETRY_STEP:         1.5,
  ASYMMETRY_CAP:          12,
  OVERALL_DIVISOR:        5,
};

// ── Pacing context (factual only) ────────────────────────────
export function buildPacingNote({ names, metrics }) {
  if (metrics.totalDelays === 0) return '';
  const repairDesc = metrics.repairPercentage >= 70 ? 'most of the time'
                   : metrics.repairPercentage >= 40 ? 'about half the time'
                   : 'rarely';
  return `
CONVERSATION STRUCTURE NOTE:
- ${metrics.totalDelays} irregular reply gaps (8+ hrs).
- ${names.asyncPartner} accounts for more gaps than ${names.consistentPartner}.
- After gaps, ${names.asyncPartner} returns warmly ${repairDesc} (${metrics.repairPercentage}%).
Treat [Pause] tags as one contextual signal alongside tone and emotional exchanges.`.trim();
}

// ── Agent 1: Relationship Dynamics ───────────────────────────
export function buildDynamicsPrompt({ pacingNote }) {
  return `You are a Relationship Counselor. Analyze the annotated chat.

Instructions:
- Score each metric independently (0–100).
- Base scores only on observed behaviours.
- Reasons must reference specific exchanges.


${pacingNote ? pacingNote : ''}

CRITICAL: You must return ALL the following keys. Do not omit any.
Return ONLY valid JSON with ALL of these fields present:
{
  "bond_positivity": "XX%", "bond_positivity_reason": "...",
  "conflict_resolution": "XX%", "conflict_resolution_reason": "...",
  "safety_trust": "XX%", "safety_trust_reason": "...",
  "relationship_dynamics": "XX%", "relationship_dynamics_reason": "...",
  "toxicity": "XX%", "toxicity_reason": "..."
}`;
}

// ── Agent 2: Persona ─────────────────────────────────────────
export function buildPersonaPrompt({ names, pacingNote }) {
  return `You are a Behavioral Psychologist. Profile ${names.consistentPartner} and ${names.asyncPartner}.

Instructions:
- Score each trait independently (0–100).
- Reasons must cite specific behaviours.
${pacingNote ? pacingNote : ''}

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

// ── Agent 3: Strategist ──────────────────────────────────────
export function buildStrategistPrompt({ names, personaData, dynamicsData }) {
  return `You are a Relationship Coach. Review the analyses and chat.

Relationship Dynamics: ${JSON.stringify(dynamicsData)}
Individual Profiles: ${JSON.stringify(personaData)}

Tasks:
1. Write a 2–3 sentence objective summary.
2. Provide 2 practical tips for each person.
3. Return Bond Strength % (0–100), consistent with evidence.

Return ONLY valid JSON:
{
  "bond_strength": "XX%",
  "bond_strength_reason": "...",
  "summary": "...",
  "actionables": {
    "${names.consistentPartner}": ["Tip 1", "Tip 2"],
    "${names.asyncPartner}": ["Tip 1", "Tip 2"]
  }
}`;
}

// ── Validation keys ──────────────────────────────────────────
export const REQUIRED_DYNAMICS_KEYS = [
  'bond_positivity','bond_positivity_reason',
  'conflict_resolution','conflict_resolution_reason',
  'safety_trust','safety_trust_reason',
  'relationship_dynamics','relationship_dynamics_reason',
  'toxicity','toxicity_reason'
];

export const REQUIRED_STRATEGIST_KEYS = [
  'bond_strength','bond_strength_reason','summary','actionables',
];
