// ============================================================
//  TRUVAH — ANALYZE HANDLER
// ============================================================

import {
  OPENROUTER_MODEL, AGENT_TEMPERATURE,
  DELAY_MIN_HOURS, DELAY_MAX_HOURS,
  SLEEP_GAP_MAX_HOURS, SLEEP_START_HOUR_MIN, SLEEP_START_HOUR_MAX,
  SLEEP_END_HOUR_MIN, SLEEP_END_HOUR_MAX,
  ROUTINE_GAP_THRESHOLD, ROUTINE_GAP_MAX_HOURS, PAUSE_NEIGHBOURHOOD,
  WARM_KEYWORDS, CHILLING_KEYWORDS, SCORE,
  REQUIRED_DYNAMICS_KEYS,
  buildPacingNote, buildPersonaPrompt, buildDynamicsPrompt, buildStrategistPrompt,
} from './analyze-config.js';

// ── Strip emojis from speaker names ──────────────────────────
function stripEmojis(str) {
  if (!str) return '';
  return str
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[\u2000-\u27FF\uE000-\uF8FF]/g, '')
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
    .replace(/\s+/g, ' ').trim();
}

// ── Parse JSON that may have code-fence wrapping ──────────────
function safeJsonParse(str) {
  if (!str) throw new Error('empty response');
  let s = str.trim().replace(/^```json|^```|```$/g, '').trim();
  return JSON.parse(s);
}

// ── Parse a percentage value safely ──────────────────────────
function parsePercent(val, fallback) {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const n = parseInt(val, 10);
    return isNaN(n) ? fallback : n;
  }
  return fallback;
}

// ── Timeline parser (single pass) ────────────────────────────
function calculateTimelineMetrics(text) {
  if (!text || typeof text !== 'string') return {
    enrichedText: '',
    metrics: { toxicity: SCORE.FALLBACK_TOXICITY, conflictResolution: SCORE.FALLBACK_RESOLUTION, teamwork: SCORE.FALLBACK_DYNAMICS, repairPercentage: 100, totalDelays: 0 },
    names: { consistentPartner: 'Person 1', asyncPartner: 'Person 2' },
  };

  const linePattern = /^\[?(\d{1,4}[:\/\-.]\d{1,4}(?:[:\/\-.]\d{2,4})?),\s*([^\]\-]+)\]?\s*(?:-\s*)?([^:]+):\s*(.*)$/i;
  const timePattern = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?/i;

  const speakers         = new Set();
  const speakerDelays    = {};
  const speakerChilling  = {};
  const pauseStartHours  = [];
  const processedLines   = [];

  // Running min/max to avoid Math.min/max spread over large arrays
  let minTs = Infinity, maxTs = -Infinity;
  let lastTs = null, lastH = null, lastDate = null;
  let totalDelays = 0, warmRepairCount = 0;

  // We need a routine map before annotating — collect all timestamps first
  // but build it inline: first scan for pause hours, then annotate.
  // To stay single-array, we store compact objects only when needed.
  const msgs = [];

  for (const raw of text.split('\n')) {
    const line  = raw.replace(/\u200e|\u202f/g, ' ').trim();
    if (!line) continue;
    const match = linePattern.exec(line);
    if (!match) { msgs.push({ line, ts: null }); continue; }

    try {
      const dp = match[1].split(/[:\/\-.]/);
      let day = parseInt(dp[0], 10), month = parseInt(dp[1], 10) - 1;
      let year = dp[2] ? parseInt(dp[2], 10) : new Date().getFullYear();
      if (dp[2] && day > 1000) { [day, year] = [year, day]; }
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
      if (ts < minTs) minTs = ts;
      if (ts > maxTs) maxTs = ts;

      // Collect pause start hours for routine map (pre-annotation)
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

  // Annotate delays and reconstruct lines
  lastTs = null;
  for (const msg of msgs) {
    if (!msg.ts) { processedLines.push(msg.line); continue; }

    const { ts, speaker, content, match } = msg;
    let delayTag = '';

    if (lastTs) {
      const dH      = (ts - lastTs) / 3600000;
      const prevH   = new Date(lastTs).getHours();
      const curDate = new Date(ts);
      const prevDate= new Date(lastTs);

      if (dH >= DELAY_MIN_HOURS && dH < DELAY_MAX_HOURS) {
        const isSleep = (
          dH <= SLEEP_GAP_MAX_HOURS &&
          (prevH >= SLEEP_START_HOUR_MIN || prevH <= SLEEP_START_HOUR_MAX) &&
          (curDate.getHours() >= SLEEP_END_HOUR_MIN && curDate.getHours() <= SLEEP_END_HOUR_MAX) &&
          prevDate.getDate() !== curDate.getDate()
        );
        const isRoutine = routineMap[prevH] >= ROUTINE_GAP_THRESHOLD && dH <= ROUTINE_GAP_MAX_HOURS;

        if (!isSleep && !isRoutine) {
          totalDelays++;
          speakerDelays[speaker]   = (speakerDelays[speaker]   || 0) + 1;
          const lower = content.toLowerCase();
          if (WARM_KEYWORDS.some(kw => lower.includes(kw)))     warmRepairCount++;
          if (CHILLING_KEYWORDS.some(kw => lower.includes(kw))) speakerChilling[speaker] = (speakerChilling[speaker] || 0) + 1;
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

  const chilling     = speakerChilling[p2] || 0;
  const repairFactor = totalDelays > 0 ? Math.round((warmRepairCount / totalDelays) * 100) : 100;
  const asymmetry    = totalDelays > 0 ? Math.min(totalDelays * SCORE.ASYMMETRY_STEP, SCORE.ASYMMETRY_CAP) : 0;

  return {
    enrichedText: processedLines.join('\n'),
    metrics: {
      toxicity:           Math.max(SCORE.TOXICITY_MIN,  Math.min(SCORE.TOXICITY_MIN + chilling * SCORE.TOXICITY_CHILLING_STEP, SCORE.TOXICITY_MAX)),
      conflictResolution: Math.max(SCORE.CONFLICT_BASE, Math.min(SCORE.CONFLICT_BASE + repairFactor * SCORE.CONFLICT_REPAIR_WEIGHT, SCORE.CONFLICT_MAX)),
      teamwork:           Math.max(SCORE.TEAMWORK_BASE, SCORE.TEAMWORK_MAX - asymmetry),
      repairPercentage:   repairFactor,
      totalDelays,
    },
    names: { consistentPartner: p1, asyncPartner: p2 },
  };
}

// ── Call one agent ────────────────────────────────────────────
async function queryAgent(apiKey, systemPrompt, userContent) {
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

// ── HTTP handler ──────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const { chatLog, userId }  = req.body;
  const apiKey               = process.env.OPENROUTER_API_KEY;
  const supabaseUrl          = process.env.SUPABASE_URL;
  const supabaseServiceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!apiKey || !supabaseUrl || !supabaseServiceKey)
    return res.status(500).json({ error: 'Missing environment keys.' });

  try {
    // 1. Parse — no LLM, runs in microseconds
    const { enrichedText, metrics, names } = calculateTimelineMetrics(chatLog);

    // 2. Build pacing note — empty string when no meaningful delays
    const minAcc    = Math.min(Math.max(SCORE.ACCOUNTABILITY_MIN, SCORE.ACCOUNTABILITY_MIN + Math.round(metrics.repairPercentage * SCORE.ACCOUNTABILITY_WEIGHT)), SCORE.ACCOUNTABILITY_MAX - 5);
    const maxAcc    = Math.min(SCORE.ACCOUNTABILITY_MAX, minAcc + 5);
    const pacingNote = buildPacingNote({ names, metrics, minAcc, maxAcc });

    // 3. Agents 1 + 2 run in parallel — both read the same enriched text
    const [personaResults, dynamicsResults] = await Promise.all([
      queryAgent(apiKey, buildPersonaPrompt({ names, pacingNote }), enrichedText),
      queryAgent(apiKey, buildDynamicsPrompt({ metrics, pacingNote }), enrichedText),
    ]);

    // 4. Validate
    if (!dynamicsResults || typeof dynamicsResults !== 'object')
      throw new Error('Dynamics agent returned invalid payload.');
    for (const key of REQUIRED_DYNAMICS_KEYS)
      if (!dynamicsResults[key]) throw new Error(`Dynamics agent missing: ${key}`);
    if (!Array.isArray(personaResults?.profiles) || personaResults.profiles.length < 2)
      throw new Error('Persona agent did not return two profiles.');

    // 5. Agent 3 — receives slim summary only, not the full chat text
    const strategies = await queryAgent(
      apiKey,
      buildStrategistPrompt({ names, personaData: personaResults, dynamicsData: dynamicsResults }),
      '' // no chat text needed
    );

    // 6. Resolve profiles + actionables
    const [p1raw, p2raw] = personaResults.profiles;
    const profile1 = personaResults.profiles.find(p => p.name?.toLowerCase() === names.consistentPartner.toLowerCase()) || p1raw;
    const profile2 = personaResults.profiles.find(p => p.name?.toLowerCase() === names.asyncPartner.toLowerCase())     || p2raw;
    if (!profile1 || !profile2) throw new Error('Could not resolve profiles to speaker names.');

    const k1 = `${names.consistentPartner}_actionables`;
    const k2 = `${names.asyncPartner}_actionables`;
    if (!Array.isArray(strategies?.[k1]) || !Array.isArray(strategies?.[k2]))
      throw new Error('Strategist did not return actionables for both speakers.');

    // 7. Compute overall score
    const overallScore = Math.round((
      parsePercent(dynamicsResults.bond_positivity,      SCORE.FALLBACK_WARMTH) +
      parsePercent(dynamicsResults.conflict_resolution,  SCORE.FALLBACK_RESOLUTION) +
      parsePercent(dynamicsResults.safety_trust,         SCORE.FALLBACK_SAFETY) +
      parsePercent(dynamicsResults.relationship_dynamics,SCORE.FALLBACK_DYNAMICS) +
      (100 - parsePercent(dynamicsResults.toxicity,      SCORE.FALLBACK_TOXICITY))
    ) / SCORE.OVERALL_DIVISOR);

    // 8. Assemble result
    const analytics = {
      bond_strength:                `${overallScore}%`,
      bond_strength_reason:         dynamicsResults.bond_strength_reason,
      bond_positivity:              dynamicsResults.bond_positivity,
      bond_positivity_reason:       dynamicsResults.bond_positivity_reason,
      conflict_resolution:          dynamicsResults.conflict_resolution          || `${metrics.conflictResolution}%`,
      conflict_resolution_reason:   dynamicsResults.conflict_resolution_reason,
      safety_trust:                 dynamicsResults.safety_trust,
      safety_trust_reason:          dynamicsResults.safety_trust_reason,
      relationship_dynamics:        dynamicsResults.relationship_dynamics        || `${metrics.teamwork}%`,
      relationship_dynamics_reason: dynamicsResults.relationship_dynamics_reason,
      toxicity:                     dynamicsResults.toxicity                     || `${metrics.toxicity}%`,
      toxicity_reason:              dynamicsResults.toxicity_reason,
      summary:                      dynamicsResults.summary,
      profiles: [
        { ...profile1, actionables: strategies[k1] },
        { ...profile2, actionables: strategies[k2] },
      ],
    };

    // 9. Persist — fire and forget, never blocks the response
    fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/conversations`, {
      method:  'POST',
      headers: { 'apikey': supabaseServiceKey, 'Authorization': `Bearer ${supabaseServiceKey}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ bond_strength: analytics.bond_strength, summary: analytics.summary, full_analytics: analytics, ...(userId ? { user_id: userId } : {}) }),
    }).catch(e => console.error('Supabase write failed:', e.message));

    return res.status(200).json({ modelUsed: 'deterministic-hybrid-pipeline', analytics });

  } catch (err) {
    console.error('Pipeline error:', err.message);
    return res.status(500).json({ error: `Analysis error: ${err.message}` });
  }
}
