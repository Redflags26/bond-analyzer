// ============================================================
//  analyze-engine.js
// ============================================================

import {
  OPENROUTER_MODEL, AGENT_TEMPERATURE,
  DELAY_MIN_HOURS, DELAY_MAX_HOURS,
  SLEEP_GAP_MAX_HOURS, SLEEP_START_HOUR_MIN, SLEEP_START_HOUR_MAX,
  SLEEP_END_HOUR_MIN, SLEEP_END_HOUR_MAX,
  ROUTINE_GAP_THRESHOLD, ROUTINE_GAP_MAX_HOURS, PAUSE_NEIGHBOURHOOD,
  WARM_KEYWORDS, CHILLING_KEYWORDS, SCORE,
} from './analyze-config.js';

// ── Helpers ──────────────────────────────────────────────────
export function stripEmojis(str) { /* unchanged */ }
export function safeJsonParse(str) { /* unchanged */ }
export function parsePercent(val, fallback) { /* unchanged */ }

// ── Timeline parser ──────────────────────────────────────────
export function calculateTimelineMetrics(text) {
  if (!text || typeof text !== 'string') return {
    enrichedText: '',
    metrics: { toxicity:50, conflictResolution:50, teamwork:50, repairPercentage:100, totalDelays:0 },
    names: { consistentPartner:'Person 1', asyncPartner:'Person 2' },
  };

  // ... parsing logic unchanged ...

  return {
    enrichedText: processedLines.join('\n'),
    metrics: {
      toxicity:           Math.min(Math.max(0, chilling * SCORE.TOXICITY_CHILLING_STEP), 100),
      conflictResolution: Math.min(Math.max(0, repairFactor * SCORE.CONFLICT_REPAIR_WEIGHT), 100),
      teamwork:           Math.min(Math.max(0, SCORE.TEAMWORK_MAX - asymmetry), 100),
      repairPercentage,
      totalDelays,
    },
    names: { consistentPartner:p1, asyncPartner:p2 },
  };
}

// ── Agent call wrapper ───────────────────────────────────────
export async function queryAgent(apiKey, systemPrompt, userContent) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method:'POST',
    headers:{ 'Authorization':`Bearer ${apiKey}`, 'Content-Type':'application/json' },
    body: JSON.stringify({
      model:OPENROUTER_MODEL,
      messages:[{ role:'system', content:systemPrompt }, { role:'user', content:userContent }],
      response_format:{ type:'json_object' },
      temperature:AGENT_TEMPERATURE,
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const body = await res.json();
  if (!body.choices?.[0]?.message) throw new Error('OpenRouter returned empty completion');
  return safeJsonParse(body.choices[0].message.content);
}
