# Qalib

Personal daily Word (`.docx`) editor — Next.js + Supabase Free + Prisma schema + `@eigenpal/docx-editor-react` (OOXML).

## Setup

1. Copy `.env.example` → `.env.local` (already pointed at the Qalib Supabase project).
2. In [Supabase Dashboard](https://supabase.com/dashboard/project/qkcniuxvqbsajrsaursx):
   - Auth → Providers → Email enabled
   - Auth → turn **off** “Confirm email” for solo use (optional)
   - Settings → Database → copy DB password into `DATABASE_URL` / `DIRECT_URL` (optional; app works via Supabase client + RLS without it)
3. `npm install`
4. `npx prisma generate`
5. `npm run dev` → http://localhost:3000/ar

## Scripts

- `npm run dev` — local app
- `npm run build` — production build
- `npm run lint` — ESLint
- `npx prisma generate` — Prisma client

## Design skills

- Impeccable + Emil Kowalski skills live under `.cursor/skills/`
- Product/design context: `PRODUCT.md`, `DESIGN.md`

## Deploy (Vercel)

Connect the repo, set the same env vars (`NEXT_PUBLIC_SUPABASE_*`, optional `DATABASE_URL` / `DIRECT_URL`). Add your Vercel URL to Supabase Auth redirect URLs.

## Mobile tip

Best phone experience: keep the device in **portrait**, tap **Fit width** after open, and edit selected text from the **bottom sheet** (select text → edit panel) instead of relying on the page caret alone.
