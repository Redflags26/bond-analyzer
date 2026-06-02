// ============================================================
//  TRUVAH — ANALYZE CONFIG
//  All tunable constants and prompt templates.
// ============================================================

// ── Model ────────────────────────────────────────────────────
export const OPENROUTER_MODEL  = 'openrouter/auto';
export const AGENT_TEMPERATURE = 0.1;

// ── Parser thresholds ────────────────────────────────────────
export const DELAY_MIN_HOURS       = 8;    // gaps shorter than this are ignored
export const DELAY_MAX_HOURS       = 2000; // gaps longer than this are data errors
export const SLEEP_GAP_MAX_HOURS   = 14;
export const SLEEP_START_HOUR_MIN  = 21;   // 9 pm — considered "late night"
export const SLEEP_START_HOUR_MAX  = 4;    // 4 am — still "late night"
export const SLEEP_END_HOUR_MIN    = 5;    // 5 am — "morning" starts
export const SLEEP_END_HOUR_MAX    = 11;   // 11 am — "morning" ends
export const ROUTINE_GAP_THRESHOLD = 3;    // hour must recur ≥ this many times to be routine
export const ROUTINE_GAP_MAX_HOURS = 16;
export const PAUSE_NEIGHBOURHOOD   = 1;    // ±hours around a pause-start hour

// ── Keywords ─────────────────────────────────────────────────
export const WARM_KEYWORDS     = ['sorry','guilty','babe','love','💕','❤️','haha','hey','sweet','dear','thanks','hug','miss','🥰','😘','😊','lol'];
export const CHILLING_KEYWORDS = ['chilling','relaxing','scrolling'];

// ── Score constants ───────────────────────────────────────────
// Used only by the engine for fallback metrics and name resolution.
// Not injected into prompts.
export const SCORE = {
  TOXICITY_MIN:           2,
  TOXICITY_MAX:           99,
  TOXICITY_CHILLING_STEP: 1.5,

  CONFLICT_BASE:          50,
  CONFLICT_MAX:           99,
  CONFLICT_REPAIR_WEIGHT: 0.25,

  TEAMWORK_BASE:          50,
  TEAMWORK_MAX:           99,
  ASYMMETRY_STEP:         1.5,
  ASYMMETRY_CAP:          12,
};

// ── Pacing context — factual observations only, no score directives ──
export function buildPacingNote({ names, metrics }) {
  if (metrics.totalDelays === 0) return '';

  const repairDesc = metrics.repairPercentage >= 70
    ? 'most of the time'
    : metrics.repairPercentage >= 40
      ? 'about half the time'
      : 'rarely';

  return `
CONVERSATION STRUCTURE NOTE:
The chat has been pre-annotated with [Pause: Xh] tags. These mark reply gaps of 8+ hours that fall outside overnight sleep windows and recurring routine patterns — meaning they are genuinely irregular silences, not just someone sleeping or following a consistent daily schedule.
- ${metrics.totalDelays} such irregular gaps were found.
- ${names.asyncPartner} accounts for more of these gaps than ${names.consistentPartner}.
- After their gaps, ${names.asyncPartner} returns with warm or affectionate language ${repairDesc} (${metrics.repairPercentage}% of the time).
- Treat [Pause] tags as one contextual signal — weigh them alongside tone, content, and emotional exchanges in the conversation.`.trim();
}

// ── Agent 1: Relationship Dynamics (Macro) ──────────────────
export function buildDynamicsPrompt({ pacingNote }) {
  return `You are an experienced Relationship Counselor. You will be given an annotated chat conversation between two people.

Your task is to evaluate the overall relationship dynamic based solely on what is expressed in the conversation — the tone, language, emotional content, repair attempts, conflict patterns, and how each person shows up for the other.

The conversation may contain [Pause: Xh] annotations. These mark irregular reply gaps of 8+ hours (sleep and routine gaps have already been filtered out). Use them as a behavioural signal when relevant.
${pacingNote ? '\n' + pacingNote + '\n' : ''}
Scoring guide (apply to all percentage fields):
- 0–30%: severely concerning
- 31–55%: struggling / below average
- 56–74%: functional but with clear room for growth
- 75–89%: healthy with minor friction
- 90–100%: exceptional

Derive every score from what is actually present in the conversation. The _reason field must reference specific observed behaviours or exchanges — never reference scoring systems, code, baselines, or internal methodology.

Return ONLY valid JSON with no additional text:
{
  "bond_positivity": "XX%",
  "bond_positivity_reason": "...",
  "conflict_resolution": "XX%",
  "conflict_resolution_reason": "...",
  "safety_trust": "XX%",
  "safety_trust_reason": "...",
  "relationship_dynamics": "XX%",
  "relationship_dynamics_reason": "...",
  "toxicity": "XX%",
  "toxicity_reason": "..."
}`;
}

// ── Agent 2: Persona (Micro) ─────────────────────────────────
export function buildPersonaPrompt({ names, pacingNote }) {
  return `You are a Behavioral Psychologist specialising in relationship communication. You will be given an annotated chat conversation between two people: ${names.consistentPartner} and ${names.asyncPartner}.

Your task is to profile each individual based on how they actually communicate — their word choices, emotional tone, how they respond to tension, and how they engage or disengage.

The conversation may contain [Pause: Xh] annotations. These mark irregular reply gaps of 8+ hours (sleep and routine gaps have already been filtered out). The tag appears on the message that broke the silence, attributed to the person who replied late. Use them as a behavioural signal when assessing traits like accountability and emotional regulation.
${pacingNote ? '\n' + pacingNote + '\n' : ''}
Trait definitions:
- attachment_security: How secure and settled does this person seem? Do they seek reassurance, become anxious, or communicate with confidence?
- emotional_regulation: How well do they manage emotions during friction or silence? Do they escalate, withdraw, or stay steady?
- receptivity: How open are they to the other person's perspective? Do they listen, deflect, or shut down?
- accountability: When tension arises, do they acknowledge their part, deflect, or blame?

Scoring guide:
- 0–30%: severely struggling
- 31–55%: below average / inconsistent
- 56–74%: functional with room to grow
- 75–89%: strong
- 90–100%: exceptional

The _reason field must describe a specific behaviour or pattern from the conversation in plain human language. Never reference scores, code, baselines, or internal methodology.

Return ONLY valid JSON with no additional text:
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

// ── Agent 3: Executive Strategist (Synthesis & Summary) ──────
export function buildStrategistPrompt({ names, personaData, dynamicsData }) {
  return `You are a Relationship Coach synthesising findings from two specialist analyses alongside the original conversation.

Relationship Dynamics Analysis: ${JSON.stringify(dynamicsData)}
Individual Profiles: ${JSON.stringify(personaData)}

Your tasks:

SUMMARY: Write 2–3 sentences in a warm, direct tone. Describe what was happening emotionally in the conversation, what each person seemed to need, and one concrete thing they could do differently together. Write for the couple — no jargon, no references to scores or analysis methods.

ACTIONABLES: Provide 2 specific, practical tips for each person grounded in their actual behaviour in the chat. Avoid generic advice. Do not reference trait names, percentages, or scoring.

BOND STRENGTH: A single percentage reflecting the overall health and resilience of this relationship. Should be consistent with the dynamics and persona findings — if there is friction in the profiles, it must show here. Do not mechanically average the scores.

The bond_strength_reason must be 1–2 sentences of plain human language. No methodology references.

Return ONLY valid JSON with no additional text:
{
  "bond_strength": "XX%",
  "bond_strength_reason": "...",
  "summary": "...",
  "actionables": {
    "${names.consistentPartner}": ["Specific tip 1", "Specific tip 2"],
    "${names.asyncPartner}": ["Specific tip 1", "Specific tip 2"]
  }
}`;
}

// ── Validation keys ───────────────────────────────────────────
export const REQUIRED_DYNAMICS_KEYS = [
  'bond_positivity', 'bond_positivity_reason',
  'conflict_resolution', 'conflict_resolution_reason',
  'safety_trust', 'safety_trust_reason',
  'relationship_dynamics', 'relationship_dynamics_reason',
  'toxicity', 'toxicity_reason',
];

export const REQUIRED_STRATEGIST_KEYS = [
  'bond_strength',
  'bond_strength_reason',
  'summary',
  'actionables',
];
