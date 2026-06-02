// ============================================================
//  analyze-engine.js
//  Pure logic — no HTTP, no env vars.
// ============================================================

import {
  OPENROUTER_MODEL, AGENT_TEMPERATURE,
  DELAY_MIN_HOURS, DELAY_MAX_HOURS,
  SLEEP_GAP_MAX_HOURS, SLEEP_START_HOUR_MIN, SLEEP_START_HOUR_MAX,
  SLEEP_END_HOUR_MIN, SLEEP_END_HOUR_MAX,
  ROUTINE_GAP_THRESHOLD, ROUTINE_GAP_MAX_HOURS, PAUSE_NEIGHBOURHOOD,
  WARM_KEYWORDS, CHILLING_KEYWORDS, SCORE,
} from './analyze-config.js';

// ── Strip emojis from speaker names ──────────────────────────
export function stripEmojis(str) {
  if (!str) return '';
  return str
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '') // covers all emoji ranges incl. surrogate pairs
    .replace(/[\u2000-\u27FF\uE000-\uF8FF]/g, '')
    .replace(/\s+/g, ' ').trim();
}

// ── Parse JSON that may have code-fence wrapping ──────────────
export function safeJsonParse(str) {
  if (!str) throw new Error('empty response');
  const s = str.trim().replace(/^```json|^```|```$/g, '').trim();
  return JSON.parse(s);
}

// ── Parse a percentage value safely ──────────────────────────
export function parsePercent(val, fallback = 69) {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const n = parseInt(val, 10);
    return isNaN(n) ? fallback : n;
  }
  return fallback;
}

// ── Timeline parser ───────────────────────────────────────────
export function calculateTimelineMetrics(text) {
  if (!text || typeof text !== 'string') return {
    enrichedText: '',
    metrics: { repairPercentage: 100, totalDelays: 0 },
    names: { consistentPartner: 'Person 1', asyncPartner: 'Person 2' },
  };

  const linePattern = /^\[?(\d{1,4}[:\/\-.]\d{1,4}(?:[:\/\-.]\d{2,4})?),\s*([^\]\-]+)\]?\s*(?:-\s*)?([^:]+):\s*(.*)$/i;
  const timePattern = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?/i;

  const speakers        = new Set();
  const speakerDelays   = {};
  const speakerChilling = {};
  const pauseStartHours = [];
  const processedLines  = [];
  const msgs            = [];

  let lastTs = null;
  let totalDelays = 0, warmRepairCount = 0;

  // PASS 1 — parse timestamps and collect pause start hours
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\u200e|\u202f/g, ' ').trim();
    if (!line) continue;
    const match = linePattern.exec(line);
    if (!match) { msgs.push({ line, ts: null }); continue; }

    try {
      const dp = match[1].split(/[:\/\-.]/);
      let day = parseInt(dp[0], 10), month = parseInt(dp[1], 10) - 1;
      let year = dp[2] ? parseInt(dp[2], 10) : new Date().getFullYear();
      if (dp[2] && day > 1000) [day, year] = [year, day];
      if (year < 100) year += 2000;

      const tm = timePattern.exec(match[2].trim());
      let h = 0, m = 0, s = 0;
      if (tm) {
        h = parseInt(tm[1], 10); m = parseInt(tm[2], 10); s = tm[3] ? parseInt(tm[3], 10) : 0;
        if (tm[4]?.toLowerCase() === 'pm' && h < 12) h += 12;
        if (tm[4]?.toLowerCase() === 'am' && h === 12) h = 0;
      }

      const ts      = new Date(year, month, day, h, m, s).getTime();
      const speaker = stripEmojis(match[3].trim()) || 'Unknown';
      const content = match[4].trim();
      if (!ts) throw new Error('bad ts');

      speakers.add(speaker);

      if (lastTs) {
        const dH = (ts - lastTs) / 3600000;
        if (dH >= DELAY_MIN_HOURS && dH < DELAY_MAX_HOURS) {
          pauseStartHours.push(new Date(lastTs).getHours());
        }
      }

      msgs.push({ line, ts, speaker, content, match });
      lastTs = ts;
    } catch {
      msgs.push({ line, ts: null });
    }
  }

  // Build routine-hour map
  const routineMap = new Uint8Array(24);
  for (const ph of pauseStartHours) {
    for (let d = -PAUSE_NEIGHBOURHOOD; d <= PAUSE_NEIGHBOURHOOD; d++) {
      routineMap[(ph + d + 24) % 24]++;
    }
  }

  // PASS 2 — annotate irregular delays and reconstruct lines
  lastTs = null;
  for (const msg of msgs) {
    if (!msg.ts) { processedLines.push(msg.line); continue; }

    const { ts, speaker, content, match } = msg;
    let delayTag = '';

    if (lastTs) {
      const dH       = (ts - lastTs) / 3600000;
      const prevH    = new Date(lastTs).getHours();
      const curDate  = new Date(ts);
      const prevDate = new Date(lastTs);

      if (dH >= DELAY_MIN_HOURS && dH < DELAY_MAX_HOURS) {
        const isSleep = (
          dH <= SLEEP_GAP_MAX_HOURS &&
          (prevH >= SLEEP_START_HOUR_MIN || prevH <= SLEEP_START_HOUR_MAX) &&
          curDate.getHours() >= SLEEP_END_HOUR_MIN &&
          curDate.getHours() <= SLEEP_END_HOUR_MAX &&
          prevDate.getDate() !== curDate.getDate()
        );
        const isRoutine = routineMap[prevH] >= ROUTINE_GAP_THRESHOLD && dH <= ROUTINE_GAP_MAX_HOURS;

        if (!isSleep && !isRoutine) {
          totalDelays++;
          speakerDelays[speaker] = (speakerDelays[speaker] || 0) + 1;
          const lower = content.toLowerCase();
          if (WARM_KEYWORDS.some(kw     => lower.includes(kw))) warmRepairCount++;
          if (CHILLING_KEYWORDS.some(kw => lower.includes(kw))) {
            speakerChilling[speaker] = (speakerChilling[speaker] || 0) + 1;
          }
          delayTag = ` [Pause: ${Math.round(dH)}h]`;
        }
      }
    }

    const dp      = match[1].split(/[:\/\-.]/);
    const dateStr = dp[2] ? `${dp[0]}/${dp[1]}/${dp[2]}` : `${dp[0]}/${dp[1]}`;
    processedLines.push(`[${dateStr}, ${match[2].trim()}]${delayTag} ${speaker}: ${content}`);
    lastTs = ts;
  }

  // Resolve consistent vs async partner
  let [p1, p2] = Array.from(speakers);
  p1 = p1 || 'Person 1'; p2 = p2 || 'Person 2';
  if ((speakerDelays[p1] || 0) > (speakerDelays[p2] || 0)) [p1, p2] = [p2, p1];

  const repairFactor = totalDelays > 0 ? Math.round((warmRepairCount / totalDelays) * 100) : 100;

  return {
    enrichedText: processedLines.join('\n'),
    metrics: {
      repairPercentage: repairFactor,
      totalDelays,
    },
    names: { consistentPartner: p1, asyncPartner: p2 },
  };
}

// ── Call one LLM agent ────────────────────────────────────────
export async function queryAgent(apiKey, systemPrompt, userContent) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:           OPENROUTER_MODEL,
      messages:        [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
      response_format: { type: 'json_object' },
      temperature:     AGENT_TEMPERATURE,
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const body = await res.json();
  if (!body.choices?.[0]?.message) throw new Error('OpenRouter returned empty completion');
  return safeJsonParse(body.choices[0].message.content);
}
