# ForeclosureData — Architecture

> "We read every foreclosure notice so you don't have to."

> **Read this first: CURRENT vs. FUTURE/PLANNED.** This document was
> written as a target design before most of it was built, and large parts
> of it are still aspirational rather than real. As of this writing:
> - **Built and real:** `apps/web` (Next.js), `packages/database`,
>   `packages/foreclosure-core`, `packages/county-adapters`, the Hidalgo
>   ingestion pipeline (run via GitHub Actions, not a worker app — see §8),
>   Supabase Auth wiring, the billing-provider abstraction (mock active in
>   production; Stripe/Authorize.net exist but are unexercised — see
>   `docs/BILLING.md`).
> - **Described here but NOT built:** `apps/mobile` (Expo) and `apps/worker`
>   (a standalone background job runner) do not exist in the repo at all.
>   There is no `ProcessingJob` queue runner anywhere — `ProcessingJob` is a
>   schema model with zero execution code. Everything §8 attributes to
>   "apps/worker" is, in reality, either a Next.js API route in `apps/web`
>   or the GitHub Actions workflow in `.github/workflows/`.
> - Sections below are left as originally written (they're still the right
>   target design in most cases) but are marked **[PLANNED]** inline
>   wherever they describe something not yet built, so this file stays
>   useful without silently misrepresenting the current system. See
>   `docs/DEPLOYMENT.md` for what's actually deployed today.

## 1. What this is

ForeclosureData turns Texas county foreclosure-sale notices (PDFs,
scanned legal documents) into a structured, searchable database of
upcoming foreclosure-sale properties. Initial market: **Hidalgo County,
TX**. Architecture supports scaling to all 254 Texas counties (per-county
`CountyForeclosureAdapter` plugins) and to a native mobile app on top of
the same backend.

This is a **monorepo**, deployed independently from the Merchant1
Solutions marketing site that lives elsewhere in this repository. It
shares no code, database, or runtime with that site.

## 2. Guiding constraints

- Target subscription price is **~$5/month** → infrastructure and AI spend
  must be tiny per user. Modular monolith + single Postgres + DB-backed
  job queue, deterministic-extraction-first, aggressive caching/dedup.
- **One backend, two front ends.** Web (Next.js) and mobile (Expo) are
  different UIs over the *same* Supabase Postgres database, the same auth
  users, the same entitlements, and the same API contracts. No foreclosure
  processing logic is duplicated between them — it lives once, in
  `packages/foreclosure-core` and `apps/worker`.
- **Never fabricate data.** Every important field carries a source type
  and, where applicable, a confidence score. Unknown stays unknown.
- **AI is the last resort.** Deterministic parsers run first; a
  structured-JSON AI call only fires when deterministic extraction is
  incomplete, and its output is Zod-validated before touching the database.
- **The backend is the source of truth for entitlements.** Neither web nor
  mobile ever decides what a user can see based on a client-held flag.

## 3. Monorepo layout

```
foreclosuredata/
  apps/
    web/        Next.js 14 (App Router), responsive + PWA, the primary product -- BUILT, real
    mobile/     [PLANNED, NOT BUILT] Expo Router app (iOS/Android), auth + read/save flows only
    worker/     [PLANNED, NOT BUILT] Background job runner: discovery, download, extraction, OCR,
                resolution, dedup, cancellation checks, cost tracking -- today this all
                runs as apps/web API routes + apps/web/scripts/ci-ingest-hidalgo.mts,
                invoked by .github/workflows/hidalgo-ingestion.yml (manual dispatch only)
  packages/
    database/          Prisma schema (source of truth for tables), RLS SQL,
                        seed script, generated client — imported by web + worker
    validation/         Zod schemas: filters, entitlements, notification prefs,
                        correction reports, API request/response shapes
    types/              Cross-cutting TS types with no runtime deps
                        (BillingStatus, NotificationEvent, FieldSourceType, ...)
    config/              Design tokens (typography/spacing/radius/status labels)
                        shared by web and mobile UIs
    auth/                Supabase client helpers (browser/server/mobile) +
                        entitlement resolution service
    county-adapters/     CountyForeclosureAdapter interface + per-county plugins
                        (Hidalgo fixture-based mock adapter for MVP)
    foreclosure-core/    Deterministic extraction, AI-extraction fallback,
                        address resolution, balance estimation, summary
                        generation — pure business logic, used only by the worker
    api-client/          Typed fetch wrapper over the web app's API routes;
                        used by both apps/web (client components) and apps/mobile
  docs/
  docker-compose.yml     Local Postgres for Prisma/dev (Supabase-compatible)
```

Package manager: **pnpm workspaces**. Task runner: **Turborepo**
(`turbo run dev|build|test|lint|typecheck`, cached and parallelized).

## 4. System diagram

```
        ┌────────────────────┐        ┌─────────────────────────┐
        │   apps/web (Next.js) │        │  apps/mobile (Expo)      │
        │  Server Components   │        │  Expo Router screens     │
        │  + API route handlers│        │  packages/api-client ───┼──┐
        └──────────┬───────────┘        └────────────┬─────────────┘  │
                   │  packages/database (Prisma)      │ HTTPS (same    │
                   │  packages/auth (Supabase server)  │ API contracts)│
                   ▼                                   ▼               │
        ┌─────────────────────────────────────────────────────┐       │
        │            apps/web API routes (/api/*)                │◀──────┘
        │  entitlement checks, RLS-respecting Supabase calls,    │
        │  Prisma queries for foreclosure/property data           │
        └───────────────────────┬─────────────────────────────────┘
                                │
                                ▼
        ┌─────────────────────────────────────────────────────┐
        │              Supabase (single backend)                │
        │  Postgres (RLS enabled) · Auth (GoTrue) · Storage      │
        └───────────────────────┬─────────────────────────────────┘
                                ▲
                                │ Prisma (service-role connection)
                                │
        ┌─────────────────────────────────────────────────────┐
        │                   apps/worker                          │
        │  county-adapters → foreclosure-core → database          │
        │  DISCOVER → DOWNLOAD → HASH → EXTRACT → (OCR) →         │
        │  DETERMINISTIC → [AI] → RESOLVE_ADDRESS → SUMMARIZE →   │
        │  RECHECK (cancellation/postponement)                    │
        └─────────────────────────────────────────────────────┘

        Stripe ⇄ apps/web (Checkout, Billing Portal, verified webhook)
                 via BillingProvider abstraction (see §9)
```

Web and mobile **never** run ingestion/extraction/OCR/AI code directly —
only `apps/worker` does. Both apps talk to Postgres exclusively through
`apps/web`'s API routes (mobile has no direct DB credentials at all;
web's server side uses Prisma with a service-role DB connection, applying
its own authorization checks in addition to RLS).

## 5. Auth (Supabase) & authorization

- Supabase Auth (GoTrue) issues sessions for both web and mobile — email +
  password, password reset, email verification, out of the box.
- `packages/auth` exposes:
  - `createSupabaseBrowserClient()` — used in web client components and,
    via a thin RN-specific wrapper, in the mobile app (with
    `expo-secure-store` as the session storage adapter — secure, persistent
    login on device).
  - `createSupabaseServerClient()` — used in web server components/route
    handlers, reads/writes the auth cookie via `@supabase/ssr`.
  - `resolveEntitlement(userId)` — the **one** function anything in the
    backend calls to find out what a user is allowed to do. It reads
    `Subscription` + `PlanConfig` from Postgres (via Prisma/service role),
    never a client-supplied flag. See §8.
- `apps/web/middleware.ts` refreshes the Supabase session and redirects
  unauthenticated requests away from protected route groups; every
  server-side data access **also** re-checks the session server-side
  (defense in depth — the UI check is not the authorization boundary).
- A `Profile` table (`id` = the Supabase `auth.users.id`) carries app-level
  fields (`role: USER | ADMIN`, display name). Admin route groups check
  `profile.role === 'ADMIN'` server-side on every request, not just at
  the middleware layer.

### Row Level Security

RLS is enabled on every table in `packages/database/sql/rls.sql`:

- **User-owned tables** (`SavedProperty`, `CorrectionReport`,
  `NotificationPreference`, `ExportJob`): policy restricts
  `SELECT/INSERT/UPDATE/DELETE` to `auth.uid() = user_id`, with a
  separate admin-bypass policy (`profiles.role = 'ADMIN'`) for support/
  moderation.
- **Foreclosure/property domain tables** (`Property`, `ForeclosureCase`,
  `ForeclosureSale`, `Loan`, `SourceDocument`, …): `SELECT` is allowed
  broadly (read-only, no `auth.uid()` restriction) since this is public-
  record data; `INSERT/UPDATE/DELETE` is restricted to the service role
  (the worker and admin actions only). RLS does not do column-level
  masking, so **field-level plan gating (e.g. hiding enriched fields on
  the free tier) is enforced in the API route handler**, using
  `resolveEntitlement()` — RLS is the database-level backstop, the API
  layer is the product-level enforcement.
- Prisma's own connection uses the Postgres service role (required for
  migrations and for the worker's write-heavy workload) — RLS's primary
  value in this architecture is protecting any future direct-from-client
  Supabase queries (e.g. if the mobile app ever reads a public table
  directly with the anon key) and guarding the Supabase Studio/SQL
  console against accidental cross-tenant writes.

## 6. Entitlements (never trust the client)

`packages/auth`'s `resolveEntitlement(userId)` returns:

```ts
interface Entitlement {
  plan: "FREE" | "PAID";
  availableCounties: string[] | "ALL";
  maxSavedProperties: number;
  canExportCsv: boolean;
  monthlyCsvExportLimit: number;
  csvExportsUsedThisMonth: number;
  canViewDocuments: boolean;
  canReceiveAlerts: boolean;
  canViewRecordHistory: boolean;
}
```

Every API route that returns foreclosure data, accepts a save, or starts
an export calls this first and filters/denies server-side. Web and mobile
render UI based on the entitlement the *server* returned with the payload
— not a locally cached assumption — and the server re-derives it on every
mutating request rather than trusting a value the client echoes back.

## 7. Shared API contract (`packages/api-client`)

A typed client, backed by Zod schemas in `packages/validation`, that both
`apps/web` (client components) and `apps/mobile` import:

- `listForeclosures(filters)` / `getForeclosure(id)`
- `searchProperties(query)`
- `saveProperty(id)` / `unsaveProperty(id)`
- `getCountyAvailability()`
- `reportCorrection(payload)`
- `getEntitlement()`
- `getNotificationPreferences()` / `updateNotificationPreferences(prefs)`

Every request/response is parsed through the shared Zod schema before the
caller sees it — a malformed API response fails loudly in dev rather than
producing a silently wrong UI.

## 8. Ingestion pipeline [PLANNED shape -- see note below for what's actually built]

> The step sequence below is still the right conceptual model. What's
> different in reality: there is no `apps/worker` process running this as a
> long-lived job queue. Today, `apps/web/lib/ingestion/ingestForeclosureNotices.ts`
> implements this sequence directly, invoked either by an internal API route
> (secret-gated) or by `apps/web/scripts/ci-ingest-hidalgo.mts` running inside
> the GitHub Actions workflow -- not a `ProcessingJob` queue being drained by
> a background worker. `ProcessingJob` remains a schema model with no
> execution code anywhere. Steps 4 (dedup) and 9-10 (address resolution,
> manual review) are real and match this description; step 12 (cancellation/
> postponement recheck) is not yet implemented.

1. `discoverNotices()` (county adapter) lists notices in a date range.
2. Persist `SourceDocument` metadata if not already known by source URL.
3. `downloadNotice()` fetches the PDF via the adapter, stored via
   `StorageAdapter`.
4. SHA-256 hash. Existing hash → mark `DUPLICATE`, stop (idempotency).
5. Extract embedded PDF text; OCR only pages lacking usable text.
6. Normalize text, detect language.
7. **Layer 1 (deterministic)** parsers populate `ExtractedField` rows.
8. **Layer 2 (AI, conditional)** only for fields Layer 1 left null/low
   confidence, gated by the monthly budget; strict Zod-validated response.
9. Address resolution (8-step sequence) writes `PropertyAddress`
   candidates with confidence + explanation.
10. Low-confidence / conflicting / unresolved → `ManualReviewTask`.
11. Plain-English summary generated once, cached on
    `ForeclosureCase.summaryText`.
12. `RECHECK_NOTICE` jobs detect cancellation/postponement, attaching to
    the *same* `ForeclosureCase` — never a new `Property`.

## 9. Billing — provider abstraction

```ts
interface BillingProvider {
  getCustomerStatus(userId: string): Promise<BillingStatus>;
  createCheckoutSession(userId: string, planId: string): Promise<CheckoutSession>;
  cancelSubscription(userId: string): Promise<void>;
}
```

`StripeBillingProvider` (in `apps/web/lib/billing`) is the only
implementation in this MVP, used exclusively from web (Stripe Checkout +
Billing Portal + a signature-verified webhook that updates `Subscription`
in Postgres). Mobile never talks to Stripe directly — it calls
`getEntitlement()` and, if upgrade is needed, deep-links to the web
checkout flow. The interface exists so that an `AppStoreBillingProvider`
/ `PlayBillingProvider` can be added later, behind the same contract,
without changing any code that currently calls `BillingProvider`.

## 10. Notifications (model now, delivery later)

A platform-neutral `NotificationEvent` (`NEW_MATCHING_PROPERTY`,
`ADDRESS_RESOLVED`, `SALE_DATE_CHANGED`, `SALE_CANCELED`,
`SAVED_PROPERTY_REMINDER`, `UPCOMING_AUCTION_REMINDER`) and a
`NotificationPreference` row per user (channel toggles: email / web push /
Expo push) live in `packages/database` + `packages/types`. In this MVP,
events are recorded but delivery adapters (`EmailNotifier`,
`WebPushNotifier`, `ExpoPushNotifier`) are stubs behind one
`NotificationDelivery` interface — wiring a real provider later touches
only the adapter, not the event model or the schema.

## 11. Deep linking [PLANNED -- `apps/mobile` does not exist]

Canonical property URL: `https://app.foreclosuredata.com/property/{propertyId}`.
This always works in a browser today. The mobile-app half of this section
(`apps/mobile/app.json`, universal links, Expo Router's dynamic route) is
unbuilt -- there is no mobile app for it to apply to yet.

## 12. PWA (web)

`apps/web/public/manifest.webmanifest` (standalone display, theme/background
color, icon set), a minimal service worker (`public/sw.js`) providing an
offline fallback page and the registration hook needed for future web-push,
and installability meta tags in the root layout. Full offline foreclosure
data is explicitly out of scope for this release — only the app shell/
fallback is cached.

## 13. What's mocked vs. real (updated to current status; §s above still describe the original slice-by-slice plan)

| Area | Actual current status |
|---|---|
| Hidalgo discovery | **Real.** `packages/county-adapters`'s Hidalgo sitemap adapter fetches Hidalgo's actual sitemap.xml and downloads real bundled PDFs. Not a fixture. Note: the sitemap typically exposes only the current/upcoming month's bundle, no backlog. |
| Hidalgo appraisal-district (CAD) lookup | **Real.** `HidalgoCountyAppraisalAdapter`/`hidalgoCadClient.ts` call Hidalgo's actual public ProdigyCAD-based property search, with a per-notice request budget and rate limiting. |
| OCR | **Real.** Tesseract.js, invoked per-page only where embedded text is unusable. |
| AI extraction | **Real, tightly capped.** Anthropic API, gated to fields deterministic extraction leaves unresolved, with a hard per-run cost/call ceiling enforced in the GitHub Actions workflow inputs (defaults: 10 calls, $1.00 USD). |
| Object storage | Still local filesystem `StorageAdapter` -- not yet moved to Supabase Storage/S3. |
| Geocoding | Still interface + stub -- no real geocoding provider wired in. |
| Supabase project | Real, live project used for auth; application data lives in a separate Netlify DB (Neon) Postgres instance, not Supabase's. |
| Push notification delivery | Still model + preferences stored, adapters are stubs. |
| Billing | `BILLING_PROVIDER=mock` active in production. Stripe implementation exists as a fallback; Authorize.net implementation exists but "not yet exercised against a live sandbox" per its own code comment. |
| Scheduled/automatic ingestion | Explicitly **not enabled** -- `workflow_dispatch` only, no `schedule:` trigger, by deliberate choice pending accuracy validation on fresh (never-before-processed) notices. |

## 14. Unknowns / external dependencies -- status update

The original open questions from this section, with what's actually been
resolved:

- Hidalgo County's notice-posting site structure, robots.txt, and terms of
  use — **reviewed**; the real adapter (§13) was built against those
  findings.
- Whether the Hidalgo Appraisal District exposes a public search — **yes**,
  a public ProdigyCAD-based search exists and is used (§13). Whether this
  pattern holds for *other* counties is unconfirmed — `docs/COUNTY_ROADMAP.md`'s
  per-county checklist requires re-verifying this for each new county, not
  assuming it.
- Rate-limit-safe polling cadence — addressed for now by *not* polling
  automatically at all (manual dispatch only); a real cadence decision is
  deferred until scheduling is turned on.
- OCR/geocoding vendor choice — OCR is decided (Tesseract.js); geocoding
  remains unresolved/unstubbed.

Tracked in `docs/BACKLOG.md`.
