// ============================================================
//  TRUVAH — ANALYZE CONFIG
//  All tunable constants and prompt templates.
// ============================================================

// ── Model ────────────────────────────────────────────────────
export const OPENROUTER_MODEL  = 'gemini-3.1-flash-lite';
export const AGENT_TEMPERATURE = 0.0;
export const AGENT_MAX_TOKENS  = 2500;

// ── Usage limit ───────────────────────────────────────────────
export const CHATS_PER_USER = 2; // max analyses allowed per access token

// Testing User
export const PRIMARY_USER_ID = '093236df-7fb5-46ba-9188-c511145689ec';

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

// ── Score constants (engine use only — never injected into prompts) ──
export const SCORE = {
  ASYMMETRY_STEP: 1.5,
  ASYMMETRY_CAP:  12,
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

// ── Agent 1: Combined Dynamics + Persona ─────────────────────
// Single call replacing the previous two separate agents.
export function buildAnalysisPrompt({ names, pacingNote }) {
  return `You are a relationship analysis expert combining the roles of Relationship Counselor and Behavioral Psychologist. You will be given an annotated chat conversation between two people: ${names.consistentPartner} and ${names.asyncPartner}.

IMPORTANT: Respond with a single JSON object only. The very first character of your response must be {. No markdown, no code fences, no explanation before or after.

The conversation may contain [Pause: Xh] annotations. These mark irregular reply gaps of 8+ hours — sleep and routine gaps have already been filtered out. The tag appears on the message that broke the silence, attributed to the person who replied late. Use them as a behavioural signal.
${pacingNote ? '\n' + pacingNote + '\n' : ''}
PART A — Relationship Dynamics. Evaluate the overall dynamic based on tone, language, emotional content, repair attempts, conflict patterns, and how each person shows up for the other.

PART B — Individual Profiles. Profile each person based on how they actually communicate — word choices, emotional tone, response to tension, engagement or disengagement.

Trait definitions for profiles:
- attachment_security: How secure and settled does this person seem? Do they seek reassurance, become anxious, or communicate with confidence?
- emotional_regulation: How well do they manage emotions during friction or silence? Do they escalate, withdraw, or stay steady?
- receptivity: How open are they to the other person's perspective? Do they listen, deflect, or shut down?
- accountability: When tension arises, do they acknowledge their part, deflect, or blame?

Scoring guide (apply to ALL percentage fields in both parts):
- 0–30%: severely concerning / struggling
- 31–55%: below average / inconsistent
- 56–74%: functional with room to grow
- 75–89%: healthy / strong
- 90–100%: exceptional

Rules for ALL _reason fields:
- Reference specific observed behaviours or exchanges from the conversation
- Write in plain human language
- Never mention scores, code, baselines, percentages, or internal methodology

Use EXACTLY these key names — no variations, no synonyms:

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
  "toxicity_reason": "...",
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

// ── Agent 2: Executive Strategist ────────────────────────────
export function buildStrategistPrompt({ names, analysisData }) {
  return `You are a Relationship Coach synthesising findings from a specialist analysis.

IMPORTANT: Respond with a single JSON object only. The very first character of your response must be {. No markdown, no code fences, no explanation before or after.

Analysis findings: ${JSON.stringify(analysisData)}

Your tasks:

ACTIONABLES: Provide 2 specific, practical tips for each person grounded in their actual behaviour in the chat. Avoid generic advice. Do not reference trait names, percentages, or scoring.

BOND STRENGTH: A single percentage reflecting the overall health and resilience of this relationship. Must be consistent with the analysis findings — if there is friction, it must show here. Do not mechanically average the scores.

BOND STRENGTH REASON:

Write a concise 3-5 sentence relationship synthesis that:

1. Identifies the core relationship pattern.
2. Explains why this pattern is creating tension, distance, or connection.
3. Reveals the deeper truth underneath the surface conflict.
4. Briefly describes what is likely to happen if the pattern continues unchanged.

The explanation should feel insightful and memorable, not clinical or generic.

Avoid:
- Repeating scores or percentages
- Listing personality traits
- Therapy jargon
- Generic advice
- Referring to the analysis itself

The reader should feel:
"I finally understand what's really happening here."

Where appropriate, include one concise, quotable insight that captures the essence of the relationship dynamic.

Maximum 90 words.

SUMMARY:

Generate a Truvah Identity Card for the partner with better average scores reflected in the profiles.

Choose EXACTLY ONE stone from:

- Moonstone
- Sunstone
- Onyx
- Emerald
- Sapphire
- Ruby
- Opal
- Diamond
- Amethyst
- Jade

Each stone has a fixed superpower:

Moonstone = Insight
Sunstone = Warmth
Onyx = Loyalty
Emerald = Belief
Sapphire = Wisdom
Ruby = Passion
Opal = Adaptability
Diamond = Integrity
Amethyst = Perspective
Jade = Stability

Return a SINGLE paragraph using EXACTLY this format:

"You're a [STONE] — [4-8 word persona description]. Your superpower is [FIXED SUPERPOWER]. [1-2 sentences describing how this strength shows up based on the conversation.] [1 sentence describing a likely blind spot/something to watch out in life while dealing with people.]"

Rules:

- Use only the listed stones.
- Use only the matching superpower.
- Maximum 80 words.
- Positive and aspirational.
- Based on actual conversation behaviour.
- No percentages.
- No psychology jargon.
- No references to analysis.
- No mention of scores.
- No mention of the other person.
Use EXACTLY these key names — no variations, no synonyms:

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

// ── Validation key maps ───────────────────────────────────────
// Primary keys expected from Agent 1 (combined analysis)
export const REQUIRED_ANALYSIS_KEYS = [
  'bond_positivity', 'bond_positivity_reason',
  'conflict_resolution', 'conflict_resolution_reason',
  'safety_trust', 'safety_trust_reason',
  'relationship_dynamics', 'relationship_dynamics_reason',
  'toxicity', 'toxicity_reason',
  'profiles',
];

// Primary keys expected from Agent 2 (strategist)
export const REQUIRED_STRATEGIST_KEYS = [
  'bond_strength',
  'summary',
  'actionables',
];

// ── Key alias map — fallbacks if model uses alternate names ──
// Format: canonical_key: [alias1, alias2, ...]
export const KEY_ALIASES = {
  bond_positivity:              ['bond_positivity_score', 'positivity', 'bond_score'],
  bond_positivity_reason:       ['positivity_reason', 'bond_positivity_explanation'],
  conflict_resolution:          ['conflict_resolution_score', 'conflict_score', 'resolution'],
  conflict_resolution_reason:   ['resolution_reason', 'conflict_reason', 'conflict_resolution_explanation'],
  safety_trust:                 ['safety_trust_score', 'trust', 'safety', 'trust_score'],
  safety_trust_reason:          ['trust_reason', 'safety_reason', 'safety_trust_explanation'],
  relationship_dynamics:        ['relationship_dynamics_score', 'dynamics', 'dynamics_score'],
  relationship_dynamics_reason: ['dynamics_reason', 'relationship_reason', 'relationship_dynamics_explanation'],
  toxicity:                     ['toxicity_score', 'toxic_score'],
  toxicity_reason:              ['toxic_reason', 'toxicity_explanation'],
  bond_strength:                ['bond_strength_score', 'strength', 'overall_bond'],
  bond_strength_reason:         ['strength_reason', 'bond_reason', 'bond_strength_explanation', 'overall_reason'],
  summary:                      ['overview', 'analysis_summary', 'relationship_summary'],
  actionables:                  ['action_items', 'tips', 'recommendations', 'actions'],
};
