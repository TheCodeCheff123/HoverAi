-- Hover AI — initial database schema
-- Run once: psql $DATABASE_URL -f migrations/001_initial.sql
--
-- Tables:
--   users         — authentication and profile
--   user_settings — per-user app settings (mirrors AppSettings in src/preload/index.d.ts)
--   query_logs    — STT benchmark data (hackathon deliverable, 30% of judging weight)


-- ── users ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT        UNIQUE NOT NULL,
    full_name       TEXT,
    hashed_password TEXT        NOT NULL,
    -- Language preference stored here so it is available on sign-in
    -- before user_settings is loaded. Mirrors AppSettings.language.
    language        TEXT        NOT NULL DEFAULT 'en-pidgin',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ── user_settings ─────────────────────────────────────────────────────────────
-- Every field mirrors AppSettings in hover-app/src/preload/index.d.ts.
-- Keep these two in sync when adding new settings fields.

CREATE TABLE IF NOT EXISTS user_settings (
    user_id            UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    overlay_opacity    REAL        NOT NULL DEFAULT 1.0,   -- 0.4 – 1.0
    overlay_size       TEXT        NOT NULL DEFAULT 'default', -- compact | default | large
    mic_sensitivity    INTEGER     NOT NULL DEFAULT 5,     -- 1 – 10
    sound_effects      BOOLEAN     NOT NULL DEFAULT true,
    notifications      BOOLEAN     NOT NULL DEFAULT true,
    wake_word_enabled  BOOLEAN     NOT NULL DEFAULT false,
    launch_at_login    BOOLEAN     NOT NULL DEFAULT false,
    show_in_taskbar    BOOLEAN     NOT NULL DEFAULT false,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ── query_logs ────────────────────────────────────────────────────────────────
-- Every POST /query call inserts one row.
-- Three STT transcripts + latencies are the hackathon benchmark dataset.
-- vision_response stores the raw LLM JSON; beacon_steps stores the parsed steps.

CREATE TABLE IF NOT EXISTS query_logs (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID        REFERENCES users(id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    language_used         TEXT        NOT NULL,
    audio_duration_ms     INTEGER,

    -- Intron Sahara (primary STT — used downstream for vision)
    transcript_sahara     TEXT,
    sahara_latency_ms     INTEGER,

    -- Groq whisper-large-v3-turbo (benchmark #2)
    transcript_whisper    TEXT,
    whisper_latency_ms    INTEGER,

    -- HuggingFace intronhealth/afrispeech-whisper-medium-all (benchmark #3)
    transcript_afrispeech TEXT,
    afrispeech_latency_ms INTEGER,

    -- Vision LLM output
    vision_response       JSONB,  -- raw model response for later inspection
    beacon_steps          JSONB   -- parsed BeaconStep[] sent to Electron
);
