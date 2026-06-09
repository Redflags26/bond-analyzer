// ============================================================
//  episode-extractor.js  v0.4
//
//  ARCHITECTURE:
//  One episode = one atomic unit of human behaviour:
//    actor + situation + trigger + action
//
//  Flow per conversation:
//    Step 1 — Label context (once, whole conversation)
//    Step 2 — Segment chat and label episodes per segment
//    Step 3 — Write all episodes to DB
//    Step 4 — Compute personas from episodes (A and B)
//             LLM scores markers once with full chat as context
//             Computed scores derived from episode distribution
//             Both stored on personas table
//    Step 5 — Write personas to DB (two rows per conversation)
//
//  Persona is NEVER stored on episodes.
//  Episodes join to personas via (conversation_id, actor).
//
//  Context is labelled once and PATCHed onto conversations row.
// ============================================================

import { OPENROUTER_MODEL, AGENT_TEMPERATURE } from './analyze-config.js';

const ONTOLOGY_VERSION = '0.4';

// ─────────────────────────────────────────────────────────────
//  ENUMS
// ─────────────────────────────────────────────────────────────

export const CONTEXTS = [
  'relationship_early',
  'relationship_established',
  'relationship_long_term',
  'family',
  'friendship',
  'workplace',
  'legal',
  'hiring',
  'other',
];

export const SITUATIONS = [
  'conflict',
  'trust_break',
  'boundary_setting',
  'vulnerability_share',
  'support_seeking',
  'reconnection',
  'jealousy',
  'decision_point',
  'distance',
  'routine',
];

export const TRIGGERS = [
  'criticism',
  'rejection',
  'unmet_need',
  'disrespect',
  'loss_of_control',
  'vulnerability_bid',
  'jealousy_activation',
  'uncertainty',
  'withdrawal',
  'none',
];

export const ACTIONS = [
  // Connection
  'validation',
  'reassurance',
  'self_disclosure',
  'curiosity',
  'affection',
  // Repair
  'accountability',
  'repair_attempt',
  'compromise',
  'clarification',
  'boundary_assertion',
  // Defensive
  'deflection',
  'withdrawal',
  'stonewalling',
  'minimization',
  'blame_shift',
  // Escalation
  'criticism',
  'escalation',
  'guilt_trip',
  'control_attempt',
  'contempt',
];

export const OUTCOMES = [
  'resolved',
  'partial_repair',
  'agreement',
  'understanding',
  'neutral',
  'unresolved',
  'withdrawn',
  'escalated',
  'stonewalled',
  'damaged',
];

// ─────────────────────────────────────────────────────────────
//  ACTION CLASSIFICATION MAPS
//  Used by computePersonaFromEpisodes to derive marker scores.
// ─────────────────────────────────────────────────────────────
const ACTION_GROUPS = {
  reactive:    ['escalation', 'guilt_trip', 'contempt', 'criticism'],
  open:        ['validation', 'curiosity', 'compromise', 'clarification'],
  accountable: ['accountability', 'repair_attempt'],
  direct:      ['self_disclosure', 'boundary_assertion'],
  vulnerable:  ['self_disclosure', 'affection'],
  controlling: ['control_attempt', 'stonewalling', 'blame_shift'],
  repair:      ['repair_attempt', 'accountability', 'compromise'],
  defensive:   ['deflection', 'withdrawal', 'stonewalling', 'minimization', 'blame_shift'],
};

const NEGATIVE_TRIGGERS = [
  'criticism', 'rejection', 'unmet_need', 'disrespect',
  'loss_of_control', 'uncertainty', 'withdrawal',
];

const REPAIR_SITUATIONS = ['conflict', 'trust_break', 'reconnection'];

// ─────────────────────────────────────────────────────────────
//  PROMPT 1 — Context label
// ─────────────────────────────────────────────────────────────
function buildContextPrompt() {
  return `You are a conversation analyst. Read the chat and identify the relationship context between the two speakers.

IMPORTANT: Respond with a single JSON object only. First character must be {. No markdown, no explanation.

Pick exactly one context value:
relationship_early       → together less than ~3 months
relationship_established → together ~3 months to 2 years
relationship_long_term   → together 2+ years
family                   → familial relationship
friendship               → platonic friendship
workplace                → professional / colleague relationship
legal                    → legal or formal dispute context
hiring                   → recruitment or employment context
other                    → none of the above

{
  "context": "<value>",
  "confidence": "<0.0–1.0>",
  "reasoning": "<one sentence>"
}`;
}

// ─────────────────────────────────────────────────────────────
//  PROMPT 2 — Episode labelling (per segment)
// ─────────────────────────────────────────────────────────────
function buildEpisodePrompt(speakerA, speakerB, context) {
  return `You are a behavioural analyst labelling a chat conversation between ${speakerA} (A) and ${speakerB} (B).

IMPORTANT: Respond with a single JSON object only. First character must be {. No markdown, no explanation.

Context: ${context}

[Pause: Xh] tags mark irregular reply gaps of 8+ hours. Treat as a withdrawal signal for the silent period.

Each message or group of messages from one actor is ONE EPISODE.
An episode has exactly three labels:

SITUATION — what is this actor responding to?
conflict | trust_break | boundary_setting | vulnerability_share | support_seeking | reconnection | jealousy | decision_point | distance | routine

TRIGGER — what specifically moved them to act?
criticism | rejection | unmet_need | disrespect | loss_of_control | vulnerability_bid | jealousy_activation | uncertainty | withdrawal | none

ACTION — what did they do?
Connection:  validation | reassurance | self_disclosure | curiosity | affection
Repair:      accountability | repair_attempt | compromise | clarification | boundary_assertion
Defensive:   deflection | withdrawal | stonewalling | minimization | blame_shift
Escalation:  criticism | escalation | guilt_trip | control_attempt | contempt

OUTCOME — only on the last episode of a discussion thread:
resolved | partial_repair | agreement | understanding | neutral | unresolved | withdrawn | escalated | stonewalled | damaged

{
  "episodes": [
    {
      "actor":      "A or B",
      "situation":  "<value>",
      "trigger":    "<value>",
      "action":     "<value>",
      "confidence": "<0.0–1.0>",
      "outcome":    null
    }
  ]
}`;
}

// ─────────────────────────────────────────────────────────────
//  PROMPT 3 — LLM persona marker scoring (once per conversation)
//
//  Receives the full enriched chat and the actor's name.
//  Scores all 8 markers 0–100.
//  Also extracts basic demographics if present.
// ─────────────────────────────────────────────────────────────
function buildPersonaPrompt(actorName, partnerName) {
  return `You are a behavioural psychologist. Read the entire conversation and score ${actorName}'s behaviour on the 8 markers below.

IMPORTANT: Respond with a single JSON object only. First character must be {. No markdown, no explanation.

Score each marker 0–100 based only on what ${actorName} says and does in this conversation.
0 = extremely low, 50 = neutral/moderate, 100 = extremely high.

Markers:
emotional_reactivity  — how strongly they react to triggers (0=calm, 100=explosive)
openness              — receptivity to partner's perspective (0=dismissive, 100=genuinely open)
accountability        — owns their part vs deflects blame (0=always deflects, 100=fully owns)
directness            — says what they mean (0=indirect/passive, 100=very direct)
vulnerability         — willingness to expose real needs (0=defended, 100=fully open)
control_tendency      — tries to manage partner/situation (0=none, 100=high control)
repair_orientation    — moves toward resolution (0=avoids, 100=actively repairs)
consistency           — stable tone/position under pressure (0=shifts constantly, 100=very stable)

Also extract demographics if explicitly stated in the chat (e.g. "I'm 24F"):
sex: M, F, or null
age: integer or null

{
  "sex": null,
  "age": null,
  "markers": {
    "emotional_reactivity": 0,
    "openness": 0,
    "accountability": 0,
    "directness": 0,
    "vulnerability": 0,
    "control_tendency": 0,
    "repair_orientation": 0,
    "consistency": 0
  },
  "confidence": "<0.0–1.0 — how much signal this chat gave you for this person>"
}`;
}

// ─────────────────────────────────────────────────────────────
//  SEGMENTATION
// ─────────────────────────────────────────────────────────────
function segmentChat(enrichedText, minLines = 3) {
  const lines    = enrichedText.split('\n').filter(l => l.trim());
  const segments = [];
  let   current  = [];

  for (const line of lines) {
    const hasPause = /\[Pause:\s*\d+h\]/i.test(line);
    if (hasPause && current.length >= minLines) {
      segments.push(current.join('\n'));
      current = [line];
      continue;
    }
    current.push(line);
  }
  if (current.length >= minLines) segments.push(current.join('\n'));
  if (segments.length === 0 && lines.length >= minLines) {
    segments.push(lines.join('\n'));
  }
  return segments;
}

// ─────────────────────────────────────────────────────────────
//  VALIDATION
// ─────────────────────────────────────────────────────────────
function validateContext(raw) {
  if (!CONTEXTS.includes(raw?.context)) {
    return { context: 'other', confidence: 0, reasoning: '' };
  }
  return {
    context:    raw.context,
    confidence: Math.min(1, Math.max(0, Number(raw.confidence) || 0)),
    reasoning:  raw.reasoning || '',
  };
}

function validateEpisodes(raw, segmentIndex) {
  if (!Array.isArray(raw?.episodes)) return [];
  return raw.episodes
    .map((ep, i) => {
      const actor     = ['A', 'B'].includes(ep.actor)     ? ep.actor     : null;
      const situation = SITUATIONS.includes(ep.situation) ? ep.situation : null;
      const trigger   = TRIGGERS.includes(ep.trigger)     ? ep.trigger   : null;
      const action    = ACTIONS.includes(ep.action)       ? ep.action    : null;
      const outcome   = OUTCOMES.includes(ep.outcome)     ? ep.outcome   : null;
      const conf      = Math.min(1, Math.max(0, Number(ep.confidence) || 0));
      if (!actor || !situation || !trigger || !action) return null;
      return { actor, situation, trigger, action, confidence: conf, outcome, segment_index: segmentIndex, sequence_index: i };
    })
    .filter(Boolean);
}

function validateLlmMarkers(raw) {
  const MARKER_KEYS = [
    'emotional_reactivity', 'openness', 'accountability', 'directness',
    'vulnerability', 'control_tendency', 'repair_orientation', 'consistency',
  ];
  const markers = {};
  for (const key of MARKER_KEYS) {
    const val = Number(raw?.markers?.[key]);
    markers[key] = isNaN(val) ? 50 : Math.min(100, Math.max(0, val));
  }
  return {
    sex:        ['M', 'F'].includes(raw?.sex) ? raw.sex : null,
    age:        Number.isInteger(raw?.age) && raw.age > 10 && raw.age < 100 ? raw.age : null,
    markers,
    confidence: Math.min(1, Math.max(0, Number(raw?.confidence) || 0)),
  };
}

// ─────────────────────────────────────────────────────────────
//  COMPUTED PERSONA
//  Derives marker scores and archetype from episode distribution.
//  No LLM involved — pure analytics from stored episodes.
// ─────────────────────────────────────────────────────────────
function computePersonaFromEpisodes(episodes) {
  const total = episodes.length;
  if (total === 0) return null;

  // Action distribution: proportion of each action across all episodes
  const actionCounts = {};
  for (const ep of episodes) {
    actionCounts[ep.action] = (actionCounts[ep.action] || 0) + 1;
  }
  const action_distribution = {};
  for (const [action, count] of Object.entries(actionCounts)) {
    action_distribution[action] = parseFloat((count / total).toFixed(3));
  }

  // Helper: ratio of episodes where actor's action is in a group
  const ratio = (group) => {
    const count = episodes.filter(ep => ACTION_GROUPS[group].includes(ep.action)).length;
    return count / total;
  };

  // Computed markers (0–100, derived from action ratios)
  const calc_markers = {
    emotional_reactivity: Math.round(ratio('reactive')    * 100),
    openness:             Math.round(ratio('open')        * 100),
    accountability:       Math.round(ratio('accountable') * 100),
    directness:           Math.round(ratio('direct')      * 100),
    vulnerability:        Math.round(ratio('vulnerable')  * 100),
    control_tendency:     Math.round(ratio('controlling') * 100),
    // repair_orientation: repair actions specifically under repair-relevant situations
    repair_orientation:   Math.round(
      (() => {
        const repairOps = episodes.filter(ep => REPAIR_SITUATIONS.includes(ep.situation));
        if (repairOps.length === 0) return 0;
        return repairOps.filter(ep => ACTION_GROUPS.repair.includes(ep.action)).length / repairOps.length;
      })() * 100
    ),
    // consistency: how varied their actions are (low variety = high consistency)
    consistency: Math.round(
      (() => {
        const uniqueActions = new Set(episodes.map(ep => ep.action)).size;
        // More unique actions relative to total = less consistent
        const variety = uniqueActions / Math.min(total, ACTIONS.length);
        return (1 - variety) * 100;
      })()
    ),
  };

  // Conditional map: { "conflict+criticism": { "deflection": 0.6, ... } }
  const condMap = {};
  for (const ep of episodes) {
    const key = `${ep.situation}+${ep.trigger}`;
    if (!condMap[key]) condMap[key] = {};
    condMap[key][ep.action] = (condMap[key][ep.action] || 0) + 1;
  }
  const conditional_map = {};
  for (const [key, counts] of Object.entries(condMap)) {
    const keyTotal = Object.values(counts).reduce((a, b) => a + b, 0);
    conditional_map[key] = {};
    for (const [action, count] of Object.entries(counts)) {
      conditional_map[key][action] = parseFloat((count / keyTotal).toFixed(3));
    }
  }

  // Dominant defence: most common action under negative triggers
  const defenceEps = episodes.filter(ep => NEGATIVE_TRIGGERS.includes(ep.trigger));
  const defenceCounts = {};
  for (const ep of defenceEps) {
    defenceCounts[ep.action] = (defenceCounts[ep.action] || 0) + 1;
  }
  const dominant_defense = Object.keys(defenceCounts).sort(
    (a, b) => defenceCounts[b] - defenceCounts[a]
  )[0] || null;

  // Dominant repair: most common repair action
  const repairEps = episodes.filter(ep => ACTION_GROUPS.repair.includes(ep.action));
  const repairCounts = {};
  for (const ep of repairEps) {
    repairCounts[ep.action] = (repairCounts[ep.action] || 0) + 1;
  }
  const dominant_repair = Object.keys(repairCounts).sort(
    (a, b) => repairCounts[b] - repairCounts[a]
  )[0] || null;

  // Top trigger: most common trigger this actor responded to
  const triggerCounts = {};
  for (const ep of episodes) {
    if (ep.trigger !== 'none') {
      triggerCounts[ep.trigger] = (triggerCounts[ep.trigger] || 0) + 1;
    }
  }
  const top_trigger = Object.keys(triggerCounts).sort(
    (a, b) => triggerCounts[b] - triggerCounts[a]
  )[0] || null;

  // Attachment archetype: derived from marker profile
  // Rules (simplified — will improve as data grows):
  //   secure:       high repair_orientation + high openness + low emotional_reactivity
  //   anxious:      high emotional_reactivity + high repair_orientation (but inconsistent)
  //   avoidant:     high withdrawal/deflection + low repair_orientation + low vulnerability
  //   disorganized: high reactivity + high control + low consistency
  const { emotional_reactivity, openness, repair_orientation, control_tendency, consistency } = calc_markers;
  const defenseRatio = ratio('defensive');

  let attachment_archetype = 'unknown';
  let archetype_confidence = 0.4;

  if (repair_orientation >= 50 && openness >= 50 && emotional_reactivity <= 40) {
    attachment_archetype = 'secure';
    archetype_confidence = 0.7;
  } else if (emotional_reactivity >= 55 && repair_orientation >= 40 && defenseRatio < 0.4) {
    attachment_archetype = 'anxious';
    archetype_confidence = 0.65;
  } else if (defenseRatio >= 0.4 && repair_orientation <= 40) {
    attachment_archetype = 'avoidant';
    archetype_confidence = 0.65;
  } else if (emotional_reactivity >= 60 && control_tendency >= 50 && consistency <= 40) {
    attachment_archetype = 'disorganized';
    archetype_confidence = 0.6;
  }

  return {
    calc_markers,
    action_distribution,
    conditional_map,
    dominant_defense,
    dominant_repair,
    top_trigger,
    attachment_archetype,
    archetype_confidence,
  };
}

// ─────────────────────────────────────────────────────────────
//  LLM CALL
// ─────────────────────────────────────────────────────────────
async function callLLM(apiKey, systemPrompt, userContent, maxTokens = 1600) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:           OPENROUTER_MODEL,
      max_tokens:      maxTokens,
      temperature:     AGENT_TEMPERATURE,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userContent  },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const body    = await res.json();
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty LLM response');
  const first = content.indexOf('{');
  const last  = content.lastIndexOf('}');
  if (first === -1 || last === -1) throw new Error('No JSON in response');
  return JSON.parse(content.substring(first, last + 1));
}

// ─────────────────────────────────────────────────────────────
//  SUPABASE HELPERS
// ─────────────────────────────────────────────────────────────
async function supabaseInsert(url, key, table, payload) {
  if (Array.isArray(payload) && payload.length === 0) return [];
  const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${table}`, {
    method:  'POST',
    headers: {
      'apikey':        key,
      'Authorization': `Bearer ${key}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=representation',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Supabase ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function supabasePatch(url, key, table, filter, payload) {
  const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${table}?${filter}`, {
    method:  'PATCH',
    headers: {
      'apikey':        key,
      'Authorization': `Bearer ${key}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=minimal',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Supabase PATCH ${table}: ${res.status} ${detail}`);
  }
}

// ─────────────────────────────────────────────────────────────
//  MAIN EXPORT
// ─────────────────────────────────────────────────────────────
export async function extractAndStoreEpisodes({
  apiKey,
  supabaseUrl,
  supabaseKey,
  conversationId,
  enrichedText,
  names,
}) {
  const speakerA = names.consistentPartner;
  const speakerB = names.asyncPartner;
  const results  = { context: null, episodes: 0, personas: 0, errors: [] };

  // ── Step 1: Label context ─────────────────────────────────
  let context = 'other';
  try {
    const raw       = await callLLM(apiKey, buildContextPrompt(), enrichedText, 300);
    const validated = validateContext(raw);
    context         = validated.context;

    await supabasePatch(
      supabaseUrl, supabaseKey,
      'conversations',
      `id=eq.${conversationId}`,
      { context: validated.context, context_conf: validated.confidence },
    );
    results.context = context;
  } catch (err) {
    console.error('Context labelling failed:', err.message);
    results.errors.push({ stage: 'context', error: err.message });
  }

  // ── Step 2: Segment and label episodes ───────────────────
  const segments    = segmentChat(enrichedText);
  const allEpisodes = [];

  for (let i = 0; i < segments.length; i++) {
    try {
      const raw      = await callLLM(
        apiKey,
        buildEpisodePrompt(speakerA, speakerB, context),
        segments[i],
        1600,
      );
      const episodes = validateEpisodes(raw, i);
      allEpisodes.push(...episodes);
    } catch (err) {
      console.error(`Segment ${i} labelling failed:`, err.message);
      results.errors.push({ stage: `segment_${i}`, error: err.message });
    }
  }

  // ── Step 3: Write episodes ────────────────────────────────
  if (allEpisodes.length > 0) {
    const rows = allEpisodes.map((ep, globalIndex) => ({
      conversation_id:  conversationId,
      ontology_version: ONTOLOGY_VERSION,
      context,
      global_index:     globalIndex,
      segment_index:    ep.segment_index,
      actor:            ep.actor,
      actor_name:       ep.actor === 'A' ? speakerA : speakerB,
      situation:        ep.situation,
      trigger:          ep.trigger,
      action:           ep.action,
      confidence:       ep.confidence,
      outcome:          ep.outcome,
      is_thread_end:    ep.outcome !== null,
    }));

    try {
      await supabaseInsert(supabaseUrl, supabaseKey, 'episodes', rows);
      results.episodes = rows.length;
    } catch (err) {
      console.error('Episode batch write failed:', err.message);
      results.errors.push({ stage: 'db_write_episodes', error: err.message });
    }
  }

  // ── Step 4: Compute and store personas ───────────────────
  // Run both actors in parallel — independent LLM calls + computation.
  const personaResults = await Promise.allSettled([
    buildAndStorePersona('A', speakerA),
    buildAndStorePersona('B', speakerB),
  ]);

  for (const result of personaResults) {
    if (result.status === 'fulfilled') {
      results.personas++;
    } else {
      console.error('Persona build failed:', result.reason?.message);
      results.errors.push({ stage: 'persona', error: result.reason?.message });
    }
  }

  return results;

  // ── Inner: build one persona and write to DB ─────────────
  async function buildAndStorePersona(actor, actorName) {
    // LLM scores markers with full chat as context
    const rawLlm    = await callLLM(apiKey, buildPersonaPrompt(actorName, actor === 'A' ? speakerB : speakerA), enrichedText, 600);
    const llmResult = validateLlmMarkers(rawLlm);

    // Computed scores from this actor's episodes (confidence >= 0.5 only)
    const actorEpisodes = allEpisodes.filter(ep => ep.actor === actor && ep.confidence >= 0.5);
    const computed      = computePersonaFromEpisodes(actorEpisodes);

    const personaRow = {
      conversation_id:      conversationId,
      actor,
      actor_name:           actorName,

      // Demographics (LLM extracted)
      sex:                  llmResult.sex,
      age:                  llmResult.age,

      // Archetype from computed (more reliable than LLM direct assertion)
      attachment_archetype: computed?.attachment_archetype ?? 'unknown',
      archetype_confidence: computed?.archetype_confidence ?? 0,

      // Episode stats
      episode_count:        actorEpisodes.length,

      // Distributions (computed)
      action_distribution:  computed?.action_distribution  ?? null,
      conditional_map:      computed?.conditional_map      ?? null,

      // Dominant patterns (computed)
      dominant_defense:     computed?.dominant_defense     ?? null,
      dominant_repair:      computed?.dominant_repair      ?? null,
      top_trigger:          computed?.top_trigger          ?? null,

      // Repair receptivity: when partner did repair_attempt,
      // how often did this actor respond with a connection/repair action?
      repair_receptivity: (() => {
        const partnerActor   = actor === 'A' ? 'B' : 'A';
        const partnerRepairs = allEpisodes
          .filter(ep => ep.actor === partnerActor && ep.action === 'repair_attempt')
          .map(ep => ep.sequence_index);

        if (partnerRepairs.length === 0) return null;

        // Find this actor's episode immediately after each partner repair
        const POSITIVE_RESPONSES = [...ACTION_GROUPS.open, ...ACTION_GROUPS.repair, ...ACTION_GROUPS.vulnerable];
        let positiveCount = 0;
        for (const repairIdx of partnerRepairs) {
          const response = allEpisodes.find(
            ep => ep.actor === actor && ep.sequence_index > repairIdx
          );
          if (response && POSITIVE_RESPONSES.includes(response.action)) positiveCount++;
        }
        return parseFloat((positiveCount / partnerRepairs.length).toFixed(3));
      })(),

      // Marker scores — both stored
      llm_markers:  llmResult.markers,
      calc_markers: computed?.calc_markers ?? null,
    };

    await supabaseInsert(supabaseUrl, supabaseKey, 'personas', personaRow);
  }
}
