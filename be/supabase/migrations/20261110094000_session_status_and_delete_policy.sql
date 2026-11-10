-- =========================================================
-- Add is_active & ended_at to sessions + delete policies
-- =========================================================

ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE public.photos ADD COLUMN IF NOT EXISTS client_photo_id TEXT DEFAULT NULL;
ALTER TABLE public.photos ADD COLUMN IF NOT EXISTS storage_path TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS photos_client_photo_id_idx ON public.photos (client_photo_id);

DROP POLICY IF EXISTS "photos_delete_public" ON public.photos;
CREATE POLICY "photos_delete_public"
    ON public.photos FOR DELETE
    TO anon, authenticated
    USING (true);

DROP POLICY IF EXISTS "shotdrop_photos_delete_public" ON storage.objects;
CREATE POLICY "shotdrop_photos_delete_public"
    ON storage.objects FOR DELETE
    TO anon, authenticated
    USING (bucket_id = 'shotdrop_photos');
