/**
 * ============================================================
 * 1. MODEL & API SETTINGS
 * ============================================================
 */
export const OPENROUTER_MODEL  = 'openrouter/auto';
export const AGENT_TEMPERATURE = 0.1; // Low temp for consistent, analytical results

/**
 * ============================================================
 * 2. PARSER CONSTANTS (TIME & GAPS)
 * Define how pauses and sleep cycles are calculated.
 * ============================================================
 */
export const DELAY_MIN_HOURS           = 5;     // Threshold to consider a gap "significant"
export const DELAY_MAX_HOURS           = 2000;  // Safety cap for data errors
export const SLEEP_GAP_MAX_HOURS       = 14;    // Max length of a "sleep" transition
export const SLEEP_START_HOUR_MIN      = 21;    // 9 PM
export const SLEEP_START_HOUR_MAX      = 4;     // 4 AM
export const SLEEP_END_HOUR_MIN        = 5;     // 5 AM
export const SLEEP_END_HOUR_MAX        = 11;    // 11 AM
export const ROUTINE_GAP_THRESHOLD     = 2;     // Occurrences needed to label an hour "routine"
export const ROUTINE_GAP_MAX_HOURS     = 16;
export const PAUSE_NEIGHBOURHOOD       = 1;     // Padding around routine hours

/**
 * ============================================================
 * 3. CONTENT MARKERS
 * Keywords that signal emotional "repair" or casual "chilling".
 * ============================================================
 */
export const WARM_KEYWORDS     = ['sorry','guilty','babe','love','💕','❤️','haha','hey','sweet','dear','thanks','hug','miss','🥰','😘','😊','lol'];
export const CHILLING_KEYWORDS = ['chilling','relaxing','scrolling'];

/**
 * ============================================================
 * 4. SCORING WEIGHTS & FALLBACKS
 * Mathematical bounds for the deterministic metrics.
 * ============================================================
 */
export const SCORE = {
  TOXICITY_MIN: 2, 
  TOXICITY_MAX: 10, 
  TOXICITY_CHILLING_STEP: 1.5, // Increase toxicity per "chilling" delay

  CONFLICT_BASE: 70, 
  CONFLICT_MAX: 95, 
  CONFLICT_REPAIR_WEIGHT: 0.25, // How much "repair" helps the score

  TEAMWORK_BASE: 75, 
  TEAMWORK_MAX: 95, 
  ASYMMETRY_STEP: 1.5, 
  ASYMMETRY_CAP: 12,

  ACCOUNTABILITY_MIN: 75, 
  ACCOUNTABILITY_MAX: 92, 
  ACCOUNTABILITY_WEIGHT: 0.15,

  OVERALL_DIVISOR: 5, // Divides sum of 5 metrics to get percentage

  FALLBACK_WARMTH: 90, 
  FALLBACK_RESOLUTION: 95, 
  FALLBACK_SAFETY: 90, 
  FALLBACK_DYNAMICS: 95, 
  FALLBACK_TOXICITY: 3,
};

/**
 * ============================================================
 * 5. PROMPT BUILDERS
 * The instructions sent to the 3 LLM Agents.
 * ============================================================
 */

// Injects the pacing data into the System Prompts
export function buildPacingNote({ names, metrics, minAcc, maxAcc }) {
  if (metrics.totalDelays === 0) return '';
  return `
PACING SIGNAL (Pre-calculated):
- ${metrics.totalDelays} reply gaps detected outside of sleep/routine.
- ${names.asyncPartner} has more gaps but attempts repair ${metrics.repairPercentage}% of the time.
- Target Accountability for ${names.asyncPartner}: ${minAcc}–${maxAcc}%.
- Fixed Scores: Toxicity ${metrics.toxicity}%, Resolution ${metrics.conflictResolution}%, Dynamics ${metrics.teamwork}%.`.trim();
}

// Agent 1: Deep dive into individual behavior
export function buildPersonaPrompt({ names, pacingNote }) {
  return `You are a behavioral psychologist. Analyze the chat and score both individuals. 
${pacingNote}
Return ONLY JSON:
{
  "profiles": [
    {
      "name": "${names.consistentPartner}",
      "attachment_security": "XX%", "attachment_security_reason": "phrase",
      "emotional_regulation": "XX%", "emotional_regulation_reason": "sentence",
      "receptivity": "XX%", "receptivity_reason": "sentence",
      "accountability": "XX%", "accountability_reason": "sentence"
    },
    {
      "name": "${names.asyncPartner}",
      "attachment_security": "XX%", "attachment_security_reason": "phrase",
      "emotional_regulation": "XX%", "emotional_regulation_reason": "sentence",
      "receptivity": "XX%", "receptivity_reason": "sentence",
      "accountability": "XX%", "accountability_reason": "sentence"
    }
  ]
}`;
}

// Agent 2: High-level relationship health
export function buildDynamicsPrompt({ metrics, pacingNote }) {
  return `You are a relationship counselor. Use these exact scores:
${pacingNote}
Return ONLY JSON:
{
  "bond_positivity": "XX%", "bond_positivity_reason": "phrase",
  "conflict_resolution": "${metrics.conflictResolution}%", "conflict_resolution_reason": "sentence",
  "safety_trust": "XX%", "safety_trust_reason": "sentence",
  "relationship_dynamics": "${metrics.teamwork}%", "relationship_dynamics_reason": "sentence",
  "toxicity": "${metrics.toxicity}%", "toxicity_reason": "sentence",
  "bond_strength_reason": "sentence",
  "summary": "2-3 sentence overview."
}`;
}

// Agent 3: Actionable advice
export function buildStrategistPrompt({ names, personaData, dynamicsData }) {
  return `You are a coach. Write 2 tips per person based on:
Summary: ${dynamicsData.summary}
Profiles: ${JSON.stringify(personaData.profiles)}
Return ONLY JSON:
{
  "${names.consistentPartner}_actionables": ["tip 1", "tip 2"],
  "${names.asyncPartner}_actionables": ["tip 1", "tip 2"]
}`;
}

export const REQUIRED_DYNAMICS_KEYS = ['bond_positivity','conflict_resolution_reason','safety_trust','relationship_dynamics_reason','toxicity_reason','bond_strength_reason','summary'];
