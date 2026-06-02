import {
  OPENROUTER_MODEL, AGENT_TEMPERATURE,
  DELAY_MIN_HOURS, DELAY_MAX_HOURS,
  SLEEP_GAP_MAX_HOURS, SLEEP_START_HOUR_MIN, SLEEP_START_HOUR_MAX,
  SLEEP_END_HOUR_MIN, SLEEP_END_HOUR_MAX,
  ROUTINE_GAP_THRESHOLD, ROUTINE_GAP_MAX_HOURS, PAUSE_NEIGHBOURHOOD,
  WARM_KEYWORDS, CHILLING_KEYWORDS, SCORE
} from './analyze-config.js';

export const stripEmojis = (s) => (s || '').replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]|[\u2600-\u26FF])/g, '').replace(/\s+/g, ' ').trim();

export const safeJsonParse = (str) => JSON.parse(str.trim().replace(/^```json|^```|```$/g, '').trim());

export const parsePercent = (val, fb) => {
  if (typeof val === 'number') return val;
  const n = parseInt(String(val || '').replace(/%/g, ''), 10);
  return isNaN(n) ? fb : n;
};

export function calculateTimelineMetrics(text) {
  const linePattern = /^\[?(\d{1,4}[:\/\-.]\d{1,4}(?:[:\/\-.]\d{2,4})?),\s*([^\]\-]+)\]?\s*(?:-\s*)?([^:]+):\s*(.*)$/i;
  const lines = (text || '').split('\n').filter(Boolean);
  const msgs = [];
  const pauseStartHours = [];

  // Pass 1: Extract Timestamps
  let lastTs = null;
  lines.forEach(raw => {
    const clean = raw.replace(/\u200e|\u202f/g, ' ').trim();
    const m = linePattern.exec(clean);
    if (!m) return;

    const dp = m[1].split(/[:\/\-.]/);
    let d = parseInt(dp[0]), mon = parseInt(dp[1]) - 1, y = dp[2] ? parseInt(dp[2]) : new Date().getFullYear();
    if (y < 100) y += 2000;

    const tm = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?/i.exec(m[2]);
    if (!tm) return;
    let h = parseInt(tm[1]);
    if (tm[4]?.toLowerCase() === 'pm' && h < 12) h += 12;
    if (tm[4]?.toLowerCase() === 'am' && h === 12) h = 0;

    const ts = new Date(y, mon, d, h, parseInt(tm[2])).getTime();
    if (ts) {
      if (lastTs && (ts - lastTs)/36e5 >= DELAY_MIN_HOURS) pauseStartHours.push(new Date(lastTs).getHours());
      msgs.push({ ts, speaker: stripEmojis(m[3]), content: m[4], rawDate: m[1], rawTime: m[2] });
      lastTs = ts;
    }
  });

  const routineMap = new Uint8Array(24);
  pauseStartHours.forEach(ph => {
    for (let i = -PAUSE_NEIGHBOURHOOD; i <= PAUSE_NEIGHBOURHOOD; i++) routineMap[(ph + i + 24) % 24]++;
  });

  let totalDelays = 0, repairs = 0;
  const speakerDelays = {}, speakerChilling = {}, speakers = new Set();

  const enriched = msgs.map((msg, i) => {
    speakers.add(msg.speaker);
    let tag = "";
    if (i > 0) {
      const dH = (msg.ts - msgs[i-1].ts) / 36e5;
      if (dH >= DELAY_MIN_HOURS && dH < DELAY_MAX_HOURS) {
        const h = new Date(msgs[i-1].ts).getHours();
        const isSleep = dH <= SLEEP_GAP_MAX_HOURS && (h >= SLEEP_START_HOUR_MIN || h <= SLEEP_START_HOUR_MAX);
        if (!isSleep && routineMap[h] < ROUTINE_GAP_THRESHOLD) {
          totalDelays++;
          speakerDelays[msg.speaker] = (speakerDelays[msg.speaker] || 0) + 1;
          tag = ` [Pause: ${Math.round(dH)}h]`;
          if (WARM_KEYWORDS.some(k => msg.content.toLowerCase().includes(k))) repairs++;
          if (CHILLING_KEYWORDS.some(k => msg.content.toLowerCase().includes(k))) speakerChilling[msg.speaker] = (speakerChilling[msg.speaker] || 0) + 1;
        }
      }
    }
    return `[${msg.rawDate}, ${msg.rawTime}]${tag} ${msg.speaker}: ${msg.content}`;
  });

  let [p1, p2] = Array.from(speakers);
  if ((speakerDelays[p1] || 0) > (speakerDelays[p2] || 0)) [p1, p2] = [p2, p1];

  const repairFactor = totalDelays > 0 ? Math.round((repairs / totalDelays) * 100) : 100;
  return {
    enrichedText: enriched.join('\n'),
    names: { consistentPartner: p1 || 'P1', asyncPartner: p2 || 'P2' },
    metrics: {
      toxicity: Math.max(SCORE.TOXICITY_MIN, Math.min(SCORE.TOXICITY_MIN + (speakerChilling[p2] || 0) * SCORE.TOXICITY_CHILLING_STEP, SCORE.TOXICITY_MAX)),
      conflictResolution: Math.max(SCORE.CONFLICT_BASE, Math.min(SCORE.CONFLICT_BASE + repairFactor * SCORE.CONFLICT_REPAIR_WEIGHT, SCORE.CONFLICT_MAX)),
      teamwork: Math.max(SCORE.TEAMWORK_BASE, SCORE.TEAMWORK_MAX - Math.min(totalDelays * SCORE.ASYMMETRY_STEP, SCORE.ASYMMETRY_CAP)),
      repairPercentage: repairFactor, totalDelays
    }
  };
}

export async function queryAgent(apiKey, system, user) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      response_format: { type: 'json_object' },
      temperature: AGENT_TEMPERATURE,
    })
  });
  const data = await res.json();
  return safeJsonParse(data.choices[0].message.content);
}
