# Deployment

> Rewritten after the production-database-wipe incident of 2026-08-08 to
> describe what is actually deployed, not an earlier plan. See "Production
> deploy rules" and "Data migration rules" below before touching production
> in any way that changes schema or data.

## Actual current setup

- **App hosting:** Netlify (`foreclosuredata-app`), Next.js 14 App Router
  build via `@netlify/plugin-nextjs`. Deploys are triggered manually
  (upload-based, via the Netlify MCP/CLI tooling), not on every git push —
  there is no CI/CD pipeline building on merge.
- **Database:** Netlify DB — Netlify's managed Postgres offering, backed by
  Neon, reached via the `DATABASE_URL`/`DIRECT_URL` env vars set directly
  on the Netlify site (not auto-resolved at runtime; see "DATABASE_URL
  precedence" below for why that distinction matters).
- **Auth:** Supabase Auth (`packages/auth`, `@supabase/ssr`) — a *separate*
  Postgres project from the one above, used only for authentication, not
  for application data.
- **Billing:** `BILLING_PROVIDER=mock` in the live site config — no real
  payment provider is currently active in production. Stripe and
  Authorize.net implementations exist in code but are not exercised
  end-to-end against a live gateway (see `docs/BILLING.md`).
- **Heavy ingestion (PDF rendering, barcode detection, OCR, extraction,
  property resolution):** a GitHub Actions workflow
  (`.github/workflows/hidalgo-ingestion.yml`), `workflow_dispatch` only —
  **no `schedule:` trigger exists**, so nothing runs automatically. This
  moved out of Netlify Functions because it needs native/WASM tooling
  (Tesseract in particular) that doesn't fit a serverless bundle.
- **Background job queue:** does not exist. `ProcessingJob` is a schema
  model with no execution code anywhere in the repo. All real execution
  today is either a Next.js API route or the GitHub Actions script above.

## Environment variables

See `.env.example` for the full, current list and inline documentation.
There is no single "minimum for a working deploy" list worth maintaining
here separately — `.env.example` is the source of truth and is kept
up to date with what each variable actually gates.

## Local development

```bash
cd foreclosuredata
cp .env.example .env
docker compose up -d          # local Postgres on 5433
pnpm install
pnpm db:push
ALLOW_DESTRUCTIVE_SEED=true pnpm db:seed   # see "Seeding" below
pnpm dev
pnpm test
```

## Seeding

`packages/database/prisma/seed.ts` deletes existing Hidalgo foreclosure
data (`wipeHidalgoCases()`) before reseeding from
`packages/database/prisma/hidalgo-real-cases.ts`. It is protected by two
independent layers:

1. **The production build never calls it.** `netlify.toml`'s build command
   runs `db:push` (schema only) and nothing else against the database —
   `db:seed` is not part of the build at all.
2. **The script itself refuses to run without explicit opt-in**
   (`packages/database/src/seedGuard.ts`, tested in
   `packages/database/test/seedGuard.test.ts`):
   - `ALLOW_DESTRUCTIVE_SEED=true` is required in every environment,
     including local dev.
   - `ALLOW_DESTRUCTIVE_SEED_IN_PRODUCTION=true` is ALSO required, on top
     of the flag above, in any environment that looks production-like
     (`NODE_ENV=production` or Netlify's `CONTEXT=production`).

Never set `ALLOW_DESTRUCTIVE_SEED_IN_PRODUCTION=true` without reading the
incident section below first, and only with a confirmed, recent database
snapshot/restore point available.

## Production deploy rules

These exist because of a real incident (below), not as generic best
practice — treat them as load-bearing.

- **Never seed production.** See "Seeding" above. If a deploy's build log
  ever shows `db:seed` running against the real site, stop and treat it as
  an incident, not a warning.
- **Never run destructive cleanup (archive/merge/delete of cases,
  properties, or documents) without explicit human confirmation of the
  affected row IDs first.** A dry-run report showing exactly what would
  change is required before any such operation executes for real.
- **Verify which database a deploy is targeting before trusting a schema
  change.** The build now prints the schema-migration target host and
  database name (never credentials) — confirm it matches the real
  production host before assuming a `db push` result applies where you
  think it does. This check exists because of the exact opposite failure
  once already (see incident below).
- **Run dry-run first for any data migration** that moves, merges, or
  deletes existing rows — no exceptions, regardless of how confident the
  logic is believed to be.
- **Confirm backup/PITR availability before any destructive or
  data-rewriting operation.** Netlify DB (Neon-backed) takes an automatic
  snapshot on every publish (`database_snapshots` in the deploy metadata,
  `source: "on-publish"`) — confirm a recent one exists, and check the
  Neon/Netlify DB dashboard for the actual retention window before relying
  on it (this repo's tooling cannot query that retention window
  programmatically as of this writing).
- **Bounded ingestion only, until scheduling is explicitly approved.** The
  GitHub Actions workflow has no `schedule:` trigger by design — do not add
  one without a separate, explicit decision to do so, and only after
  fresh-data accuracy has been validated (see `docs/BACKLOG.md`).
- **No production secrets in logs.** Build output may print a database
  *host and database name* for verification purposes; it must never print
  a full connection string, API key, or credential. Review any new build
  diagnostic output against this before merging.

## Data migration rules

For any future destructive or data-rewriting operation against production
(archiving duplicates, backfilling a column, correcting bad enrichment,
etc.), follow this sequence — every step, every time:

1. **Inspect current row counts** for every table the operation touches,
   via a read-only diagnostic route or query. Record the numbers.
2. **Create/confirm a recovery point** — verify a recent database
   snapshot/backup exists (see "Backup & recovery" below) before proceeding.
3. **Run a dry-run** that reports exactly what the operation *would* do —
   affected row IDs, before/after values, what gets preserved vs. archived
   vs. deleted — without writing anything.
4. **Review the affected IDs** with a human before executing. Do not
   proceed on an agent's own judgment alone for anything destructive.
5. **Execute a bounded change** — never an unbounded "fix everything at
   once" operation against production.
6. **Verify counts/invariants** immediately after — re-run the same
   read-only check from step 1 and confirm the change matches what the
   dry-run predicted, nothing more.
7. **Write an audit log entry** (`AuditLog` — action, entity, before/after
   JSON, timestamp) for every row changed this way, so there is a durable
   record independent of application logs.

## Backup & recovery

- Netlify DB (Neon-backed Postgres) takes an automatic snapshot on every
  successful publish — confirmed directly in deploy metadata
  (`database_snapshots.snapshots[].source === "on-publish"`). This is a
  real, observed behavior, not documentation-only.
- **What is not yet confirmed:** the actual retention window for these
  snapshots, whether older snapshots roll off automatically, and the exact
  point-in-time-recovery mechanism Neon exposes for this specific project's
  plan tier. None of this is queryable through the tooling available to an
  agent working in this repo — **check the Netlify DB / Neon dashboard for
  this project directly** (Netlify site → Extensions/Database → Neon) for:
  - Whether point-in-time recovery is enabled and its retention window.
  - The list of available snapshots/branches and their timestamps.
  - Whether a restore can be tested into a *new* branch without touching
    the live production branch (Neon generally supports this via
    branching — confirm for this project specifically before relying on
    it).
- **Recommended recovery procedure once a snapshot/branch is identified:**
  restore into a new, separate branch first, verify its data there, and
  only then decide whether/how to promote it — never restore directly
  over the live production branch as a first step.
- Source documents are content-addressed by SHA-256
  (`SourceDocument.sha256Hash`) for provenance/change-detection — this is
  not a backup mechanism, but it does mean a lost raw PDF can potentially
  be re-fetched from the original county source URL if still available.
- Treat `ForeclosureCase`, `Property`, `Loan`, `AppraisalPropertyCandidate`,
  `AppraisalValueHistory`, `ManualReviewTask`, and `AuditLog` as the
  primary data worth protecting — they represent processing work and
  human review decisions that cannot be cheaply regenerated.

## The 2026-08-08 production database wipe — what happened and what changed

Documented here deliberately, not just in a commit message, so this
context survives independent of git archaeology.

**What happened:** `netlify.toml`'s build command computed a fallback
database URL via `@netlify/database` and unconditionally overwrote an
already-correctly-configured `DATABASE_URL` with it, pointing schema
migrations (`prisma db push`) at a *different* database host than the one
the live app actually runs against. This went undetected for an unknown
period — production's schema had been silently drifting behind what the
code expected. Fixing that precedence bug correctly redirected `db push`
*and* the build's `db seed` step (which unconditionally wipes and reseeds
Hidalgo data) at the real production database for the first time — and
`db seed` then wiped real, accumulated production data (duplicate-notice
history, live CAD-resolution results, a manually-audited enrichment repair,
and manual-review task history) down to the static 82-case seed baseline.

**What changed as a direct result** (see git history around commit
`b069a72` and the schema `@@unique([countyId, countyFilingNumber])`
re-enablement):
- The production build no longer runs `db:seed` at all.
- `seed.ts` refuses to run destructively without two independent,
  explicitly-named opt-in flags (see "Seeding" above).
- `DATABASE_URL` precedence is fixed: the build only falls back to an
  auto-resolved URL when `DATABASE_URL` is unset, never overwrites one
  that's already configured.
- `db push` failure now genuinely fails the build (it previously did not,
  due to a separate shell-precedence bug: `db:push && db:seed || true`
  parsed as `(db:push && db:seed) || true`, silently swallowing a push
  failure).
- The build prints its schema-migration target host/database name (never
  credentials) so a human can verify which database is being touched.
- The "Production deploy rules" and "Data migration rules" sections above
  exist directly because of this incident.

**What is still open as of this writing:** whether the pre-wipe data is
recoverable via a Neon snapshot/branch has not been confirmed — see
"Backup & recovery" above for exactly what to check.

## Monitoring (MVP-appropriate, not enterprise APM)

- Admin dashboard (`/admin`) surfaces manual review queue and county
  source health.
- No automated uptime/error alerting exists yet. Adding a simple external
  uptime check (e.g. a free UptimeRobot monitor) against the production
  URL is a cheap, currently-missing improvement — see `docs/BACKLOG.md`.
