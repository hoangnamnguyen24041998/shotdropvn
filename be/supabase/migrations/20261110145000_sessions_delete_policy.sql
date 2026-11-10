-- =========================================================
-- Allow anon/authenticated to delete from sessions (for End Session cleanup)
-- =========================================================

DROP POLICY IF EXISTS "sessions_delete_public" ON public.sessions;
CREATE POLICY "sessions_delete_public"
    ON public.sessions FOR DELETE
    TO anon, authenticated
    USING (true);
