export const OPENROUTER_MODEL  = 'openrouter/auto';
export const AGENT_TEMPERATURE = 0.1;

export const DELAY_MIN_HOURS           = 5;
export const DELAY_MAX_HOURS           = 2000;
export const SLEEP_GAP_MAX_HOURS       = 14;
export const SLEEP_START_HOUR_MIN      = 21;
export const SLEEP_START_HOUR_MAX      = 4;
export const SLEEP_END_HOUR_MIN        = 5;
export const SLEEP_END_HOUR_MAX        = 11;
export const ROUTINE_GAP_THRESHOLD     = 2;
export const ROUTINE_GAP_MAX_HOURS     = 16;
export const PAUSE_NEIGHBOURHOOD       = 1;

export const WARM_KEYWORDS     = ['sorry','guilty','babe','love','💕','❤️','haha','hey','sweet','dear','thanks','hug','miss','🥰','😘','😊','lol'];
export const CHILLING_KEYWORDS = ['chilling','relaxing','scrolling'];

export const SCORE = {
  TOXICITY_MIN: 2, TOXICITY_MAX: 10, TOXICITY_CHILLING_STEP: 1.5,
  CONFLICT_BASE: 70, CONFLICT_MAX: 95, CONFLICT_REPAIR_WEIGHT: 0.25,
  TEAMWORK_BASE: 75, TEAMWORK_MAX: 95, ASYMMETRY_STEP: 1.5, ASYMMETRY_CAP: 12,
  ACCOUNTABILITY_MIN: 75, ACCOUNTABILITY_MAX: 92, ACCOUNTABILITY_WEIGHT: 0.15,
  OVERALL_DIVISOR: 5,
  FALLBACK_WARMTH: 90, FALLBACK_RESOLUTION: 95, FALLBACK_SAFETY: 90, FALLBACK_DYNAMICS: 95, FALLBACK_TOXICITY: 3,
};

export function buildPacingNote({ names, metrics, minAcc, maxAcc }) {
  if (metrics.totalDelays === 0) return '';
  return `
PACING SIGNAL (pre-computed):
- ${metrics.totalDelays} reply gaps detected (excluding sleep/routine).
- ${names.asyncPartner} has more gaps but repairs ${metrics.repairPercentage}% of them with warmth.
- Target Accountability for ${names.asyncPartner}: ${minAcc}–${maxAcc}%.
- Locked metrics: Toxicity ${metrics.toxicity}%, Resolution ${metrics.conflictResolution}%, Dynamics ${metrics.teamwork}%.`.trim();
}

export function buildPersonaPrompt({ names, pacingNote }) {
  return `You are a behavioral psychologist. Analyze the chat and score both individuals. 
${pacingNote}
Return ONLY JSON:
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

export function buildDynamicsPrompt({ metrics, pacingNote }) {
  return `You are a relationship counselor. Use these exact locked scores:
${pacingNote}
Return ONLY JSON:
{
  "bond_positivity": "XX%", "bond_positivity_reason": "one phrase",
  "conflict_resolution": "${metrics.conflictResolution}%", "conflict_resolution_reason": "one sentence",
  "safety_trust": "XX%", "safety_trust_reason": "one sentence",
  "relationship_dynamics": "${metrics.teamwork}%", "relationship_dynamics_reason": "one sentence",
  "toxicity": "${metrics.toxicity}%", "toxicity_reason": "one sentence",
  "bond_strength_reason": "one sentence",
  "summary": "2-3 sentence overview of the relationship health."
}`;
}

export function buildStrategistPrompt({ names, personaData, dynamicsData }) {
  return `You are a coach. Write 2 actionable tips for each person based on:
Summary: ${dynamicsData.summary}
Profiles: ${JSON.stringify(personaData.profiles)}
Return ONLY JSON:
{
  "${names.consistentPartner}_actionables": ["tip 1", "tip 2"],
  "${names.asyncPartner}_actionables": ["tip 1", "tip 2"]
}`;
}

export const REQUIRED_DYNAMICS_KEYS = ['bond_positivity','conflict_resolution_reason','safety_trust','relationship_dynamics_reason','toxicity_reason','bond_strength_reason','summary'];
