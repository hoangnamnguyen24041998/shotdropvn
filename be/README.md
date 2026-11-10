# ShotDropVN Backend (`be`)

Backend services and database management for **ShotDropVN** powered by **Supabase**.

---

## 📁 Directory Structure

```
be/
├── README.md
├── supabase/
│   ├── config.toml           # Supabase CLI configuration
│   ├── .temp/                # Linked project references (project-ref, linked-project.json)
│   └── migrations/           # Database migrations & SQL schema
│       └── 20261109145000_shotdropvn_schema.sql
└── supabase_schema.sql       # Reference SQL schema (idempotent setup script)
```

---

## ⚡ Supabase Project Information

- **Project Ref**: `offobwrujfirkjllvvps`
- **Project URL**: `https://offobwrujfirkjllvvps.supabase.co`
- **Dashboard**: [https://supabase.com/dashboard/project/offobwrujfirkjllvvps](https://supabase.com/dashboard/project/offobwrujfirkjllvvps)
- **Database**: PostgreSQL 17 (ap-southeast-2)
- **Storage Bucket**: `shotdrop_photos` (Public: `true`, Max Size: 20MB, Types: JPEG/PNG/WebP/HEIC)

---

## 🗄️ Database Schema & RLS

### Tables
1. **`public.sessions`**
   - `id` (UUID, PK)
   - `event_name` (TEXT)
   - `qr_code_hash` (TEXT, UNIQUE) - used in `/s/[qr_code_hash]`
   - `created_at` (TIMESTAMPTZ)
2. **`public.photos`**
   - `id` (UUID, PK)
   - `session_id` (UUID, FK -> sessions.id, ON DELETE CASCADE)
   - `image_url` (TEXT) - public URL in `shotdrop_photos` bucket
   - `created_at` (TIMESTAMPTZ)

### Realtime
Both `sessions` and `photos` are published to `supabase_realtime` publication for instant live push updates on the web gallery.

### Row Level Security (RLS)
Permits `anon` and `authenticated` roles for frictionless live event shooting (Canon 6D OTG / Wi-Fi tethering) without requiring photographer login on the mobile app.

---

## 🛠️ Backend Commands (Supabase CLI)

Run all backend commands from within the `be` directory:

```bash
cd be

# Check database status
supabase db query --linked "SELECT * FROM public.sessions LIMIT 5;"

# Push new migrations to remote Supabase database
supabase db push

# Verify storage bucket
supabase db query --linked "SELECT id, name, public FROM storage.buckets WHERE id = 'shotdrop_photos';"
```
