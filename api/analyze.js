// ============================================================
//  analyze.js — HTTP handler
//  Logic  → analyze-engine.js
//  Config → analyze-config.js
// ============================================================

import {
  SCORE,
  REQUIRED_DYNAMICS_KEYS,
  REQUIRED_STRATEGIST_KEYS,
  buildPacingNote,
  buildPersonaPrompt,
  buildDynamicsPrompt,
  buildStrategistPrompt,
} from './analyze-config.js';
import { calculateTimelineMetrics, queryAgent, parsePercent } from './analyze-engine.js';

export default async function handler(req, res) {
  // ── CORS setup ─────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  // ── Environment keys ───────────────────────────────────────
  const { chatLog, userId }  = req.body;
  const apiKey               = process.env.OPENROUTER_API_KEY;
  const supabaseUrl          = process.env.SUPABASE_URL;
  const supabaseServiceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!apiKey || !supabaseUrl || !supabaseServiceKey)
    return res.status(500).json({ error: 'Missing environment keys.' });

  try {
    // 1. Parse chat deterministically (no LLM)
    const { enrichedText, metrics, names } = calculateTimelineMetrics(chatLog);

    // 2. Build pacing context (factual observations only)
    const pacingNote = buildPacingNote({ names, metrics });

    // 3. Call Agents 1 + 2 in parallel (Dynamics + Persona)
    const [dynamicsResults, personaResults] = await Promise.all([
      queryAgent(apiKey, buildDynamicsPrompt({ pacingNote }), enrichedText),
      queryAgent(apiKey, buildPersonaPrompt({ names, pacingNote }), enrichedText),
    ]);

    // 4. Validate Dynamics output
    if (!dynamicsResults || typeof dynamicsResults !== 'object') {
      throw new Error('Dynamics agent returned invalid payload.');
    }
    for (const key of REQUIRED_DYNAMICS_KEYS) {
      if (!dynamicsResults[key]) throw new Error(`Dynamics agent missing: ${key}`);
    }

    // 5. Validate Persona output
    if (!Array.isArray(personaResults?.profiles) || personaResults.profiles.length < 2) {
      throw new Error('Persona agent did not return two profiles.');
    }

    // 6. Call Agent 3 (Strategist) — synthesis
    const strategies = await queryAgent(
      apiKey,
      buildStrategistPrompt({ names, personaData: personaResults, dynamicsData: dynamicsResults }),
      enrichedText,
    );

    if (!strategies || typeof strategies !== 'object') {
      throw new Error('Strategist agent returned invalid payload.');
    }
    for (const key of REQUIRED_STRATEGIST_KEYS) {
      if (!strategies[key]) throw new Error(`Strategist agent missing: ${key}`);
    }

    // 7. Resolve profiles to named speakers
    const profile1 = personaResults.profiles.find(p => p.name?.toLowerCase() === names.consistentPartner.toLowerCase()) || personaResults.profiles[0];
    const profile2 = personaResults.profiles.find(p => p.name?.toLowerCase() === names.asyncPartner.toLowerCase())     || personaResults.profiles[1];
    if (!profile1 || !profile2) throw new Error('Could not resolve profiles to speaker names.');

    const k1 = names.consistentPartner;
    const k2 = names.asyncPartner;
    if (!Array.isArray(strategies?.actionables?.[k1]) || !Array.isArray(strategies?.actionables?.[k2]))
      throw new Error('Strategist did not return actionables for both speakers.');

    // 8. Compute overall bond score (neutral defaults, backup only)
    const overallScore = Math.round((
      parsePercent(dynamicsResults.bond_positivity,       50) +
      parsePercent(dynamicsResults.conflict_resolution,   50) +
      parsePercent(dynamicsResults.safety_trust,          50) +
      parsePercent(dynamicsResults.relationship_dynamics, 50) +
      (100 - parsePercent(dynamicsResults.toxicity,       50))
    ) / SCORE.OVERALL_DIVISOR);

    // 9. Assemble final analytics (Strategist bond_strength is authoritative)
    const analytics = {
      // Macro — Dynamics agent
      bond_positivity:              dynamicsResults.bond_positivity,
      bond_positivity_reason:       dynamicsResults.bond_positivity_reason,
      conflict_resolution:          dynamicsResults.conflict_resolution,
      conflict_resolution_reason:   dynamicsResults.conflict_resolution_reason,
      safety_trust:                 dynamicsResults.safety_trust,
      safety_trust_reason:          dynamicsResults.safety_trust_reason,
      relationship_dynamics:        dynamicsResults.relationship_dynamics,
      relationship_dynamics_reason: dynamicsResults.relationship_dynamics_reason,
      toxicity:                     dynamicsResults.toxicity,
      toxicity_reason:              dynamicsResults.toxicity_reason,

      // Strategist — authoritative verdict
      bond_strength:        strategies.bond_strength,
      bond_strength_reason: strategies.bond_strength_reason,
      summary:              strategies.summary,

      // Profiles + actionables
      profiles: [
        { ...profile1, actionables: strategies.actionables[k1] || [] },
        { ...profile2, actionables: strategies.actionables[k2] || [] },
      ],

      // Deterministic backup score (not exposed to users)
      overallScore,
    };

    // 10. Persist results (fire and forget)
    fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/conversations`, {
      method:  'POST',
      headers: {
        'apikey':        supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type':  'application/json',
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify({
        bond_strength:  analytics.bond_strength,
        summary:        analytics.summary,
        full_analytics: analytics,
        ...(userId ? { user_id: userId } : {}),
      }),
    }).catch(e => console.error('Supabase write failed:', e.message));

    return res.status(200).json({ modelUsed: 'deterministic-hybrid-pipeline', analytics });

  } catch (err) {
    console.error('Pipeline error:', err.message);
    return res.status(500).json({ error: `Analysis error: ${err.message}` });
  }
}
