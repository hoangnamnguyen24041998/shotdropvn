# ShotDropVN - Instant Photo Delivery Platform (Project Conventions)

- **Project context**: An instant session-based photo-sharing platform for event photographers (ShotDropVN).
- **Strict TypeScript Everywhere (MANDATORY)**:
  - Both `mobile/` (Expo React Native) and `web/` (Next.js App Router) use **100% TypeScript (`strict: true`)**.
  - **NEVER create or revert to `.js` or `.jsx` source files** (such as `App.js` or `supabase.js`).
  - Even if a prompt refers to `mobile/App.js` or `mobile/src/lib/supabase.js`, ALWAYS target `mobile/App.tsx` and `mobile/src/lib/supabase.ts`.
- **Admin App (Photographer - `mobile/`)**:
  - Uses Expo SDK 58 (React Native 0.88) with `index.ts` and `App.tsx`.
  - In Expo SDK 58, legacy functional APIs (`getAssetsAsync`, `getAssetInfoAsync`, `readAsStringAsync`) throw at runtime if imported from `'expo-media-library'` or `'expo-file-system'`. Always import them from `'expo-media-library/legacy'` and `'expo-file-system/legacy'` (or use the SDK 58 `File` / `Query` classes).
- **Guest Web (End-user - `web/`)**:
  - Uses Next.js 16 (App Router), TailwindCSS v4, and TypeScript (`app/page.tsx`, `app/s/[hash]/page.tsx`, `lib/supabase.ts`).
- **Backend (`be/`)**:
  - Uses Supabase (Database, Realtime `postgres_changes`, and Storage bucket `shotdrop_photos`).
- **QR Code URL Scheme**:
  - Generated QR codes point to `${EXPO_PUBLIC_WEB_URL || 'https://shotdrop.vn'}/s/[qr_code_hash]`.
- Always write functional components, use React Hooks, and run `npx tsc --noEmit` to verify types before completing any task.
- Never expose API secrets or hardcode credentials.
