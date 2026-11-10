-- =========================================================
-- ShotDropVN — Supabase Schema (MVP + Realtime Enabled)
-- Run this script in the Supabase SQL Editor.
-- It is idempotent: safe to run multiple times.
-- =========================================================

-- gen_random_uuid() lives in pgcrypto (enabled by default on Supabase)
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------

-- A session = one event/shoot. Guests reach it via
-- https://shotdrop.vn/s/[qr_code_hash]
create table if not exists public.sessions (
    id            uuid primary key default gen_random_uuid(),
    event_name    text not null check (char_length(event_name) between 1 and 200),
    qr_code_hash  text not null unique,
    created_at    timestamptz not null default now()
);

-- Photos uploaded by the photographer into a session.
create table if not exists public.photos (
    id          uuid primary key default gen_random_uuid(),
    session_id  uuid not null references public.sessions (id) on delete cascade,
    image_url   text not null,
    created_at  timestamptz not null default now()
);

-- Indexes: the guest page fetches photos by session, newest first.
create index if not exists photos_session_id_created_at_idx
    on public.photos (session_id, created_at desc);

-- ---------------------------------------------------------
-- 2. Enable Supabase Realtime (postgres_changes)
-- ---------------------------------------------------------
alter table public.sessions replica identity full;
alter table public.photos   replica identity full;

do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'sessions'
    ) then
        alter publication supabase_realtime add table public.sessions;
    end if;

    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'photos'
    ) then
        alter publication supabase_realtime add table public.photos;
    end if;
end $$;

-- ---------------------------------------------------------
-- 3. Row Level Security — tables
-- (Allows anon + authenticated so the MVP mobile app works
-- immediately with EXPO_PUBLIC_SUPABASE_ANON_KEY without Login)
-- ---------------------------------------------------------
alter table public.sessions enable row level security;
alter table public.photos   enable row level security;

-- sessions: public read
drop policy if exists "sessions_select_public" on public.sessions;
create policy "sessions_select_public"
    on public.sessions for select
    to anon, authenticated
    using (true);

-- sessions: insert (anon + authenticated for frictionless MVP)
drop policy if exists "sessions_insert_authenticated" on public.sessions;
drop policy if exists "sessions_insert_public" on public.sessions;
create policy "sessions_insert_public"
    on public.sessions for insert
    to anon, authenticated
    with check (true);

-- sessions: update
drop policy if exists "sessions_update_authenticated" on public.sessions;
drop policy if exists "sessions_update_public" on public.sessions;
create policy "sessions_update_public"
    on public.sessions for update
    to anon, authenticated
    using (true)
    with check (true);

-- photos: public read
drop policy if exists "photos_select_public" on public.photos;
create policy "photos_select_public"
    on public.photos for select
    to anon, authenticated
    using (true);

-- photos: insert (anon + authenticated for frictionless MVP)
drop policy if exists "photos_insert_authenticated" on public.photos;
drop policy if exists "photos_insert_public" on public.photos;
create policy "photos_insert_public"
    on public.photos for insert
    to anon, authenticated
    with check (true);

-- photos: update
drop policy if exists "photos_update_authenticated" on public.photos;
drop policy if exists "photos_update_public" on public.photos;
create policy "photos_update_public"
    on public.photos for update
    to anon, authenticated
    using (true)
    with check (true);

-- ---------------------------------------------------------
-- 4. Storage bucket
-- ---------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'shotdrop_photos',
    'shotdrop_photos',
    true,
    20971520, -- 20 MB per file
    array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
    set public             = excluded.public,
        file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------
-- 5. Row Level Security — storage.objects (bucket scoped)
-- ---------------------------------------------------------

-- Public read of objects in the bucket
drop policy if exists "shotdrop_photos_select_public" on storage.objects;
create policy "shotdrop_photos_select_public"
    on storage.objects for select
    to anon, authenticated
    using (bucket_id = 'shotdrop_photos');

-- Upload (anon + authenticated for frictionless MVP)
drop policy if exists "shotdrop_photos_insert_authenticated" on storage.objects;
drop policy if exists "shotdrop_photos_insert_public" on storage.objects;
create policy "shotdrop_photos_insert_public"
    on storage.objects for insert
    to anon, authenticated
    with check (bucket_id = 'shotdrop_photos');

-- Update (overwrite / upsert)
drop policy if exists "shotdrop_photos_update_authenticated" on storage.objects;
drop policy if exists "shotdrop_photos_update_public" on storage.objects;
create policy "shotdrop_photos_update_public"
    on storage.objects for update
    to anon, authenticated
    using (bucket_id = 'shotdrop_photos')
    with check (bucket_id = 'shotdrop_photos');
