# ForeclosureData

**We read every foreclosure notice so you don't have to.**

A searchable database of upcoming Texas foreclosure-sale properties, built
by automatically collecting county foreclosure notices and turning the PDFs
into structured, sourced, confidence-scored records.

Initial market: **Hidalgo County, TX**. Built to extend to all 254 Texas
counties via a per-county adapter (see `lib/county-adapters`).

> This app lives at `foreclosuredata/` inside the
> `merchant1-solutions-website` repository but is a fully independent
> product — separate database, separate auth, separate deploy. It does not
> share code or data with the Merchant1 Solutions site.

## Stack

Next.js 14 (App Router) · TypeScript (strict) · Tailwind CSS ·
hand-rolled shadcn/ui-style primitives · PostgreSQL · Prisma ·
NextAuth (Credentials) · Stripe · Zod · Vitest

See `docs/ARCHITECTURE.md` for the full system design and
`docs/COST_CONTROLS.md` for how this stays cheap enough to sell at ~$5/mo.

## Quick start

```bash
cd foreclosuredata
cp .env.example .env
docker compose up -d       # starts local Postgres on localhost:5433
npm install
npm run db:push            # create schema
npm run db:seed            # fictional demo data (Hidalgo County)
npm run dev                # http://localhost:3100
```

Demo accounts created by the seed script:

| Email | Password | Role |
|---|---|---|
| `investor@example.com` | `password123` | USER (paid plan) |
| `admin@example.com` | `password123` | ADMIN |

Run tests:

```bash
npm run test
```

## Folder structure

```
foreclosuredata/
  app/
    (marketing)/          landing + disclaimers (public)
    (auth)/                sign-in / sign-up
    (app)/                 property list, detail, watchlist, billing (auth required)
    (admin)/admin/         admin dashboard (ADMIN role required)
    api/                   route handlers (auth, stripe, exports, admin actions)
  components/
    ui/                    small styled primitives (Button, Card, Badge, ...)
    properties/            property list/detail building blocks
    layout/                Navbar, Footer, DisclaimerBanner
    admin/                 admin widgets
  lib/
    county-adapters/       CountyForeclosureAdapter interface + per-county plugins
    extraction/            deterministic parsers + AI fallback + pipeline
    address-resolution/    address-resolution sequence + scoring
    loan/                  balance-estimation module
    storage/               StorageAdapter interface (local + S3-style)
    billing/                Stripe + plan-limit enforcement
    jobs/                  DB-backed job queue + processors
    csv/                   CSV export
    validation/            shared Zod schemas
    auth.ts, db.ts, utils.ts
  prisma/
    schema.prisma
    seed.ts
  tests/
    unit/                  parser & calculator tests
  docs/
    ARCHITECTURE.md, BACKLOG.md, COST_CONTROLS.md, COUNTY_ROADMAP.md, DEPLOYMENT.md
```

## Important product facts baked into the code

- **Never presents an estimated balance as a real payoff.** See
  `lib/loan/balanceEstimator.ts` and how its output is labeled in the UI.
- **Never assumes the borrower's mailing address is the property address.**
  See `lib/address-resolution/resolver.ts`.
- **Every important field shows its source, confidence, and whether it's
  an estimate** — via the generic `ExtractedField` table joined into the
  property detail page's "Source evidence" panel.
- **Idempotent ingestion.** Documents are content-hashed (SHA-256);
  reprocessing never creates duplicate `ForeclosureCase`/`Property` rows.
- **Live scraping of Hidalgo County is intentionally not implemented yet.**
  The adapter interface and a fixture-based mock implementation exist so
  the rest of the app can be built and tested safely; see
  `docs/ARCHITECTURE.md` §11 for what needs review before going live.

## Disclaimers

This is a research/information tool, not legal, financial, or investment
advice. See `/disclaimers` in the running app and
`app/(marketing)/disclaimers/page.tsx`.
