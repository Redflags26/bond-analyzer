import { CONFIG, GET_PACING_INJECTION, GET_PERSONA_PROMPT, GET_DYNAMICS_PROMPT, GET_STRATEGIST_PROMPT } from './analyze-config';

// --- UTILS ---
const stripEmojis = (s) => (s || '').replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]|[\u2600-\u26FF])/g, '').replace(/\s+/g, ' ').trim();

const safeParse = (str) => {
  const clean = (str || "").trim().replace(/^```json/, "").replace(/```$/, "").trim();
  try { return JSON.parse(clean); } catch (e) { throw new Error("JSON Parse Error"); }
};

const parsePct = (v, fb = 90) => {
  if (typeof v === 'number') return v;
  const p = parseInt(String(v).replace(/%/g, ''), 10);
  return isNaN(p) ? fb : p;
};

async function queryAgent(apiKey, system, user) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "openrouter/auto",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_object" },
      temperature: 0.1
    })
  });
  const data = await res.json();
  return safeParse(data.choices[0].message.content);
}

// --- ENGINE ---
function calculateMetrics(text) {
  const lines = (text || '').split('\n').filter(Boolean);
  const parsed = [];
  const speakers = new Set();
  const pauseHours = [];
  const linePattern = /^\[?(\d{1,4}[:\/\-.]\d{1,4}(?:[:\/\-.]\d{2,4})?),\s*([^\]\-]+)\]?\s*(?:-\s*)?([^:]+):\s*(.*)$/i;

  let lastTs = null;
  lines.forEach(line => {
    const clean = line.replace(/\u200e/g, '').replace(/\u202f/g, ' ').trim();
    const m = linePattern.exec(clean);
    if (!m) return;
    
    const dp = m[1].split(/[:\/\-.]/);
    let d = parseInt(dp[0]), mon = parseInt(dp[1]) - 1, y = dp[2] ? parseInt(dp[2]) : new Date().getFullYear();
    if (y < 100) y += 2000;

    const tm = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?/i.exec(m[2]);
    let hrs = parseInt(tm[1]), mins = parseInt(tm[2]);
    if (tm[4]?.toLowerCase() === 'pm' && hrs < 12) hrs += 12;
    if (tm[4]?.toLowerCase() === 'am' && hrs === 12) hrs = 0;

    const ts = new Date(y, mon, d, hrs, mins).getTime();
    const speaker = stripEmojis(m[3]);
    speakers.add(speaker);

    if (lastTs && (ts - lastTs) / 36e5 >= CONFIG.THRESHOLDS.MIN_GAP_HOURS) pauseHours.push(new Date(lastTs).getHours());
    parsed.push({ ts, speaker, content: m[4], timeLabel: m[2], dateLabel: m[1] });
    lastTs = ts;
  });

  const routine = Array(24).fill(0);
  pauseHours.forEach(h => [h, (h-1+24)%24, (h+1)%24].forEach(i => routine[i]++));

  let totalDelays = 0, repairs = 0;
  const chillingCount = {}, delayCount = {};
  
  const enriched = parsed.map((msg, i) => {
    let tag = "";
    if (i > 0) {
      const delta = (msg.ts - parsed[i-1].ts) / 36e5;
      if (delta >= CONFIG.THRESHOLDS.MIN_GAP_HOURS) {
        const ld = new Date(parsed[i-1].ts), cd = new Date(msg.ts);
        const isSleep = (ld.getHours() >= CONFIG.THRESHOLDS.SLEEP_START_HOUR || ld.getHours() <= CONFIG.THRESHOLDS.SLEEP_END_HOUR) && (cd.getHours() >= CONFIG.THRESHOLDS.MORNING_START && cd.getHours() <= CONFIG.THRESHOLDS.MORNING_END);
        if (!isSleep && routine[ld.getHours()] < 2) {
          totalDelays++;
          delayCount[msg.speaker] = (delayCount[msg.speaker] || 0) + 1;
          tag = ` [Asynchronous pause of ${Math.round(delta)} hours]`;
          if (CONFIG.STRINGS.WARM_KEYWORDS.some(k => msg.content.toLowerCase().includes(k))) repairs++;
          if (CONFIG.STRINGS.CHILL_KEYWORDS.some(k => msg.content.toLowerCase().includes(k))) chillingCount[msg.speaker] = (chillingCount[msg.speaker] || 0) + 1;
        }
      }
    }
    return `[${msg.dateLabel}, ${msg.timeLabel}]${tag} ${msg.speaker}: ${msg.content}`;
  });

  const sArr = Array.from(speakers);
  let p1 = sArr[0] || 'P1', p2 = sArr[1] || 'P2';
  if ((delayCount[p1] || 0) > (delayCount[p2] || 0)) [p1, p2] = [p2, p1];

  const times = parsed.map(m => m.ts);
  const isShort = (Math.max(...times) - Math.min(...times)) / 864e5 <= CONFIG.THRESHOLDS.SHORT_CHAT_DAYS;

  return {
    enrichedText: enriched.join('\n'),
    names: { consistentPartner: p1, asyncPartner: p2 },
    metrics: {
      toxicity: Math.max(2, Math.min(3 + ((chillingCount[p2] || 0) * 1.5), 10)),
      conflictResolution: Math.max(70, Math.min(70 + (repairs / (totalDelays || 1) * 25), 95)),
      teamwork: Math.max(75, 95 - Math.min(totalDelays * 1.5, 12)),
      repairPercentage: Math.round((repairs / (totalDelays || 1)) * 100),
      isShortChat: isShort
    }
  };
}

// --- HANDLER ---
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { chatLog, userId } = req.body;
  const apiKey = process.env.OPENROUTER_API_KEY;

  try {
    const { enrichedText, metrics, names } = calculateMetrics(chatLog);
    const pacing = GET_PACING_INJECTION(metrics.isShortChat, names, metrics);

    const [persona, dynamics] = await Promise.all([
      queryAgent(apiKey, GET_PERSONA_PROMPT(names, pacing), enrichedText),
      queryAgent(apiKey, GET_DYNAMICS_PROMPT(names, metrics, pacing), enrichedText)
    ]);

    const tips = await queryAgent(apiKey, GET_STRATEGIST_PROMPT(names, persona, dynamics), enrichedText);

    const scores = [parsePct(dynamics.bond_positivity), parsePct(dynamics.conflict_resolution), parsePct(dynamics.safety_trust), parsePct(dynamics.relationship_dynamics), (100 - parsePct(dynamics.toxicity))];
    const avg = Math.round(scores.reduce((a, b) => a + b) / 5);

    const final = {
      ...dynamics,
      bond_strength: `${avg}%`,
      profiles: persona.profiles.map(p => ({
        ...p,
        actionables: tips[`${p.name}_actionables`] || tips[Object.keys(tips).find(k => k.toLowerCase().includes(p.name.toLowerCase()))] || []
      }))
    };

    return res.status(200).json({ analytics: final });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
