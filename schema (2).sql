-- ============================================================
--  TRUVAH — Schema v0.4
--
--  Three tables:
--  conversations  — one row per chat (already exists)
--  personas       — two rows per chat (A and B), computed at end
--  episodes       — N rows per chat, atomic behavioural units
--
--  Design principles:
--  - episodes are lean: actor (A/B) + situation + trigger + action + outcome
--  - personas are computed AFTER all episodes are extracted
--  - persona join: episodes.conversation_id + episodes.actor → personas
--  - LLM marker scores AND computed marker scores both stored on persona
--  - nothing is scored per-episode; persona is always conversation-level
-- ============================================================


-- ── 1. Patch conversations table (already exists) ────────────
alter table conversations
  add column if not exists context           text,
  add column if not exists context_conf      float,
  add column if not exists speaker_a         text,
  add column if not exists speaker_b         text,
  add column if not exists ontology_version  text default '0.4';


-- ── 2. Personas — one per actor per conversation ─────────────
--
--  Computed at the end of episode extraction.
--  Two rows per conversation: actor='A' and actor='B'.
--  Episodes join to this via (conversation_id, actor).
--
--  marker scores come in two flavours:
--    llm_markers   — LLM scored once with full chat as context
--    calc_markers  — computed from this actor's episode distribution
--  Both stored. calc_markers becomes ground truth as data grows.
--
create table if not exists personas (
  persona_id        uuid        primary key default gen_random_uuid(),
  conversation_id   uuid        not null references conversations(id) on delete cascade,
  actor             char(1)     not null check (actor in ('A', 'B')),
  actor_name        text,

  -- ── Extracted from chat ───────────────────────────────────
  sex               char(1)     check (sex in ('M', 'F')),
  age               int         check (age between 10 and 100),

  -- ── Computed from episodes ────────────────────────────────
  -- Attachment archetype — derived from action_distribution,
  -- never LLM-assigned directly.
  attachment_archetype  text    check (attachment_archetype in (
    'secure', 'anxious', 'avoidant', 'disorganized', 'unknown'
  )),
  archetype_confidence  float   check (archetype_confidence between 0 and 1),

  -- How many episodes this persona was computed from.
  -- Low counts (<5) mean low reliability.
  episode_count     int         not null default 0,

  -- Action distribution across all this actor's episodes in this conversation.
  -- { "validation": 0.40, "deflection": 0.25, "withdrawal": 0.20, ... }
  -- Proportions, sum to 1.0. Used to compute archetype + calc_markers.
  action_distribution   jsonb,

  -- Conditional map: how they act given (situation + trigger).
  -- { "conflict+criticism": { "deflection": 0.61, "escalation": 0.39 }, ... }
  -- Sparse — only populated for combinations that appear in this chat.
  conditional_map   jsonb,

  -- ── LLM marker scores (0–100) ─────────────────────────────
  -- Scored once by LLM with the full enriched chat as context.
  -- Stored as a single jsonb object for flexibility.
  -- Shape: { "emotional_reactivity": 72, "openness": 85, ... }
  llm_markers       jsonb,

  -- ── Computed marker scores (0–100) ────────────────────────
  -- Derived analytically from this actor's episode rows.
  -- Same shape as llm_markers.
  -- Rules:
  --   emotional_reactivity  = % of episodes with escalation/guilt_trip/contempt actions
  --   openness              = % of episodes with validation/curiosity/compromise actions
  --   accountability        = % of episodes with accountability/repair_attempt actions
  --   directness            = % of episodes with self_disclosure/boundary_assertion actions
  --   vulnerability         = % of episodes with self_disclosure/affection actions
  --   control_tendency      = % of episodes with control_attempt/stonewalling/blame_shift
  --   repair_orientation    = % of repair actions under conflict/trust_break situations
  --   consistency           = stddev of action variety under same situation (inverted)
  calc_markers      jsonb,

  -- Dominant behavioural patterns — top values from distributions
  dominant_defense  text,   -- most common action under negative triggers
  dominant_repair   text,   -- most common action under repair opportunities
  top_trigger       text,   -- trigger that most commonly preceded their episodes

  -- Repair receptivity: when partner did repair_attempt,
  -- how often did this actor de-escalate in the next episode?
  repair_receptivity    float   check (repair_receptivity between 0 and 1),

  created_at        timestamptz not null default now(),

  -- One persona row per actor per conversation
  unique (conversation_id, actor)
);


-- ── 3. Episodes — the atomic unit ────────────────────────────
--
--  One row = one actor's behavioural turn.
--  Persona is NOT stored here — join via (conversation_id, actor).
--
--  outcome is ONLY set on the last episode of a discussion thread.
--
create table if not exists episodes (
  episode_id        uuid        primary key default gen_random_uuid(),
  conversation_id   uuid        not null references conversations(id) on delete cascade,
  ontology_version  text        not null default '0.4',

  -- Position
  global_index      int         not null,
  segment_index     int         not null,

  -- Actor — joins to personas(conversation_id, actor)
  actor             char(1)     not null check (actor in ('A', 'B')),
  actor_name        text,

  -- Conversation-level label, denormalised for query convenience
  context           text        not null check (context in (
    'relationship_early', 'relationship_established', 'relationship_long_term',
    'family', 'friendship', 'workplace', 'legal', 'hiring', 'other'
  )),

  -- Core ontology labels
  situation         text        not null check (situation in (
    'conflict', 'trust_break', 'boundary_setting', 'vulnerability_share',
    'support_seeking', 'reconnection', 'jealousy', 'decision_point',
    'distance', 'routine'
  )),

  trigger           text        not null check (trigger in (
    'criticism', 'rejection', 'unmet_need', 'disrespect', 'loss_of_control',
    'vulnerability_bid', 'jealousy_activation', 'uncertainty', 'withdrawal', 'none'
  )),

  action            text        not null check (action in (
    'validation', 'reassurance', 'self_disclosure', 'curiosity', 'affection',
    'accountability', 'repair_attempt', 'compromise', 'clarification', 'boundary_assertion',
    'deflection', 'withdrawal', 'stonewalling', 'minimization', 'blame_shift',
    'criticism', 'escalation', 'guilt_trip', 'control_attempt', 'contempt'
  )),

  confidence        float       check (confidence between 0 and 1),

  -- Thread boundary
  is_thread_end     boolean     not null default false,
  outcome           text        check (outcome in (
    'resolved', 'partial_repair', 'agreement', 'understanding', 'neutral',
    'unresolved', 'withdrawn', 'escalated', 'stonewalled', 'damaged'
  )),

  constraint outcome_only_on_thread_end
    check (outcome is null or is_thread_end = true),

  created_at        timestamptz not null default now()
);


-- ── 4. Indexes ────────────────────────────────────────────────

create index if not exists idx_personas_conversation
  on personas (conversation_id);

create index if not exists idx_personas_archetype
  on personas (attachment_archetype);

create index if not exists idx_episodes_conversation
  on episodes (conversation_id);

create index if not exists idx_episodes_actor
  on episodes (conversation_id, actor);

create index if not exists idx_episodes_action
  on episodes (action);

create index if not exists idx_episodes_situation
  on episodes (situation);

create index if not exists idx_episodes_trigger
  on episodes (trigger);

create index if not exists idx_episodes_outcome
  on episodes (outcome)
  where outcome is not null;

create index if not exists idx_episodes_thread_end
  on episodes (conversation_id)
  where is_thread_end = true;

-- For cross-user analytics — filter low-confidence episodes
create index if not exists idx_episodes_confidence
  on episodes (confidence)
  where confidence >= 0.6;
