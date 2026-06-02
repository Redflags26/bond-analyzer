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
  TOXICITY_MAX:            10,
  TOXICITY_CHILLING_STEP:  1.5,

  CONFLICT_BASE:           70,
  CONFLICT_MAX:            95,
  CONFLICT_REPAIR_WEIGHT:  0.25,

  TEAMWORK_BASE:           75,
  TEAMWORK_MAX:            95,
  ASYMMETRY_STEP:          1.5,
  ASYMMETRY_CAP:           12,

  ACCOUNTABILITY_MIN:      75,
  ACCOUNTABILITY_MAX:      92,
  ACCOUNTABILITY_WEIGHT:   0.15,

  OVERALL_DIVISOR:         5,

  FALLBACK_WARMTH:         90,
  FALLBACK_RESOLUTION:     95,
  FALLBACK_SAFETY:         90,
  FALLBACK_DYNAMICS:       95,
  FALLBACK_TOXICITY:       3,
};

// ── Pacing note — only injected when delays are meaningful ───
// Called with { names, metrics }. Returns '' when no signal worth mentioning.
export function buildPacingNote({ names, metrics, minAcc, maxAcc }) {
  if (metrics.totalDelays === 0) return '';

  // Only flag asymmetry when the async partner has notably more delays
  return `
PACING SIGNAL (pre-computed — do not re-derive):
- ${metrics.totalDelays} significant reply gaps detected after filtering sleep and routine pauses.
- ${names.asyncPartner} carries more of these gaps. When they do reply, they repair ${metrics.repairPercentage}% of the time with warmth or affection.
- Score ${names.asyncPartner}'s Accountability in the ${minAcc}–${maxAcc}% range. Their Regulation and Receptivity should stay 80–90% (warm when active, not defensive).
- Score ${names.consistentPartner}'s availability-related metrics at 85–95% (consistently responsive).
- Locked scores: Toxicity = ${metrics.toxicity}%, Conflict Resolution = ${metrics.conflictResolution}%, Relationship Dynamics = ${metrics.teamwork}%.
- Do not invent delays or pacing issues beyond what the annotated text shows.`.trim();
}

// ── Agent 1: Persona ──────────────────────────────────────────
export function buildPersonaPrompt({ names, pacingNote }) {
  return `You are a behavioral psychologist. Analyze the conversation and score both people.
${pacingNote ? `\n${pacingNote}\n` : ''}
Return ONLY valid JSON:
{
  "profiles": [
    {
      "name": "${names.consistentPartner}",
      "attachment_security": "XX%", "attachment_security_reason": "one phrase",
      "emotional_regulation": "XX%", "emotional_regulation_reason": "one sentence",
      "receptivity": "XX%", "receptivity_reason": "one sentence",
      "accountability": "XX%", "accountability_reason": "one sentence"
    },
    {
      "name": "${names.asyncPartner}",
      "attachment_security": "XX%", "attachment_security_reason": "one phrase",
      "emotional_regulation": "XX%", "emotional_regulation_reason": "one sentence",
      "receptivity": "XX%", "receptivity_reason": "one sentence",
      "accountability": "XX%", "accountability_reason": "one sentence"
    }
  ]
}`;
}

// ── Agent 2: Dynamics ─────────────────────────────────────────
export function buildDynamicsPrompt({ metrics, pacingNote }) {
  return `You are a relationship counselor. Evaluate the couple's interaction.
${pacingNote ? `\n${pacingNote}\n` : ''}
Return ONLY valid JSON. Use these exact locked values where shown:
{
  "bond_positivity": "XX%", "bond_positivity_reason": "one phrase about warmth and tone",
  "conflict_resolution": "${metrics.conflictResolution}%", "conflict_resolution_reason": "one sentence",
  "safety_trust": "XX%", "safety_trust_reason": "one sentence",
  "relationship_dynamics": "${metrics.teamwork}%", "relationship_dynamics_reason": "one sentence",
  "toxicity": "${metrics.toxicity}%", "toxicity_reason": "one sentence",
  "bond_strength_reason": "one sentence combining affection and any pacing reality",
  "summary": "2–3 sentence friendly overview: what is going well, one thing to work on"
}`;
}

// ── Agent 3: Strategist ───────────────────────────────────────
// Receives only the compact summaries — not the full chat text.
export function buildStrategistPrompt({ names, personaData, dynamicsData }) {
  const slim = {
    p1: { name: personaData.profiles[0].name, accountability: personaData.profiles[0].accountability, regulation: personaData.profiles[0].emotional_regulation },
    p2: { name: personaData.profiles[1].name, accountability: personaData.profiles[1].accountability, regulation: personaData.profiles[1].emotional_regulation },
    summary: dynamicsData.summary,
    dynamics: dynamicsData.relationship_dynamics_reason,
  };
  return `You are a relationship coach. Based on this analysis, write 2 specific, kind, actionable tips for each person. Plain language, no numbers.

${JSON.stringify(slim)}

Return ONLY valid JSON:
{
  "${names.consistentPartner}_actionables": ["tip 1", "tip 2"],
  "${names.asyncPartner}_actionables": ["tip 1", "tip 2"]
}`;
}

// ── Required dynamics keys ────────────────────────────────────
export const REQUIRED_DYNAMICS_KEYS = [
  'bond_positivity','bond_positivity_reason',
  'conflict_resolution_reason',
  'safety_trust','safety_trust_reason',
  'relationship_dynamics_reason',
  'toxicity_reason',
  'bond_strength_reason',
  'summary',
];
