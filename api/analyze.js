import * as CFG from './analyze-config.js';
import * as ENG from './analyze-engine.js';

export default async function handler(req, res) {
  // 1. HTTP SETUP & VALIDATION
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { chatLog, userId } = req.body;
  const apiKey = process.env.OPENROUTER_API_KEY;

  try {
    // 2. PARSE DETERMINISTIC DATA
    const { enrichedText, metrics, names } = ENG.calculateTimelineMetrics(chatLog);

    // 3. CONSTRUCT PACING CONTEXT
    const minAcc = Math.max(CFG.SCORE.ACCOUNTABILITY_MIN, Math.min(CFG.SCORE.ACCOUNTABILITY_MIN + Math.round(metrics.repairPercentage * CFG.SCORE.ACCOUNTABILITY_WEIGHT), CFG.SCORE.ACCOUNTABILITY_MAX - 5));
    const maxAcc = Math.min(CFG.SCORE.ACCOUNTABILITY_MAX, minAcc + 10);
    const pacingNote = CFG.buildPacingNote({ names, metrics, minAcc, maxAcc });

    // 4. PARALLEL ANALYSIS (Agent 1 & Agent 2)
    const [persona, dynamics] = await Promise.all([
      ENG.queryAgent(apiKey, CFG.buildPersonaPrompt({ names, pacingNote }), enrichedText),
      ENG.queryAgent(apiKey, CFG.buildDynamicsPrompt({ metrics, pacingNote }), enrichedText)
    ]);

    // 5. SEQUENTIAL STRATEGY (Agent 3)
    const strategies = await ENG.queryAgent(apiKey, CFG.buildStrategistPrompt({ names, personaData: persona, dynamicsData: dynamics }), "Generate tips based on summaries.");

    // 6. SCORE AGGREGATION & FINAL ASSEMBLY
    const getS = (val, fb) => ENG.parsePercent(val, fb);
    const overall = Math.round((
      getS(dynamics.bond_positivity, CFG.SCORE.FALLBACK_WARMTH) +
      getS(dynamics.conflict_resolution, CFG.SCORE.FALLBACK_RESOLUTION) +
      getS(dynamics.safety_trust, CFG.SCORE.FALLBACK_SAFETY) +
      getS(dynamics.relationship_dynamics, CFG.SCORE.FALLBACK_DYNAMICS) +
      (100 - getS(dynamics.toxicity, CFG.SCORE.FALLBACK_TOXICITY))
    ) / CFG.SCORE.OVERALL_DIVISOR);

    const findP = (name) => persona.profiles.find(p => p.name?.toLowerCase() === name.toLowerCase()) || persona.profiles[0];

    const analytics = {
      ...dynamics,
      bond_strength: `${overall}%`,
      profiles: [
        { ...findP(names.consistentPartner), actionables: strategies[`${names.consistentPartner}_actionables`] || [] },
        { ...findP(names.asyncPartner), actionables: strategies[`${names.asyncPartner}_actionables`] || [] }
      ]
    };

    // 7. ASYNCHRONOUS PERSISTENCE (Database)
    if (process.env.SUPABASE_URL) {
      fetch(`${process.env.SUPABASE_URL}/rest/v1/conversations`, {
        method: 'POST',
        headers: { 'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ bond_strength: analytics.bond_strength, summary: analytics.summary, full_analytics: analytics, user_id: userId })
      }).catch(e => console.error("Database Trace Bypassed:", e.message));
    }

    // 8. FINAL RESPONSE
    return res.status(200).json({ analytics });

  } catch (err) {
    console.error("Pipeline Failure:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
