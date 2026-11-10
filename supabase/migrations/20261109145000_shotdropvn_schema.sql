-- =========================================================
-- ShotDropVN — Supabase Schema (MVP + Realtime Enabled)
-- =========================================================

create extension if not exists "pgcrypto";

create table if not exists public.sessions (
    id            uuid primary key default gen_random_uuid(),
    event_name    text not null check (char_length(event_name) between 1 and 200),
    qr_code_hash  text not null unique,
    created_at    timestamptz not null default now()
);

create table if not exists public.photos (
    id          uuid primary key default gen_random_uuid(),
    session_id  uuid not null references public.sessions (id) on delete cascade,
    image_url   text not null,
    created_at  timestamptz not null default now()
);

create index if not exists photos_session_id_created_at_idx
    on public.photos (session_id, created_at desc);

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

alter table public.sessions enable row level security;
alter table public.photos   enable row level security;

drop policy if exists "sessions_select_public" on public.sessions;
create policy "sessions_select_public"
    on public.sessions for select
    to anon, authenticated
    using (true);

drop policy if exists "sessions_insert_authenticated" on public.sessions;
drop policy if exists "sessions_insert_public" on public.sessions;
create policy "sessions_insert_public"
    on public.sessions for insert
    to anon, authenticated
    with check (true);

drop policy if exists "sessions_update_authenticated" on public.sessions;
drop policy if exists "sessions_update_public" on public.sessions;
create policy "sessions_update_public"
    on public.sessions for update
    to anon, authenticated
    using (true)
    with check (true);

drop policy if exists "photos_select_public" on public.photos;
create policy "photos_select_public"
    on public.photos for select
    to anon, authenticated
    using (true);

drop policy if exists "photos_insert_authenticated" on public.photos;
drop policy if exists "photos_insert_public" on public.photos;
create policy "photos_insert_public"
    on public.photos for insert
    to anon, authenticated
    with check (true);

drop policy if exists "photos_update_authenticated" on public.photos;
drop policy if exists "photos_update_public" on public.photos;
create policy "photos_update_public"
    on public.photos for update
    to anon, authenticated
    using (true)
    with check (true);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'shotdrop_photos',
    'shotdrop_photos',
    true,
    20971520,
    array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
    set public             = excluded.public,
        file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "shotdrop_photos_select_public" on storage.objects;
create policy "shotdrop_photos_select_public"
    on storage.objects for select
    to anon, authenticated
    using (bucket_id = 'shotdrop_photos');

drop policy if exists "shotdrop_photos_insert_authenticated" on storage.objects;
drop policy if exists "shotdrop_photos_insert_public" on storage.objects;
create policy "shotdrop_photos_insert_public"
    on storage.objects for insert
    to anon, authenticated
    with check (bucket_id = 'shotdrop_photos');

drop policy if exists "shotdrop_photos_update_authenticated" on storage.objects;
drop policy if exists "shotdrop_photos_update_public" on storage.objects;
create policy "shotdrop_photos_update_public"
    on storage.objects for update
    to anon, authenticated
    using (bucket_id = 'shotdrop_photos')
    with check (bucket_id = 'shotdrop_photos');
