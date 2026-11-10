# ShotDropVN Monorepo — Agent Rules

1. **Strict TypeScript Only (`.ts` / `.tsx`)**:
   - Both `mobile/` and `web/` are 100% TypeScript (`strict: true`).
   - Never create `.js` or `.jsx` files. If a user prompt refers to `mobile/App.js` or `mobile/src/lib/supabase.js`, always implement the changes in `mobile/App.tsx` and `mobile/src/lib/supabase.ts`.
2. **Project Structure**:
   - `be/supabase_schema.sql`: Supabase PostgreSQL tables (`sessions`, `photos`), storage bucket (`shotdrop_photos`), RLS policies, and `supabase_realtime` publication.
   - `mobile/`: Expo SDK 58 + React Native 0.88 Photographer App (`App.tsx`, `src/lib/supabase.ts`).
   - `web/`: Next.js 16 App Router + Tailwind v4 Guest Web App (`app/page.tsx`, `app/s/[hash]/page.tsx`, `lib/supabase.ts`).
