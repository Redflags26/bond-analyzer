// ============================================================
//  analyze.js  —  HTTP handler only (~60 lines).
//  Logic  → analyze-engine.js
//  Config → analyze-config.js
// ============================================================

import { SCORE, REQUIRED_DYNAMICS_KEYS, REQUIRED_STRATEGIST_KEYS, buildPacingNote, buildPersonaPrompt, buildDynamicsPrompt, buildStrategistPrompt } from './analyze-config.js';
import { calculateTimelineMetrics, queryAgent, parsePercent } from './analyze-engine.js';

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
    // 1. Parse — deterministic, no LLM
    const { enrichedText, metrics, names } = calculateTimelineMetrics(chatLog);

    // 2. Build pacing context for prompts
    const minAcc    = Math.min(Math.max(SCORE.ACCOUNTABILITY_MIN, SCORE.ACCOUNTABILITY_MIN + Math.round(metrics.repairPercentage * SCORE.ACCOUNTABILITY_WEIGHT)), SCORE.ACCOUNTABILITY_MAX - 5);
    const maxAcc    = Math.min(SCORE.ACCOUNTABILITY_MAX, minAcc + 5);
    const pacingNote = buildPacingNote({ names, metrics, minAcc, maxAcc });

    // 3. Agents 1 + 2 in parallel
    const [personaResults, dynamicsResults] = await Promise.all([
      queryAgent(apiKey, buildPersonaPrompt({ names, pacingNote }), enrichedText),
      queryAgent(apiKey, buildDynamicsPrompt({ metrics, pacingNote }), enrichedText),
    ]);

    // 4. Validate Agents 1 & 2 (Persona & Dynamics)
    // --------------------------------------------------------
    
    // Validate Persona (Micro)
    if (!Array.isArray(personaResults?.profiles) || personaResults.profiles.length < 2) {
      throw new Error('Persona agent did not return two profiles.');
    }

    // Validate Dynamics (Macro)
    if (!dynamicsResults || typeof dynamicsResults !== 'object') {
      throw new Error('Dynamics agent returned invalid payload.');
    }
    for (const key of REQUIRED_DYNAMICS_KEYS) {
      if (!dynamicsResults[key]) throw new Error(`Dynamics agent missing: ${key}`);
    }


    // 5. Agent 3 — only needs summaries, not full chat text
    const strategies = await queryAgent(
        apiKey,
        buildStrategistPrompt({ names, personaData: personaResults, dynamicsData: dynamicsResults }),
        enrichedText
      );

    // Validate Strategist (Executive) - ADD THIS FOR STABILITY
     if (!strategies || typeof strategies !== 'object') {
      throw new Error('Strategist agent returned invalid payload.');
    }
    for (const key of REQUIRED_STRATEGIST_KEYS) {
      if (!strategies[key]) throw new Error(`Strategist agent missing: ${key}`);
    }

    // 6. Resolve profiles and actionables
    const profile1 = personaResults.profiles.find(p => p.name?.toLowerCase() === names.consistentPartner.toLowerCase()) || personaResults.profiles[0];
    const profile2 = personaResults.profiles.find(p => p.name?.toLowerCase() === names.asyncPartner.toLowerCase())     || personaResults.profiles[1];
    if (!profile1 || !profile2) throw new Error('Could not resolve profiles to speaker names.');

    const k1 = `${names.consistentPartner}_actionables`;
    const k2 = `${names.asyncPartner}_actionables`;
    if (!Array.isArray(strategies?.[k1]) || !Array.isArray(strategies?.[k2]))
      throw new Error('Strategist did not return actionables for both speakers.');

    // 7. Compute overall bond score
    const overallScore = Math.round((
      parsePercent(dynamicsResults.bond_positivity,       SCORE.FALLBACK_WARMTH)      +
      parsePercent(dynamicsResults.conflict_resolution,   SCORE.FALLBACK_RESOLUTION)  +
      parsePercent(dynamicsResults.safety_trust,          SCORE.FALLBACK_SAFETY)      +
      parsePercent(dynamicsResults.relationship_dynamics, SCORE.FALLBACK_DYNAMICS)    +
      (100 - parsePercent(dynamicsResults.toxicity,       SCORE.FALLBACK_TOXICITY))
    ) / SCORE.OVERALL_DIVISOR);

    // 8. Assemble final result
    const analytics = {
      // Macro from Agent 1 (Dynamics)
      bond_positivity: dynamicsResults.bond_positivity,
      bond_positivity_reason: dynamicsResults.bond_positivity_reason,
      conflict_resolution: dynamicsResults.conflict_resolution || `${metrics.conflictResolution}%`,
      conflict_resolution_reason: dynamicsResults.conflict_resolution_reason,
      safety_trust: dynamicsResults.safety_trust,
      safety_trust_reason: dynamicsResults.safety_trust_reason,
      relationship_dynamics: dynamicsResults.relationship_dynamics || `${metrics.teamwork}%`,
      relationship_dynamics_reason: dynamicsResults.relationship_dynamics_reason,
      toxicity: dynamicsResults.toxicity || `${metrics.toxicity}%`,
      toxicity_reason: dynamicsResults.toxicity_reason,

      // Verdict & Summary from Agent 3 (Executive)
      bond_strength: strategies.bond_strength,
      bond_strength_reason: strategies.bond_strength_reason,
      summary: strategies.summary, // <--- Now coming from the Strategist

      // Profiles + Actionables (Agent 2 + Agent 3 mapping)
      profiles: [
        { ...profile1, actionables: strategies.actionables[p1.name] || [] },
        { ...pprofile2, actionables: strategies.actionables[p2.name] || [] }
      ]
    };

    // 9. Persist — fire and forget, never blocks response
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
