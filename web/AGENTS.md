<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## ShotDropVN Web App (`web/`) Conventions

- **100% Strict TypeScript (`.ts` / `.tsx`)**: Never create `.js` or `.jsx` source files.
- **Routes**:
  - `app/page.tsx`: Live Event Portal — displays active/recent sessions with realtime updates and allows guests to enter a session code (`#hash`).
  - `app/s/[hash]/page.tsx`: Real-time Guest Gallery — loads session + photos from Supabase, subscribes to `postgres_changes` (`INSERT` on `public.photos` filtered by `session_id`), renders a responsive masonry grid with `.animate-slide-up-fade`, and supports Blob-based force downloads.
- **Supabase Client**: `lib/supabase.ts` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
