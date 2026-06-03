// ============================================================
//  analyze.js — HTTP handler.
//  Orchestrates the 2-agent pipeline (Analysis -> Strategist).
// ============================================================

import {
  REQUIRED_ANALYSIS_KEYS,
  REQUIRED_STRATEGIST_KEYS,
  buildPacingNote,
  buildAnalysisPrompt,
  buildStrategistPrompt,
} from './analyze-config.js';
import { calculateTimelineMetrics, queryAgent } from './analyze-engine.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const { chatLog, userId } = req.body;
  const apiKey              = process.env.OPENROUTER_API_KEY;
  const supabaseUrl         = process.env.SUPABASE_URL;
  const supabaseServiceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!apiKey || !supabaseUrl || !supabaseServiceKey)
    return res.status(500).json({ error: 'Missing environment keys.' });

  try {
    // 1. Parse — Deterministic timeline annotation
    const { enrichedText, metrics, names } = calculateTimelineMetrics(chatLog);

    // 2. Build Pacing Note — Factual context for the LLM
    const pacingNote = buildPacingNote({ names, metrics });

    // 3. Agent 1: Combined Analysis (Relationship Dynamics + Individual Persona)
    const analysisResults = await queryAgent(
      apiKey, 
      buildAnalysisPrompt({ names, pacingNote }), 
      enrichedText
    );

    // 4. Validate Agent 1 Response
    if (!analysisResults || typeof analysisResults !== 'object')
      throw new Error('Analysis agent returned invalid payload.');
      
    for (const key of REQUIRED_ANALYSIS_KEYS) {
      if (analysisResults[key] === undefined) throw new Error(`Analysis key missing: ${key}`);
    }

    if (!Array.isArray(analysisResults.profiles) || analysisResults.profiles.length < 2)
      throw new Error('Analysis agent did not return two individual profiles.');

    // 5. Agent 2: Executive Strategist — Synthesis & Verdict
    // This agent receives the structured analysis + original context
    const strategies = await queryAgent(
      apiKey,
      buildStrategistPrompt({ names, analysisData: analysisResults }),
      enrichedText
    );

    // 6. Validate Agent 2 Response
    if (!strategies || typeof strategies !== 'object')
      throw new Error('Strategist agent returned invalid payload.');
      
    for (const key of REQUIRED_STRATEGIST_KEYS) {
      if (strategies[key] === undefined) throw new Error(`Strategist key missing: ${key}`);
    }

    // 7. Map Profiles and Resolve Actionables
    // Names are resolved against speaker detection to prevent "swapped profile" errors.
    const profile1 = analysisResults.profiles.find(p => p.name?.toLowerCase() === names.consistentPartner.toLowerCase()) || analysisResults.profiles[0];
    const profile2 = analysisResults.profiles.find(p => p.name?.toLowerCase() === names.asyncPartner.toLowerCase())     || analysisResults.profiles[1];

    const k1 = names.consistentPartner;
    const k2 = names.asyncPartner;

    // 8. Assemble final result for HTML consumption
    const analytics = {
      // Macro Dynamics (from Agent 1)
      bond_positivity:              analysisResults.bond_positivity,
      bond_positivity_reason:       analysisResults.bond_positivity_reason,
      conflict_resolution:          analysisResults.conflict_resolution,
      conflict_resolution_reason:   analysisResults.conflict_resolution_reason,
      safety_trust:                 analysisResults.safety_trust,
      safety_trust_reason:          analysisResults.safety_trust_reason,
      relationship_dynamics:        analysisResults.relationship_dynamics,
      relationship_dynamics_reason: analysisResults.relationship_dynamics_reason,
      toxicity:                     analysisResults.toxicity,
      toxicity_reason:              analysisResults.toxicity_reason,

      // Verdict & Summary (from Agent 2)
      bond_strength:        strategies.bond_strength,
      bond_strength_reason: strategies.bond_strength_reason,
      summary:              strategies.summary,

      // Profiles merged with actionables
      profiles: [
        { ...profile1, actionables: strategies.actionables[k1] || [] },
        { ...profile2, actionables: strategies.actionables[k2] || [] },
      ],
    };

    // 9. Persist to Supabase — fire and forget
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

    // 10. Return result to Frontend
    return res.status(200).json({ modelUsed: 'deterministic-hybrid-pipeline', analytics });

  } catch (err) {
    console.error('Pipeline error:', err.message);
    return res.status(500).json({ error: `Analysis error: ${err.message}` });
  }
}
