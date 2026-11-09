# ShotDropVN - Instant Photo Delivery Platform (Project Conventions)

- Project context: An instant session-based photo-sharing platform for event photographers (ShotDropVN).
- Admin App (Photographer): Use Expo (React Native).
- Guest Web (End-user): Use Next.js (App Router) and TailwindCSS.
- Backend: Use Supabase (Database, Auth, and Storage).
- QR Code URL Scheme: The generated QR codes will point to `https://shotdrop.vn/s/[qr_code_hash]`.
- Always write functional components and use React Hooks.
- When executing terminal commands, use `npx expo` or `npm run` as appropriate.
- Never expose API secrets or hardcode credentials.
