-- Migration: create high_scores table with RLS policies
-- Project: Pong + Supabase leaderboard
--
-- Run via Supabase SQL Editor or: supabase db push
-- Undo via: supabase migration repair --status reverted <version>

-- ── high_scores table ─────────────────────────────────────────────────────────
--
-- Stores one row per user (enforced by the unique constraint on user_id).
-- The 'score' column holds a composite integer: player_score * 100 + (SCORE_WIN - ai_score)
-- so that wins with fewer AI points rank higher than wins with more AI points.
-- The human-readable score displayed on the leaderboard is floor(score / 100).

CREATE TABLE IF NOT EXISTS public.high_scores (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    score      INTEGER     NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One row per user — upsert on conflict(user_id) keeps only personal best
    CONSTRAINT high_scores_user_id_key UNIQUE (user_id)
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Leaderboard query: ORDER BY score DESC LIMIT 10
CREATE INDEX IF NOT EXISTS high_scores_score_idx ON public.high_scores (score DESC);

-- ── updated_at trigger ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_high_scores_updated_at ON public.high_scores;
CREATE TRIGGER set_high_scores_updated_at
    BEFORE UPDATE ON public.high_scores
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE public.high_scores ENABLE ROW LEVEL SECURITY;

-- Anyone (including anonymous visitors) can read all scores for the leaderboard.
CREATE POLICY "high_scores_read_all"
    ON public.high_scores
    FOR SELECT
    USING (true);

-- Authenticated users can only insert their own score row.
CREATE POLICY "high_scores_insert_own"
    ON public.high_scores
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Authenticated users can only update their own score row.
CREATE POLICY "high_scores_update_own"
    ON public.high_scores
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Authenticated users can delete only their own score row.
CREATE POLICY "high_scores_delete_own"
    ON public.high_scores
    FOR DELETE
    USING (auth.uid() = user_id);

-- ── Grant anon + authenticated roles access ───────────────────────────────────

GRANT SELECT ON public.high_scores TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.high_scores TO authenticated;
