import { SCORE, REQUIRED_DYNAMICS_KEYS, buildPacingNote, buildPersonaPrompt, buildDynamicsPrompt, buildStrategistPrompt } from './analyze-config.js';
import { calculateTimelineMetrics, queryAgent, parsePercent } from './analyze-engine.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { chatLog, userId } = req.body;
  const apiKey = process.env.OPENROUTER_API_KEY;

  try {
    const { enrichedText, metrics, names } = calculateTimelineMetrics(chatLog);

    // 1. Logic for Accountability Range
    const minAcc = Math.max(SCORE.ACCOUNTABILITY_MIN, Math.min(SCORE.ACCOUNTABILITY_MIN + Math.round(metrics.repairPercentage * SCORE.ACCOUNTABILITY_WEIGHT), SCORE.ACCOUNTABILITY_MAX - 5));
    const maxAcc = Math.min(SCORE.ACCOUNTABILITY_MAX, minAcc + 10);
    const pacingNote = buildPacingNote({ names, metrics, minAcc, maxAcc });

    // 2. Run Analysis
    const [persona, dynamics] = await Promise.all([
      queryAgent(apiKey, buildPersonaPrompt({ names, pacingNote }), enrichedText),
      queryAgent(apiKey, buildDynamicsPrompt({ metrics, pacingNote }), enrichedText)
    ]);

    // 3. Run Strategy (uses Agent 1 & 2 outputs)
    const strategies = await queryAgent(apiKey, buildStrategistPrompt({ names, personaData: persona, dynamicsData: dynamics }), "Generate tips based on the provided JSON summaries.");

    // 4. Score Aggregation
    const getS = (val, fb) => parsePercent(val, fb);
    const overall = Math.round((
      getS(dynamics.bond_positivity, SCORE.FALLBACK_WARMTH) +
      getS(dynamics.conflict_resolution, SCORE.FALLBACK_RESOLUTION) +
      getS(dynamics.safety_trust, SCORE.FALLBACK_SAFETY) +
      getS(dynamics.relationship_dynamics, SCORE.FALLBACK_DYNAMICS) +
      (100 - getS(dynamics.toxicity, SCORE.FALLBACK_TOXICITY))
    ) / SCORE.OVERALL_DIVISOR);

    const findP = (name) => persona.profiles.find(p => p.name?.toLowerCase() === name.toLowerCase()) || persona.profiles[0];

    const analytics = {
      ...dynamics,
      bond_strength: `${overall}%`,
      profiles: [
        { ...findP(names.consistentPartner), actionables: strategies[`${names.consistentPartner}_actionables`] || [] },
        { ...findP(names.asyncPartner), actionables: strategies[`${names.asyncPartner}_actionables`] || [] }
      ]
    };

    // 5. Background Persistence
    if (process.env.SUPABASE_URL) {
      fetch(`${process.env.SUPABASE_URL}/rest/v1/conversations`, {
        method: 'POST',
        headers: { 'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ bond_strength: analytics.bond_strength, summary: analytics.summary, full_analytics: analytics, user_id: userId })
      }).catch(e => console.error("DB Error:", e.message));
    }

    return res.status(200).json({ analytics });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
