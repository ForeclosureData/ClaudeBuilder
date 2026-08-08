# Investor demo (apps/web/app/demo/**)

A self-contained, fixture-only demo of ForeclosureData's frontend for
showing friends, family, prospective users, and partners while backend
work is paused. See `docs/PRODUCT_UX_ROADMAP.md` for the product
philosophy this follows.

## Isolation guarantees

- Every `/demo/*` page imports fixture data directly from
  `apps/web/lib/demo/fixtures/hidalgo-demo-cases.ts` — a plain TypeScript
  array. No `/demo/*` page calls Prisma, an API route, a county adapter,
  Anthropic, or a billing provider.
- "Saved properties" in the demo is `localStorage`-backed React state
  (`apps/web/lib/demo/saved-context.tsx`), not the real
  `/api/saved-properties` route.
- Sign In / Get Started in the demo nav are non-functional buttons.
- `NEXT_PUBLIC_DEMO_MODE=true` only changes which navbar/footer the root
  layout (`apps/web/app/layout.tsx`) renders. It does not gate any data
  fetching — the isolation above holds whether the flag is on or off,
  because `/demo/*` pages simply never import anything that could reach
  a real backend.

## Running it locally

```bash
# from the repo root
cd apps/web
NEXT_PUBLIC_DEMO_MODE=true pnpm dev
```

Then visit `http://localhost:3000/demo`.

You do not need `DATABASE_URL`, Supabase keys, an Anthropic key, or any
billing credentials set for the demo routes to work — they don't read
those env vars. (The rest of the app, under the production routes, will
still try to and may show errors if you navigate there without them —
that's expected and unrelated to the demo.)

## Never do this

- Never set `NEXT_PUBLIC_DEMO_MODE=true` in a real deployment (Netlify
  env vars, `netlify.toml`, etc.) — it changes the whole app's chrome,
  not just `/demo/*`.
- Never import `apps/web/lib/demo/fixtures/**` from a non-demo route.
- Never wire `apps/web/lib/demo/saved-context.tsx` to a real API route —
  build a separate integration instead if that's ever wanted outside the
  demo.

## What's fixture vs. real

Everything under `/demo/*` — case data, county summary stats, pricing
plans, map pin coordinates, "last retrieved" appraisal dates — is
synthetic and lives in `apps/web/lib/demo/fixtures/`. None of it was
queried from production. Names, addresses, and parcel numbers are
invented.
