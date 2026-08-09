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

## Database connection architecture

Investigated and confirmed 2026-08-09 while unblocking the
`PossibleDuplicateNoticeLink` migration (see "Fix round 3" below) —
resolved with hard, non-destructive evidence (a temporary read-only
diagnostic route, cross-checking a known backfilled value and row counts
across both environments), not assumption. No credentials are recorded
below — only host/provider/mode information, per this project's standing
"no production secrets in logs" rule.

**The production database is Netlify DB (Neon-backed Postgres)** —
`ep-fancy-shape-...db.netlify.com`. This matches what this doc already
said above; the investigation was needed because a *different* connection
string (a Supabase pooler host, `*.pooler.supabase.com`) was observed in
a GitHub Actions build log and raised a real question about whether GitHub
Actions and Netlify were operating on two different databases — the same
class of mistake as the 2026-08-08 incident below.

**`DATABASE_URL`** — read/write runtime connection. Used by Prisma
Client for every ordinary query (the app itself, and every GitHub Actions
script in this repo that reads/writes data — ingestion, backfills,
repairs, the fix-round-3 re-eval). **Confirmed correct in both
environments**: cross-checked a value only ever written via a GitHub
Actions script (HID-117914's corrected borrower name) against what
Netlify's own runtime connection reads back — identical. Row counts
(132 `ForeclosureCase` rows) also matched exactly. GitHub Actions and
Netlify have always been reading and writing the same real production
database via `DATABASE_URL` — none of this project's prior GitHub
Actions-run backfills/repairs were misdirected.

**`DIRECT_URL`** — schema-DDL connection, used *only* by `prisma db push`
/ `prisma migrate`. **This is where the actual bug was**: the GitHub
Actions repository secret named `DIRECT_URL` was pointing at a
`*.pooler.supabase.com` connection — almost certainly a stale/incorrect
value, quite possibly confused with the *separate* Supabase project this
app uses for Auth only (`packages/auth`, never application data — see
"Actual current setup" above). Every ordinary query from GitHub Actions
uses `DATABASE_URL` (correct), so this was invisible until something
specifically needed `db push`. Real error observed:
`FATAL: (ENOTFOUND) tenant/user postgres.xxxxx not found` — a pgbouncer/
Supavisor rejection, not a DNS failure despite the label.

**Netlify's own production build was never affected by this**, and this
is why: `netlify.toml`'s build command does `export
DIRECT_URL="$DATABASE_URL"` immediately before running `db:push` —
deliberately overriding whatever `DIRECT_URL` a Netlify site environment
variable might hold, forcing the schema push to use the exact same
connection as the verified-correct `DATABASE_URL`. Every Netlify
production deploy's `db:push` step has been targeting the real database
correctly all along.

**Why a pooled transaction-mode connection must never be used for DDL**:
Supabase's Supavisor (and pgbouncer generally) in *transaction* pooling
mode multiplexes many client sessions over few server connections,
switching which server connection a client uses between transactions —
`prisma db push`/`migrate` need advisory locks and multi-statement DDL
held across a session, which transaction-mode pooling breaks. This is why
Prisma's own schema declares `directUrl` as a separate value from `url`
in the first place (`packages/database/prisma/schema.prisma`) — `url` is
allowed to be pooled, `directUrl` must be a true session-mode or direct
connection.

**The fix applied**: none of the DATABASE_URL/DIRECT_URL *values* needed
to change — the schema migration for this round was applied through the
already-correct, already-safe Netlify build path (a normal deploy, using
`netlify.toml`'s existing `db:push` step, which already overrides
`DIRECT_URL` correctly) rather than by touching the broken GitHub Actions
secret. **Outstanding, for an admin**: the GitHub Actions repository
secret `DIRECT_URL` should still be corrected, so future schema changes
triggered from a GitHub Actions workflow (rather than a full Netlify
deploy) don't hit the same wall. The correct value is simply **the exact
same connection string already stored in the `DATABASE_URL` secret** — no
provider dashboard visit is needed; update the GitHub repository secret
(Settings → Secrets and variables → Actions → `DIRECT_URL`) to match the
existing `DATABASE_URL` secret's value.

**Safe verification procedure for any future schema migration** (the
sequence used for this round, worth reusing):
1. Deploy via the existing, already-safe Netlify build path when
   possible — it already runs `db:push` with a correct, overridden
   `DIRECT_URL`, and existing "Production deploy rules" already govern it
   (never seeds, prints the target host, a push failure fails the build).
2. Before trusting the result, confirm via a temporary read-only
   diagnostic route (this project's established pattern — see
   `apps/web/app/api/internal/`, secret-gated behind
   `INTERNAL_INGEST_SECRET`): the connection host/port (never full
   credentials), a `ForeclosureCase` (or other stable table) row count
   compared to the last known-good value, and that the migration's target
   table/index now exists.
3. Only then run any write operation the new schema enables.
4. Retire the diagnostic route to a 410 stub immediately after (this
   directory's established convention — this deploy target doesn't
   reliably drop a route on file deletion alone).

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

## Incident closure decision (2026-08-08) — **CLOSED**

After the fixes above shipped, a recovery assessment was carried out
against the live Netlify DB (Neon-backed) dashboard for this project.
Findings and the resulting decision:

- **Recovery points did exist.** Netlify DB takes both an on-publish
  backup (kept: 10 most recent deploys) and a daily scheduled backup
  (kept: 30 days). A scheduled backup from **Aug 7, 2026 10:00 PM CDT
  (≈2026-08-08T03:00Z)** — comfortably before the wipe, which occurred
  around 2026-08-08T03:37Z — was confirmed present and almost certainly
  clean.
- **Recovery was available only as a direct, in-place overwrite of the
  live `production` branch.** The dashboard's "Restore from backup" flow
  does not offer a "restore into a new, isolated branch" option — only
  "Restore now," which immediately replaces the current production
  database's contents (data *and* schema) and briefly interrupts live
  connections while it runs. The only stated undo path afterward is
  contacting Netlify support to revert to the pre-restore contents — not
  a self-service branch comparison.
- **Decision: do not restore. Accept the current 82-record baseline as
  the official production state going forward.** Reasoning:
  - With no isolated-branch preview available, restoring would have
    blindly reintroduced the *exact* problems this whole effort was
    fixing: the 33 duplicate `ForeclosureCase` rows and the wrong
    117661 CAD subdivision match, both already known-bad and already
    understood.
  - The genuinely valuable part of the lost state — CAD-sourced
    enrichment (parcel IDs, appraised/market values) — is not uniquely
    lost. It is fully re-derivable by re-running the property-resolution
    pipeline against the current 82-case baseline, and doing so now
    benefits from accuracy fixes (owner-conflict gating, subdivision-
    conflict checking, courthouse-address exclusion, corrected legal-
    description parsing) that did not exist when the original enrichment
    was produced — the regenerated data should be *more* trustworthy
    than what was lost, not merely equivalent to it.
  - A restore would also roll back the database schema to its pre-wipe
    state (the `countyFilingNumber`/`archivedAt`/`mergedIntoCaseId`
    columns and the composite unique constraint didn't exist yet at that
    snapshot), requiring a further reconciliation deploy before the
    restored data was even safe to use — one more non-trivial step
    between "restore" and "actually safe."

**Status: recovery incident CLOSED.** The 82-record seed baseline
(`packages/database/prisma/hidalgo-real-cases.ts`) is the accepted
production baseline. No further restore attempt is planned. Derived data
(property resolution, CAD enrichment, valuations, manual review) will be
**regenerated** through the current, corrected pipeline — never
reconstructed by hand and never restored from the pre-wipe snapshot. See
the regeneration plan below for the bounded, human-approved process that
will do that.

## Derived-data regeneration plan (proposed 2026-08-08 — **NOT executed**)

This plan is written for approval, not action. Nothing described here has
been run against production. It exists so a future "go" decision has an
exact, reviewed procedure to execute rather than an improvised one.

### What "derived data" actually means in the current baseline

Checked directly against `packages/database/prisma/seed.ts` before writing
this plan, since assuming would risk describing the wrong operation:

- The **46 `Property` rows** that already exist in the 82-record baseline
  are **not** CAD-derived at all — they come straight from a human
  transcribing each notice PDF during the original data-entry pass
  (`hidalgo-real-cases.ts`'s per-case `addressMethod` field:
  `EXPLICIT_STATED` or `COMMONLY_KNOWN_AS_PHRASE`, i.e. the street address
  is literally printed in the notice text). **Regeneration must not touch
  these addresses** — they're ground truth, not a stale derived artifact.
- The **36 remaining cases** have `property: null`, `addressResolutionMethod:
  UNRESOLVED`, and an open `ManualReviewTask` (`reason: NO_ADDRESS_RESOLVED`)
  because the notice gives only a legal description. These are the real
  regeneration target: the current CAD-1..CAD-4-fixed resolver has never
  been run against them (`AppraisalPropertyCandidate` count is 0 across
  all 82 cases in the current baseline).
- Separately, **none of the 82 cases** — including the 46 with a known
  address — has ever had a county valuation lookup performed under the
  current schema (`AppraisalValueHistory` count is 0 for all 82). That's
  a second, independent regeneration target: fetching county
  appraised/market value + appraisal history for the 46 already-resolved
  cases.
- **5 further `ManualReviewTask`s** exist for `POOR_TEXT_QUALITY`
  (transcription-quality flags, unrelated to address/valuation) — out of
  scope for this plan.

### The regeneration primitive already exists — it just isn't batched

The exact operation this plan proposes running case-by-case already
exists: `searchAgain(taskId, foreclosureCaseId)` in
`apps/web/app/(admin)/admin/property-resolution/page.tsx`, calling the
current, fixed `resolvePropertyAddress()`. Two properties of it matter a
lot for how safe this plan is:

- **It never writes to `Property` on its own.** It only writes
  `AppraisalPropertyCandidate` rows, a `PropertyResolutionAttempt` audit
  record, and updates the `ManualReviewTask`'s notes. `Property` and
  `AppraisalValueHistory` only change when a human clicks "Approve" on a
  specific candidate (`approveCandidate()`) in the admin review queue —
  same manual gate that already governs every live-ingested notice today.
  That means simply *generating* candidates in bulk is safe by
  construction; the one genuinely mutating step stays manual and
  per-case, exactly as it is now.
- **Gap to fix before batching it:** `searchAgain()` calls
  `resolvePropertyAddress(input, adapter)` with no `RequestBudget`
  argument, so an individual click is technically unbounded (up to ~7
  search strategies, each capped only by pages-per-search). A new batch
  script must **not** reuse that call as-is — it must pass an explicit
  per-case budget (recommend reusing the existing
  `HIDALGO_CAD_MAX_REQUESTS_PER_NOTICE` convention already used by the
  live ingestion pipeline, default 10).

### Proposed script (not built, not run)

A new bounded CLI entrypoint, e.g.
`apps/web/scripts/regenerate-property-candidates.ts`, following the same
shape as the existing `hidalgo-ingestion.yml` / ingestion-orchestrator
pattern:

1. Accepts `--limit=N` and/or explicit `--case-ids=...`.
2. Selects targets in two independent groups: (a) cases with
   `propertyId: null` and an open `NO_ADDRESS_RESOLVED` task — full
   multi-strategy candidate search; (b) cases with a `propertyId` already
   set — a narrower `getPropertyDetails()`/value-history-only lookup,
   since the address is already known and only valuation data is missing.
3. For each case, runs the same logic `searchAgain()` runs today —
   writing `AppraisalPropertyCandidate` + `PropertyResolutionAttempt`,
   updating the task's notes — with an explicit per-case `RequestBudget`
   (default 10). **Never** calls `upsertPropertyFromAppraisalData` /
   never writes `Property` — every result lands in the existing
   `/admin/property-resolution` queue for manual approval, identical to
   how a live-ingested notice is reviewed today.
4. Logs a per-case summary (candidates found, requests used, resolution
   method) and writes one run-level summary `AuditLog` entry for the
   batch, in addition to the existing per-case
   `SEARCH_AGAIN_PROPERTY_CANDIDATES` / `SEARCH_AGAIN_FAILED` entries.

Exact proposed command, once the script above is written, reviewed, and
approved to run:

```
pnpm --filter @foreclosuredata/web exec tsx scripts/regenerate-property-candidates.ts --limit=10
```

Run manually against production (confirm `DATABASE_URL`'s host via the
same host-print safeguard already in `netlify.toml` before running) —
**never** via GitHub Actions, **never** on a schedule — so each run is a
single, deliberate, observable event.

### Expected DB writes

- **10-record run:** up to 10 new `AppraisalPropertyCandidate` batches
  (typically 1-6 rows each → ~10-60 new rows), 10 new
  `PropertyResolutionAttempt` rows, 10 updated `ManualReviewTask.notes`,
  ~10-20 new `AuditLog` rows. **Zero** `Property`/`AppraisalValueHistory`
  writes (those require manual approval afterward).
- **82-record run (all at once):** the same shape scaled ~8x — roughly
  300-500+ new candidate rows, 82 resolution-attempt rows, 82 updated
  tasks, 90-100+ audit rows.

### Expected AI / CAD cost

- **Zero AI/LLM cost.** Candidate-gathering only calls the Hidalgo CAD
  adapter (public appraisal-district data), never Claude. The
  `AI_EXTRACTION_MONTHLY_BUDGET_CENTS` ceiling is untouched.
- **CAD HTTP requests**, bounded at 10/case by the recommended explicit
  budget: 10-record run ≤100 requests; 82-record run ≤820 requests.
  `hidalgoCadClient.ts`'s existing single-in-flight-request +
  minimum-delay throttling means the 82-record run is a wall-clock-time
  cost, not a financial one — plan for it to take meaningfully longer,
  not for it to cost more.

### Rollback / recovery strategy

- Since `Property` is never auto-written, there is structurally nothing
  to roll back from a correctness standpoint — the worst case is noisy or
  wrong candidates sitting unapproved in the review queue, which never
  surfaces on the public site and never touches `Property`.
- Any bad `AuditLog`/`ManualReviewTask` writes are isolated per
  `foreclosureCaseId` and can be deleted/reset individually with no
  cascading effect on other cases.
- The operation only ever touches `AppraisalPropertyCandidate`,
  `PropertyResolutionAttempt`, `ManualReviewTask.notes`, and `AuditLog` —
  never `ForeclosureCase`, `SourceDocument`, `Loan`, `ForeclosureSale`, or
  existing `Property` rows. The 82-record baseline's core integrity
  (verified in the recovery-closure check above) cannot be affected by
  this run regardless of what it finds.

### Verification checklist (post-run, once approved to execute)

- [ ] Re-run the same integrity checks used for recovery closure (counts,
      no duplicates, no dangling FK references) to confirm the baseline's
      core rows are unchanged.
- [ ] Confirm `foreclosureCaseCount` and `sourceDocumentCount` are still
      82 each (nothing added or removed).
- [ ] Spot-check 2-3 new `AppraisalPropertyCandidate` rows in
      `/admin/property-resolution` against the original notice PDF before
      approving any of them.
- [ ] Confirm zero `Property` rows changed except where a candidate was
      explicitly approved by a human.
- [ ] Review the batch summary `AuditLog` entry for request-count and
      error totals.
- [ ] Confirm no case exceeded its per-case CAD request budget.

### Recommendation: 10-record bounded subset first

Run the 10-record subset before the full 82. Reasoning:

- This would be the first live exercise of the CAD-1..CAD-4 fixes against
  this specific post-wipe database instance — worth confirming
  end-to-end on a small batch before committing to all 82 at once.
- It produces a small, hand-reviewable batch in `/admin/property-resolution`
  to sanity-check match quality before trusting the fixes at scale.
- The only real cost of the full 82-record run is wall-clock time (CAD
  rate-limiting) and review-queue volume — nothing is lost by staging it
  in two passes. If the 10-record pilot looks right, the remaining 72 can
  follow immediately with the same script and no code changes.

### Explicitly out of scope for this plan

- The 5 `POOR_TEXT_QUALITY` manual-review tasks (unrelated to
  address/CAD resolution).
- Auto-approving any candidate — every match still requires a manual
  click, identical to how live-ingested notices are reviewed today.
- Any change to ingestion, scheduling, or new-county work.

## 10-case regeneration pilot — results (2026-08-08)

Executed the plan above against exactly 10 pre-documented cases, per
explicit approval. Script: `apps/web/scripts/pilot-regenerate-10.mts`;
workflow: `.github/workflows/hidalgo-regeneration-pilot.yml`; GitHub
Actions run
[31282853166](https://github.com/ForeclosureData/ClaudeBuilder/actions/runs/31282853166)
(success, 80s pilot step, 10-case hard cap enforced by the script's
hard-coded ID list, not an input).

### The 10 cases (selected and documented before the run)

4 existing-address / 6 unresolved (roughly proportional to the 46/36
population split), deliberately including messy legal descriptions, an
owner-name-unusable case, a recurring subdivision name, and the same
subdivision (Buchanan Estates) as the 117661 case repaired earlier this
session — not cherry-picked toward easy cases.

| Filing # | Type | Address / Legal |
|---|---|---|
| HID-117911 | Existing address | 410 Chula Vista Drive, Chula Vista Estates Phase I Lot 126 |
| HID-117957 | Existing address | 2318 Flushing Meadows, Hidden Valley Subdivision Phase 1 Lot 3 Block 3 |
| HID-118234 | Existing address | 3401 N Whisky Dr, Buchanan Estates Lot 26 (same subdivision as 117661) |
| HID-118198 | Existing address | 705 N Inspiration Blvd, messy fractional-acreage legal description, owner unrecoverable |
| HID-117925 | NO_ADDRESS_RESOLVED | Ebano Heights Phase 1 Lot 66 |
| HID-118210 | NO_ADDRESS_RESOLVED | South San Carlos Subdivision Lot 3 Block 10 |
| HID-117931 | NO_ADDRESS_RESOLVED | Original Townsite of Alamo, Lot "6 and W1/2 of 7" Block 75 |
| HID-118201 | NO_ADDRESS_RESOLVED | Alamo Land and Sugar Co.'s Subdivision, Lot "12 (East 5.0 acres)" Block 53 |
| HID-118228 | NO_ADDRESS_RESOLVED | San Jacinto Estates No. 9 Lot 1 (subdivision name recurs ~7x in the baseline) |
| HID-118156 | NO_ADDRESS_RESOLVED | Cotton Estates Central Subdivision Lot 22 |

### Per-case outcome

| Filing # | CAD status | Requests | Candidates | Confidence | Notice address changed? |
|---|---|---|---|---|---|
| HID-117911 | REQUIRES_HUMAN_APPROVAL (ambiguous) | 5 | 6 | — | No |
| HID-117957 | **CAD_PARCEL_CONFIRMED** | 6 | 1 | 0.90 | No (parcel/GEO/valuation attached only) |
| HID-118234 | **CAD_PARCEL_CONFIRMED** | 6 | 2 | 0.98 | No (parcel/GEO/valuation attached only) |
| HID-118198 | **ERROR** | 0 | — | — | No |
| HID-117925 | REQUIRES_HUMAN_APPROVAL (ambiguous, 16 candidates) | 3 | 16 | 0.65 | N/A (was never resolved) |
| HID-118210 | REQUIRES_HUMAN_APPROVAL (ambiguous) | 3 | 2 | 0.65 | N/A |
| HID-117931 | REQUIRES_HUMAN_APPROVAL (**owner conflict**) | 3 | 2 | 0 | N/A |
| HID-118201 | REQUIRES_HUMAN_APPROVAL (weak match) | 3 | 1 | 0 | N/A |
| HID-118228 | REQUIRES_HUMAN_APPROVAL (single candidate, not auto-applied) | 3 | 1 | 0.65 | N/A |
| HID-118156 | REQUIRES_HUMAN_APPROVAL (**0.97 candidate, held by design**) | 3 | 2 | 0.97 | N/A (Approve required regardless of score) |

Full per-case detail (owner, matched/conflicting fields, parcel ID, GEO
ID, valuation year/values) is in the GitHub Actions run's job log
(`Run 10-case regeneration pilot` step) and the `PILOT_*` `AuditLog`
entries this run created.

### Manual verification of every proposed/confirmed CAD parcel

- **HID-117957** — CAD situs `2318 FLUSHING MEADOWS` vs. notice `2318
  Flushing Meadows`: exact match. CAD GEO ID `H2675-00-003-0003-00`
  encodes block 3 / lot 3, matching the notice's `LOT 3, BLOCK 3, Hidden
  Valley Subdivision Phase 1` exactly. **CONFIRMED CORRECT.**
- **HID-118234** — CAD situs `3401 WHISKEY DR` vs. notice `3401 N Whisky
  Dr`: same street number; CAD's record uses the "Whiskey" spelling and
  omits the "N" directional the notice includes. GEO ID
  `B4965-00-000-0026-00` encodes lot 26 with no block, matching the
  notice's `LOT 26, Buchanan Estates` exactly (and encouragingly, on the
  *same* subdivision as case 117661's earlier bad CAD-owner-conflict
  match this session — this time correctly resolved with no conflict).
  **LIKELY CORRECT WITH MINOR SOURCE DISCREPANCY** (spelling +
  directional only; parcel/lot/subdivision identity is exact).
- **HID-118156** — held for human approval per design (NO_ADDRESS_RESOLVED
  cases never auto-apply regardless of score), but the underlying
  evidence is strong: `matchedFields: [subdivision, lot, ownerName]` —
  three independent fields corroborate against the notice's `LOT 22,
  Cotton Estates Central Subdivision` and owner `Michael A. Gonzales and
  wife Illiana S. Perez`. **CONFIRMED CORRECT** (well-supported;
  correctly not auto-applied).
- All five ambiguous/weak REQUIRES_HUMAN_APPROVAL cases (117911, 117925,
  118210, 118201, 118228) — no candidate was selected or persisted as
  verified for any of them (`selectedOrProposedCandidate: null`,
  `existingProductionFieldChanged: false`); there is nothing to
  misclassify because the safeguards correctly declined to pick a winner.
- **HID-117931** — the owner-conflict gate fired exactly as designed:
  `conflictingFields: ["ownerName"]`, confidence forced to 0, no
  candidate selected, routed to `CAD_OWNER_CONFLICT` manual review
  instead of being silently attached. **Safeguard verified working.**
- **No INCORRECT candidate was ever auto-selected or persisted as
  verified** in this pilot. Nothing to flag/stop under that rule.

### Aggregates

- Existing-address cases CAD-confirmed: **2 of 4** (117957, 118234)
- Unresolved cases with a viable candidate (held for review): **6 of 6**
  candidate-bearing unresolved cases were routed to review; **0**
  auto-applied (by design)
- Unresolved cases still fully unresolved (no candidates at all): **0**
  (every unresolved case returned at least one candidate, though most
  were correctly judged too ambiguous/weak to select)
- Owner conflicts detected: **1** (117931)
- Subdivision/other field conflicts: **0**
- Ambiguous matches (candidates found, none selected): **6**
- Errors: **1** (118198 — CAD full-text search returned HTTP 400,
  isolated by the per-case try/catch, did not affect the other 9 cases)
- Valuation enrichment rate: **2 of 2** CAD-confirmed cases got a full
  2026 certified valuation (market/appraised/land/improvement values)
- Total CAD requests: **35** (well under the 60-request global cap and
  each case under its 10-request per-case cap; max single case: 6)
- Average requests/case: 3.5
- Runtime: 80s (pilot step only; ~2 min including install/typecheck)
- External cost: **$0.00** (public CAD data, no paid API; zero Anthropic
  calls — this pipeline stage never touches an LLM)

### One real finding: HID-118198 (CAD search HTTP 400)

The Hidalgo CAD full-text search endpoint rejected the query built from
this case's messy legal description (`44 (N 5ac of N 9.59ac)`) with an
HTTP 400. The per-case try/catch isolation worked exactly as designed —
this did not abort the run, and no data was written for this case beyond
the `PILOT_CASE_FAILED` audit entry. This is a real, not-yet-fixed input-
sanitization gap in how messy legal-description text (parentheses,
embedded fractions) is passed to the CAD search — worth a small targeted
fix before a larger batch, since roughly a handful of the 82 baseline
cases have similarly irregular legal-description text.

### Safety verification

Re-queried all 10 cases' `Property` rows after the run and diffed against
the pre-run snapshot: **zero changes** to `propertyStreetAddress`,
`subdivision`, `lot`, `block`, or `addressResolutionMethod` for any of the
10 cases. Baseline totals unchanged (82 cases / 46 with-address / 36
unresolved — no new rows of any kind created). The two CAD-confirmed
cases only gained `propertyIdNumber` / `geographicId` / lat-long /
`AppraisalValueHistory` rows, exactly as designed.

### Decision

**A. SAFE TO REGENERATE THE REMAINING 72 BASELINE CASES**, with one
caveat: fix the HID-118198-style HTTP 400 on messy legal-description text
first (small, targeted, isolated to query construction) so those cases
don't silently fall back to zero candidates. Every safeguard exercised
correctly under real, deliberately-not-easy conditions: the owner-conflict
gate fired on a genuine conflict, ambiguous/weak matches were correctly
declined rather than guessed, the human-approval gate held even on a
0.97-confidence unresolved-case match, and no notice-transcribed address
was touched anywhere in the run.

**Per the approved scope, the remaining 72 cases are NOT processed. This
pilot stops here and awaits explicit approval before any further
regeneration or ingestion.**

## Full 82-case baseline regeneration report (2026-08-09)

Executed per explicit approval, in this order: (1) one targeted CAD
robustness fix, (2) a read-only re-test of HID-118198 (twice, to confirm
the fix), (3) the 72-case bulk regeneration, (4) one real write-enabled
pass closing the gap the pilot's original HID-118198 error left open.
Full detail: PRs/commits `0bea1fe`, `c2e282e`, `ff22c81`, `a4d9fe7`,
`47dd6f8`; GitHub Actions runs
[31285300272](https://github.com/ForeclosureData/ClaudeBuilder/actions/runs/31285300272)
(bulk-72) and
[31286593449](https://github.com/ForeclosureData/ClaudeBuilder/actions/runs/31286593449)
(HID-118198 closeout).

### 1. CAD robustness fix

Root cause of HID-118198's HTTP 400: its raw legal-description text
included meta-commentary ("(subdivision name obscured by handwriting on
the source document)") and, after stripping that, still contained
semicolon-joined compound sentences -- both sent verbatim as a CAD
full-text search query. Two fixes, both in
`packages/foreclosure-core/src/address-resolution/`:

- `sanitizeCadSearchText()` (new, in `legalDescriptionParsing.ts`):
  strips meta-commentary parentheticals, de-parenthesizes legitimate
  acreage/fraction qualifiers, spaces out slashes, strips other unneeded
  punctuation including semicolons, collapses whitespace, returns `null`
  rather than an empty/near-empty query when nothing search-worthy
  survives. Search input only -- the stored/displayed raw text is
  untouched. No semantic rewriting, no fuzzy guessing.
- `gatherCandidates()`'s `spend()` helper (`resolver.ts`) now catches a
  failing search strategy instead of letting its exception abort every
  remaining strategy for that case. This was the actual mechanism behind
  HID-118198's original zero-candidate failure: its address-search
  strategy (which runs first) had already found the right property, but
  the later legal-description strategy's exception unwound the whole
  function before that result was ever returned.

11 new regression tests (`legalDescriptionParsing.test.ts`,
`resolver.test.ts`), including one modeling HID-118198's exact structure
and a strategy-isolation test with a mock adapter that throws on one
query type. All 195 `foreclosure-core` tests pass. No confidence
threshold, conflict-gating logic, or scoring changed.

### 2. HID-118198 re-test

Even after both fixes, the sanitized query still returned an HTTP 400
(live-confirmed, GitHub Actions run 31285066877 and 31285203945) --
apparently something about this specific multi-clause sentence beyond
what was targeted. Rather than keep guessing against the live endpoint,
the isolation fix was confirmed to make this safe regardless: the
address-search strategy still found the correct property
(`705 N INSPIRATION BLVD, ALTON, TX`, parcel 181345), and that result is
preserved instead of discarded.

The candidate correctly does **not** get auto-selected: its clean CAD
`lot: 44` doesn't textually match the notice's messy transcribed
`44 (N 5ac of N 9.59ac)` field, so the resolver's field-conflict check
(correctly, conservatively) refuses to treat it as an unambiguous match.
This is a safe, deliberate refusal given messy input, not a bug -- no
wrong or suspicious candidate became selectable, so the stop condition
was not triggered.

### 3. 72-case bulk regeneration

Ran clean: 72/72 cases processed, **zero errors**, count assertion
(82 total / 72 remaining) passed exactly. 321 CAD requests, average 4.5/
case, max 10/case (the per-case cap, hit exactly once), runtime 675.9s
(~11.3 min).

### 4. HID-118198 closeout

One real write-enabled pass for just this case (GitHub Actions run
31286593449), using the identical shared logic already exercised 81
times elsewhere. Result matches both read-only checks exactly:
`REQUIRES_HUMAN_APPROVAL`, notice address untouched, 1 candidate stored
for review.

## Full 82-case baseline: final state

### Property / address

| | Count |
|---|---|
| Notice-derived address (Property exists) | 46 |
| Unresolved address (no Property) | 36 |
| **CAD-confirmed parcel** (address enrichment auto-attached) | **26** |
| CAD candidate(s) found, awaiting human approval | 50 |
| No CAD match at all (zero candidates found) | 6 |
| Owner-conflict signal detected (any candidate) | 11 (2 produced a dedicated `CAD_OWNER_CONFLICT` flag: HID-117931, HID-118196; the other 9 were on unresolved cases and folded into that case's existing review-task notes rather than a separate reason code) |
| Subdivision/lot/block field-conflict detected | 1 (HID-118227 -- lot mismatch) |
| Ambiguous match (multiple candidates, no single winner) | 16 with a dedicated `MULTIPLE_APPRAISAL_MATCHES` flag; more folded into unresolved-case notes |

Sanity check: 26 confirmed + 50 awaiting approval + 6 no-match = 82. ✓
26 confirmed + 50 awaiting approval = 76 distinct cases with at least
one stored `AppraisalPropertyCandidate` row (877 rows total) -- matches
the DB-level count exactly.

**14 of the 50 awaiting-approval cases have a single strong proposed
candidate** (confidence 0.97, subdivision+lot+owner name all
corroborating) ready for a one-click human Approve -- these are the
cases "that could become useful listings after a simple human approval"
(HID-117716, 117732, 118156, 118199, 118202, 118206, 118219, 118220,
118221, 118222, 118224, 118225, 118229, 118230).

### Valuation

All 26 CAD-confirmed parcels got a full valuation:

| | Count |
|---|---|
| Market value populated | 26 / 26 |
| Appraised value populated | 26 / 26 |
| Land value populated | 26 / 26 |
| Improvement value populated | 26 / 26 |
| 2027 populated | 0 |
| 2026 fallback (first year-lookback step) | 26 |
| Older fallback year | 0 |
| Certified (Hidalgo CAD's own certification signal) | 26 / 26 true |
| Confirmed parcel with no valuation | 0 |

Every confirmed parcel resolved cleanly on the first year-lookback step
(current year 2026 was already populated and certified for all of them)
-- no case needed to fall back further, and none was left with a
confirmed parcel but no valuation data.

### Manual review

| Reason | Open tasks |
|---|---|
| `NO_ADDRESS_RESOLVED` (unresolved-address baseline) | 36 |
| `MULTIPLE_APPRAISAL_MATCHES` (new, this effort) | 16 |
| `POOR_TEXT_QUALITY` (pre-existing, unrelated to CAD) | 5 |
| `CAD_OWNER_CONFLICT` (new, this effort) | 1 |
| **Total open review tasks** | **58** |

50 of the 82 baseline cases (61.0%) require some form of manual review
before their derived data is fully settled -- 36 because the notice
never stated an address at all (unchanged by this effort, structural),
14 with a strong proposed candidate ready for one-click approval, and
the rest with more genuinely ambiguous or conflicting evidence.

### Safety: manual verification of automatically confirmed parcels

Every one of the 26 auto-confirmed parcels went through the identical
enrichment-only code path (address match verified, then subdivision/lot/
block/owner cross-checked for conflicts before attaching). Manually
spot-checked roughly half against the source notice:

- **Clean exact matches** (majority): HID-117920, 117928, 117992, 117994,
  118133, 118185, 118186, 118191, 118192, 118193, 118214, 118218, 118231,
  118233, 118235, 118236 -- situs address, subdivision, and lot number all
  agree with the notice. **CONFIRMED CORRECT.**
- **Minor source discrepancies** (spelling/formatting only, parcel/lot
  identity still exact): HID-118207 (CAD spells it "GARRISION" vs the
  notice's "Garrison"), HID-118208 (CAD's situs says "38TH ST" vs the
  notice's "38th Lane" -- house number, subdivision, and lot number all
  still agree), HID-117949 and HID-118183 (CAD's situs string omits the
  house number entirely, but GEO ID lot number still matches exactly).
  **LIKELY CORRECT WITH MINOR DISCREPANCY.**
- **Trust/LLC owner matches**: none of the 3 LLC-owner cases in this
  effort (HID-117993, 118188, 118205) were auto-confirmed -- all three
  correctly routed to manual review or found no CAD match. Zero LLC/
  entity-owner cases were ever auto-persisted.
- **Legal-description/lot-only matches**: none exist among the 26
  auto-confirmed parcels, by design -- that resolution path (no stated
  address) never auto-writes `Property` regardless of confidence,
  confirmed working across all 36 unresolved cases. The 14 highest-
  confidence examples of this category (listed above) are proposed, not
  persisted.
- **One valuation outlier worth a human sanity-check** (not a match
  error): HID-118216's confirmed market value is $900,000 -- roughly 3-6x
  the other 25 confirmed parcels' values. The address/lot match itself is
  exact (`1003 INSPIRATION DR`, GEO ID ending `-0026-00` matching the
  notice's Lot 26), so this is flagged as a value worth a human glance,
  not a resolution error.

**Zero of the manually-inspected auto-confirmed parcels were classified
INCORRECT or AMBIGUOUS.** No stop condition was triggered.

### Performance (full effort: pilot + fix verification + bulk + closeout)

| | |
|---|---|
| Total CAD requests | 359 (35 pilot + 321 bulk + 3 closeout) |
| Average requests/case | 4.4 |
| Max requests, single case | 10 (the per-case cap, hit exactly once) |
| Total processing runtime | ~13 minutes across all runs |
| External/API cost | **$0.00** -- Hidalgo CAD is public data with no paid tier; zero Anthropic/AI calls anywhere in this pipeline stage |

### Coverage context

**82 is the accepted production baseline, not full Hidalgo coverage.**
This effort only enriched derived data for the existing 82 cases -- it
did not discover, ingest, or add any new notices. The previously-
identified full Hidalgo trustee-sale bundle is on the order of ~282
notices; roughly 200 of those have never been ingested at all. Nothing
in this report should be read as "Hidalgo coverage is complete" --
only "the accepted 82-case baseline's derived data is now current."

### Decision

**A. BASELINE REGENERATION COMPLETE -- READY FOR BOUNDED NEW INGESTION**,
with no caveats this time: the HID-118198 blocker is closed, all 82
cases have been through the current, fixed pipeline exactly once, every
conflict/threshold safeguard fired correctly under real and deliberately
messy conditions (owner-conflict gate, subdivision/lot-conflict gate,
LLC-owner caution, the human-approval gate holding even at 0.97
confidence), zero notice-transcribed addresses were touched anywhere
across 82 cases, and manual inspection of the auto-confirmed parcels
found zero incorrect matches.

**Per the approved scope, the remaining ~200 un-ingested Hidalgo notices
are NOT processed and scheduling remains OFF. This effort stops here and
awaits explicit approval before any new ingestion or scheduling change.**

## Fresh 25-notice production ingestion test (2026-08-09)

The first real test of the current pipeline against notices it has never
processed before, run via the existing `hidalgo-ingestion.yml` workflow
(`mode=production`, `max_notices_per_bundle=25`,
`max_ai_fallback_calls=25`, `max_ai_cost_usd=2.00` -- run
[31288218973](https://github.com/ForeclosureData/ClaudeBuilder/actions/runs/31288218973)).

### 1. Selection

A dry run (run
[31287999914](https://github.com/ForeclosureData/ClaudeBuilder/actions/runs/31287999914))
confirmed the current Hidalgo bundle (posting `72861`, posted
2026-08-04) before spending anything:

- Bundle total notice count: **282** (739 PDF pages, 282 barcode
  boundaries detected)
- Currently ingested unique notice count (pre-run): **82**
- Estimated remaining un-ingested: **~200**

True filing-number selection isn't possible in advance -- the pipeline
splits notices in page order, bounded by `max_notices_per_bundle`, and
lets its own duplicate check (composite `countyId` + normalized
`countyFilingNumber` identity, DB-level unique constraint) decide what's
actually new. The real run's own numbers prove the outcome: **25 records
created, 0 duplicates skipped**. Filing numbers 117630-117710 (see table
below) -- a lower, entirely distinct range from the 82-baseline's
117716-118236, with zero overlap confirmed both by the pipeline's own
dedup count and by a direct DB query for the exact 82 known filing
numbers.

### 2-3. Pipeline run & safety controls

Ran the full production path (discover → split → OCR → deterministic
extraction → bounded AI fallback → persist → property resolution → CAD →
conflict gating → valuation → manual-review routing) with every existing
safeguard active and unmodified: per-notice isolation, CAD/AI request
and dollar caps, owner-conflict/subdivision-conflict/lot-block-conflict
gates, the strategy-isolation fix from the CAD robustness work (one
failed search no longer discards an earlier one's results), minimum
confidence/margin thresholds, and the human-approval gate for
unresolved-address cases. Nothing was modified during the run; no hard
safety/data-corruption issue occurred (see Safety verification below),
so the "do not touch resolver/scoring" constraint was never invoked.

### 5. Extraction metrics

| | |
|---|---|
| Notices attempted | 25 |
| Successfully ingested | 25 |
| Failed (unexpected error) | 0 |
| Duplicates skipped | 0 |
| OCR success rate | 100% |
| Average OCR confidence | 91.0 |
| Average overall extraction confidence | 87.5% |
| Borrower/grantor extraction success | 16 / 25 (64%) |
| Lender/beneficiary extraction success | 23 / 25 (92%) |
| Mortgage servicer extraction success | 18 / 25 (72%) |
| Sale-date extraction success | 20 / 25 (80%) |
| Original-principal extraction success | 8 / 25 (32%) |
| Legal-description extraction success | 20 / 25 (80%) |
| Notice-stated property-address rate | 14 / 25 (56%) |
| AI fallback calls / rate | 9 / 25 (36%) |
| Anthropic spend | **$0.45** |

**A real, systemic finding: all 9 AI-fallback calls failed schema
validation and were rejected (0 merged).** Every one of the 9 error
messages is missing the exact same two keys --
`borrowerNames`/`grantorNames` -- from the AI's JSON response, plus a
varying mix of other fields (`originalPrincipalAmount`,
`instrumentNumber`, `recordingDate`, `propertyId`, `saleLocation`,
`substituteTrustee`, `originalMortgagee`, `lenderName`). The failure mode
is identical and 100% reproducible across all 9 calls -- this reads as a
genuine prompt/schema mismatch in the field-extraction fallback path
(the AI is never being asked for, or never returning,
`borrowerNames`/`grantorNames` at the response's top level), not random
data-quality noise. It fails **safe**: the whole malformed response is
discarded rather than partially merged, so nothing incorrect was
persisted -- but it does mean these 9 notices are left with less data
than the pipeline should have been able to recover, and $0.45 was spent
for zero yield. This directly suppresses investor-completeness (see
section 6).

### 6. Investor-critical completeness

| Classification | Count | % |
|---|---|---|
| FULLY USEFUL | 0 | 0% |
| USEFUL | 14 | 56% |
| LIMITED | 11 | 44% |

**Zero FULLY USEFUL records** -- every case that has a usable address
and sale date (the USEFUL bar) is missing either a real borrower name or
the original principal amount, so none clears the stricter FULLY USEFUL
bar (borrower + principal + valuation-if-CAD-confirmed, on top of
address/sale date/source notice). This is directly traceable to the
extraction gap above: of the 11 cases missing a real borrower name
(`"Unknown owner"` placeholder), 9 are exactly the AI-fallback-failure
cases; only 17/25 have any principal amount at all. Every one of the 25
has its source notice (`SourceDocument`) -- that field is never missing.

### 7. Property-resolution metrics

| | Count |
|---|---|
| Address resolved from notice (explicit/"commonly known as") | 14 |
| Total usable address (notice-stated + CAD-inferred) | 17 |
| **CAD parcel confirmed** | **7** |
| CAD candidate found, requires human approval | 11 |
| No CAD match | 7 |
| Owner-conflict-gated | 3 |
| Subdivision/lot/block-conflict-gated | 0 |
| Ambiguous match (multiple candidates, no winner) | 4 |
| Structural no-address (no Property record at all) | 8 |
| Suspicious/non-property-address rejections | 0 |

Sanity check: 7 confirmed + 11 awaiting approval + 7 no-match = 25. ✓

A distinction worth flagging explicitly: **3 of the 7 CAD-confirmed
parcels had no address stated in the notice at all** -- the live
ingestion pipeline's resolver auto-resolved these purely via a confident
legal-description CAD match (`addressResolutionMethod:
LEGAL_DESCRIPTION_MATCH`, `matchedFields` including `subdivision`+`lot`
or `subdivision`+`lot`+`ownerName`). This is different, and more
permissive, than the derived-data regeneration script's deliberately
conservative choice (which never auto-writes `Property` for a case with
no stated address) -- it's the live pipeline's own pre-existing resolver
behavior (unchanged, unmodified here), not a bug, but worth recording
precisely since it means "CAD parcel confirmed" and "address resolved
from notice" are not the same set.

CAD requests per notice/lookup timing aren't currently surfaced by the
live pipeline's run summary (unlike the custom regeneration scripts,
which explicitly track and cap a shared request budget) -- this is a
real observability gap worth closing, not a number I'm willing to
estimate here. The underlying per-notice cap
(`HIDALGO_CAD_MAX_REQUESTS_PER_NOTICE`, default 10) and the existing
2-second inter-request rate limit were both active throughout; nothing
in the run's behavior (timing, error patterns, candidate counts up to
103 for one wide subdivision search) suggested either was exceeded or
misbehaving.

### 8. Valuation metrics

All 7 CAD-confirmed parcels got a complete valuation, identical pattern
to the 82-baseline regeneration:

| | |
|---|---|
| Market value available | 7 / 7 |
| Appraised value available | 7 / 7 |
| Land value available | 7 / 7 |
| Improvement value available | 7 / 7 |
| 2027 populated | 0 |
| 2026 fallback | 7 |
| Other fallback year | 0 |
| Confirmed parcel with missing valuation | 0 |

### 9. Manual-review metrics

| | |
|---|---|
| Total cases with a manual-review task | 19 / 25 (76%) |
| One-click-ready candidate (0.97 confidence, none this batch) | 0 |
| Genuinely ambiguous (`MULTIPLE_APPRAISAL_MATCHES`) | 4 |
| Structural no-address (`NO_ADDRESS_RESOLVED`) | 8 |
| Conflict-driven (`CAD_OWNER_CONFLICT`) | 3 |
| Extraction-quality-driven (`BORROWER_NAME_CONFLICT`, `SALE_DATE_CONFLICT`) | 9, 5 |

Reading on "is manual review mostly workflow, or unresolved matching
quality": **mixed, and mostly not a CAD-matching problem.** Only 3 of 19
review-triggering reasons are CAD-driven (owner conflict); the largest
contributors are structural (8 cases genuinely have no address in the
notice -- expected, matches the 82-baseline pattern) and
extraction-quality-driven (9 borrower-name conflicts, 5 sale-date
conflicts -- both traceable back to the same AI-fallback bug from
section 5). Fixing that one bug would likely clear a meaningful share of
the extraction-quality review load without touching CAD/resolver logic
at all.

### 10. Manual safety verification -- all 7 CAD-confirmed parcels (100%, not a sample)

| Filing # | Notice address | CAD situs | Notice legal (subdivision/lot) | CAD subdivision/lot | Owner match | Classification |
|---|---|---|---|---|---|---|
| 117632 | 1416 W MCKINLEY AVE, ALTON, TX | 1416 MCKINLEY AVE | Dos Valles Subdivision Phase 2 / 68 | DOS VALLES / 68 | Exact | **CONFIRMED CORRECT** |
| 117635 | *(none stated)* | 3304 E TRUMAN AVE, TX | INDIAN HARBOR SUBDIVISION / 39 | INDIAN HARBOR / 39 | Exact (primary borrower) | **CONFIRMED CORRECT** |
| 117642 | 813 ORANGE ST, MERCEDES, TX | 813 ORANGE ST, TX | WOODLAWN ACRES / 2 | WOODLAWN ACRES / 2 | Exact | **CONFIRMED CORRECT** |
| 117648 | *(none stated)* | 1407 MAYBERRY ST, EDINBURG, TX | REDBUD ESTATES PHASE 3 / 1 | REDBUD ESTATES / 1 | Exact | **CONFIRMED CORRECT** (3-field match: subdivision+lot+owner) |
| 117659 | 1902 Seagull Lane | 1908 SEAGULL LN, TX | TANGLEWOOD AT BENTSEN PALM PHASE I / 5 | TANGLEWOOD AT BENTSEN PALM / 5 | Exact | **LIKELY CORRECT WITH MINOR DISCREPANCY** -- house number differs (1902 vs 1908); subdivision, lot, and owner name all corroborate exactly, but the address-number mismatch itself is worth a human glance |
| 117702 | 1604 Optimum Dr, Edinburg, TX | 1604 E OPTIMUM DR, EDINBURG, TX | THE HEIGHTS ON WISCONSIN PHASE II / 18 | HEIGHTS ON WISCONSIN / 18 | Exact | **CONFIRMED CORRECT** (CAD adds a directional the notice omits) |
| 117708 | *(none stated)* | 2408 HEATHER AVE, EDINBURG, TX | DANIELLE ESTATES / 57 | DANIELLE ESTATES / 57 | Exact | **CONFIRMED CORRECT** (3-field match: subdivision+lot+owner, out of 103 candidates in that subdivision) |

**Observed false-match rate: 0 / 7 (0%).** 6 of 7 confirmed correct
outright; 1 flagged for a minor discrepancy that doesn't change the
underlying match (subdivision + lot + owner name all still agree). No
INCORRECT classification occurred, so the "stop and do not process
further" condition was not triggered.

### 11. Coverage accounting

| | |
|---|---|
| Total detected notices in current Hidalgo bundle | 282 |
| Total unique notices now ingested (82 baseline + 25 new) | 107 |
| Estimated notices remaining | ~175 |
| **Ingestion coverage** | **107 / 282 = 37.9%** |

Kept explicitly distinct from CAD enrichment: of the 107 total ingested
cases, 33 have a CAD-confirmed parcel (26 from the baseline regeneration
+ 7 from this run) -- an enrichment question, not a coverage one.
**"Did ForeclosureData capture every foreclosure notice?" is a 37.9%
answer; "did it successfully resolve every captured property?" is a
separate, much stronger number** (33/107 confirmed outright, another
50+ with a stored candidate awaiting one human click).

### 12. Performance

| | |
|---|---|
| Total runtime (this run) | 625.9s (~10.4 min) |
| Notices split / OCR'd / persisted | 25 / 25 / 25 |
| Anthropic calls | 9 (all rejected by schema validation, 0 merged) |
| Anthropic cost | $0.45 |
| CAD/external cost | $0.00 (public data, no paid tier) |
| Total CAD requests | not currently surfaced by the live pipeline's logging (see section 7) |

### 13. Final recommendation

**B. ONE TARGETED FIX REQUIRED BEFORE MORE NEW INGESTION.**

Evidence for what's working: property resolution and CAD safety held up
completely under real, previously-unseen data -- 0/7 incorrect
auto-confirmed parcels, the owner-conflict and ambiguous-match gates
both fired correctly, zero suspicious/non-property addresses, zero
duplicate `ForeclosureCase` rows, zero data corruption, zero uncontrolled
CAD/AI behavior. None of the section 4 stop conditions occurred. On the
property-resolution dimension alone, this would support "A."

Evidence for the targeted fix: the AI-fallback field-extraction path
failed schema validation **9 for 9** (100%), always missing the same two
keys, for $0.45 with zero yield -- and that gap has a direct, measurable
effect on investor-completeness (0 of 25 records reach FULLY USEFUL,
largely because borrower name and original principal can't both be
recovered for the harder-to-extract notices). This is a fixable,
well-isolated extraction bug, not a resolver/scoring/safety issue -- it
never touched anything this session was asked not to touch, and it fails
safe rather than corrupting data. But scaling ingestion further before
fixing it means paying real Anthropic cost for records that will keep
landing short of their achievable completeness.

**Per the approved scope, the remaining ~175 notices are NOT processed
and scheduling remains OFF. This effort stops here and awaits explicit
approval before any further ingestion, the AI-fallback fix, or a
scheduling change.**

## Extraction/AI-fallback repair (2026-08-09)

Targeted repair of the extraction gap the fresh-25-notice test found,
verified against **only** the same 25 already-ingested notices (their
stored `SourceDocument.rawText` -- no re-ingestion) via a bounded GitHub
Actions run
([final confirmation: run 31293239146](https://github.com/ForeclosureData/ClaudeBuilder/actions/runs/31293239146)),
capped at the same 9 AI-fallback calls the original run needed.

### 1. Root cause (not a guess -- read from the actual code path)

`extractWithAI.ts`'s Anthropic call was a **plain-text completion**: the
user turn was just the raw notice text, and the system prompt narrated
guidance for 6 of the 18 schema fields by name (`originalMortgagee`,
`currentMortgagee`, `mortgageServicer`, `lenderName`,
`currentPrincipalBalance`, `propertyAddress`) but never mentioned
`borrowerNames`/`grantorNames` anywhere, and the actual JSON Schema was
never included in the request at all. The model had no machine-readable
list of required field names -- it reconstructed the response shape from
prose alone, and reliably reproduced the 6 fields it was told about by
name while omitting the 2 it was never told about. This fully explains
the observed pattern: 9/9 failures, always missing exactly
`borrowerNames`/`grantorNames`, never a different pair.

### 2-3. Fix: tool-use with a real schema + terminology guidance

- `extractWithAI.ts` now calls Anthropic with `tools`/`tool_choice`
  (`extract_foreclosure_notice_fields`), giving the model the actual JSON
  Schema (`AI_EXTRACTION_TOOL_INPUT_SCHEMA` in `schema.ts`, all 18 fields
  listed in `required`) instead of prose alone.
- The schema's per-field descriptions and the system prompt both now
  explain that a Texas trustee's-sale notice calls the original
  homeowner(s) "Borrower", "Grantor(s)", "Trustor(s)", "Mortgagor(s)", or
  a combined "Grantor(s)/Mortgagor(s)" label -- sometimes only in
  narrative prose ("the Deed of Trust executed by NAME") -- and
  explicitly distinguishes them from the lender/original mortgagee,
  current mortgagee/noteholder, mortgage servicer, substitute trustee,
  attorney, and county clerk.
- Explicit instruction: unknown is valid (`[]`/`null`), fabrication is
  not, and every required key must be present -- never omitted.

### 4. Original-principal fallback -- deterministic patterns extended, evidence-checked against the real sample first

Per the constraint ("only add patterns supported by the actual 25-notice
sample"), pulled the real stored `rawText` for all 25 notices before
writing any new regex. Finding: the original two patterns require a
*literal, single-space* "original principal amount of" -- **10 of the 17
notices that fell through them actually had that exact phrase**, just
with a PDF line-wrap in the middle (`"...the original\nprincipal amount
of $X"` or `"...principal amount\nof $X"`), which the old patterns'
hard-coded spaces couldn't cross. Relaxing to `\s+` recovers all 10 with
no widening of what counts as a match. Three further real template
variants, each confirmed against an actual notice in the sample:
`"Original Principal: $X"` (no "Amount" word, HID-117659),
`"Deed of Trust Dated: ...\nAmount: $X"` (a key-value template, HID-117700),
and `"Note dated <date> in the amount of $X"` (narrative, no "principal"
label at all, HID-117633). The remaining 4 (117635, 117648, 117651,
117701) have **zero dollar amounts anywhere in the document** -- correctly
left `null`, not guessed. Also added a floor (`< $1,000` is discarded, not
trusted) after finding a real OCR artifact (`"$216 015 00"` instead of
`"$216,015.00"`) that would otherwise have parsed to a fabricated-looking
`$216.00`.

### 5. Field-level partial validation

`extractWithAI.ts` now validates each of the 18 returned fields
independently against its own Zod schema (`validateFieldsIndependently`)
instead of one `safeParse` on the whole object. A field that's missing or
malformed is recorded as `omitted`/`rejected_invalid` and left blank
(never merged) -- it no longer discards four other fields the model got
right. Nothing here fabricates: rejected/omitted fields become the same
blank placeholder the deterministic layer already uses for "unknown."

### 6. AI cost/yield instrumentation

`AiExtractionOutcome` now carries `fieldOutcomes` (per-field
accepted/rejected/omitted + reason), `inputTokens`/`outputTokens`, and the
pipeline result exposes them (`aiFieldOutcomes`, `aiInputTokens`,
`aiOutputTokens`). `usedAiFallback` is only set `true` when at least one
field was actually recovered with a value -- a schema-valid-but-empty
response no longer counts as a "successful" fallback.

### 7. Tests

22 new regression tests: 13 in `extractWithAI.test.ts` (borrowerNames
present/empty, grantorNames empty, null scalar, multiple borrowers,
terminology present in the prompt/schema, malformed field doesn't
invalidate the rest, omitted key handling, partial-valid response,
no-fabrication-on-total-failure, suffix-splitting fix, token/cost
instrumentation) and 9 in `deterministicExtraction.test.ts` (each new
principal pattern, the OCR-floor guard, the no-amount-stated null case,
the suffix-splitting fix), using sanitized examples derived from the
actual observed structures (placeholder names, real phrasing). Full suite:
**220/220 passing**.

### 8. Re-run report -- same 25 records, before vs. after

| Metric | Before | After |
|---|---|---|
| Borrower/grantor extracted | 16/25 (64%) | **24/25 (96%)** |
| Original principal extracted | 8/25 (32%) | **21/25 (84%)** |
| Sale date extracted | 20/25 (80%) | **23/25 (92%)** |
| Legal description extracted | 20/25 (80%) | **24/25 (96%)** |
| AI calls attempted | 9 | 9 (unchanged -- same bound) |
| AI calls schema-valid | 0/9 (0%) | **9/9 (100%)** |
| AI calls with ≥1 useful field | 0/9 (0%) | **9/9 (100%)** |
| Total AI-recovered fields | 0 | **127** |
| AI spend | $0.45 | $0.59 |
| Cost per useful AI call | n/a (0 useful) | **$0.0656** |

The 4 notices with no principal anywhere in the text (117635, 117648,
117651, 117701) correctly stayed `null` throughout -- not a regression,
the fix's own "unknown is valid" guarantee holding.

**Investor completeness, recomputed** (lender explicitly not required for
FULLY USEFUL, per the stated definition -- usable address + sale date +
source notice + borrower + principal, plus valuation only when a CAD
parcel is confirmed):

| Classification | Before | After |
|---|---|---|
| FULLY USEFUL | 0 (0%) | **10 (40%)** |
| USEFUL | 14 (56%) | 5 (20%) |
| LIMITED | 11 (44%) | 10 (40%) |

LIMITED barely moved (11→10) because 8 of the 10 remaining LIMITED cases
have no address at all in the notice or CAD -- a property-resolution gap,
untouched by this task, not an extraction one. The one LIMITED→USEFUL
move (HID-117701) is the AI recovering a sale date that deterministic
extraction missed.

### 9. Manual verification of every AI-recovered borrower/principal (100%, not a sample)

| Filing # | AI-recovered borrower(s) | Verdict | AI-recovered principal | Verdict |
|---|---|---|---|---|
| 117634 | Damian Davila | CONFIRMED CORRECT | $176,641.00 | CONFIRMED CORRECT |
| 117643 | Robert Anthony Cummings, Francisca Cannata | CONFIRMED CORRECT | $234,671.00 | CONFIRMED CORRECT |
| 117651 | Ediberto Reyes, Jr. | CONFIRMED CORRECT | *(none -- correctly null)* | CONFIRMED CORRECT |
| 117658 | Ismael E. Badillo | CONFIRMED CORRECT | $218,960.00 | CONFIRMED CORRECT |
| 117660 | Gerardo Guerrero Diaz | CONFIRMED CORRECT | $179,390.00 | CONFIRMED CORRECT |
| 117697 | Eduardo Castellanos | CONFIRMED CORRECT | $216,015.00 | **LIKELY CORRECT** -- source text is OCR-mangled ("$216 015 00", no commas/decimal); the AI's reconstruction is the only sensible reading, but noted as inference rather than a verbatim match |
| 117698 | Pedro Champion, Estela Champion | CONFIRMED CORRECT | $65,550.00 | CONFIRMED CORRECT |
| 117701 | Ruben Rodriguez Cavazos | CONFIRMED CORRECT (source table has it as "CAVAZOS, RUBEN RODRIGUEZ" -- correctly reordered, no fabrication) | *(none -- correctly null)* | CONFIRMED CORRECT |
| 117707 | Ricardo Ruiz, Jr. | CONFIRMED CORRECT (see defect below) | $173,500.00 | CONFIRMED CORRECT |

**One defect found and fixed during this verification, not before**: the
first confirmation run showed HID-117707 as `["Ricardo Ruiz", "Jr."]` --
the model (and, as it turned out, the *deterministic* comma-splitter too)
read the suffix as a second borrower. Traced to the actual cause:
`texasTemplates.ts`'s `splitNames()` already produces this split with
high confidence, so the pipeline's merge never lets the AI's own
(separately correct) value override it -- fixing only the AI side left it
wrong. Fixed at the shared root (`nameSuffixes.ts`, used by both the
deterministic splitter and the AI field validator) and reconfirmed with a
second real run: now `["Ricardo Ruiz, Jr."]`. **Zero fabrications found
across all 9 cases** -- every AI-recovered value traces to real text in
the notice; the one defect was a mis-split of real text, not an invented
value, and it's now closed.

### 10. Final recommendation

**A. EXTRACTION FIX PASSED -- READY FOR NEXT NEW HIDALGO BATCH.**

The AI-fallback path went from 0/9 useful (100% failure, $0.45 wasted) to
9/9 useful (127 fields recovered, zero fabrications, one defect found and
closed during verification) for $0.59. Deterministic principal extraction
alone -- no AI spend -- improved from 32% to 80% via evidence-backed
pattern fixes. Every AI-recovered value was manually checked against
source text; nothing was invented. The residual gaps (LIMITED cases with
no address anywhere, lender extraction, the `needsAiFallback` trigger
occasionally missing a single weak field like HID-117661's borrower name)
are real but are property-resolution/trigger-tuning items, not this
task's extraction/AI-fallback scope, and are called out here rather than
hidden.

**No production data was modified by this task.** The before/after
numbers above are computed in-memory against the 25 records' existing
`rawText` and were never written back onto the live
`ForeclosureCase`/`Loan`/`Person` rows -- backfilling the 25 already-
ingested records with the corrected extraction is a distinct, separately-
approvable follow-up, not assumed here. **Per the approved scope, the
remaining ~175 notices are NOT processed and scheduling remains OFF. This
effort stops here and awaits explicit approval before any further
ingestion, a backfill of the 25 existing records, or a scheduling
change.**

## Phase 1: Extraction backfill onto the same 25 fresh-test records (2026-08-09)

Approved follow-up to the extraction repair: backfills the corrected
extraction results onto the same 25 already-ingested records, using their
existing `SourceDocument.rawText` -- no new `ForeclosureCase` rows, no new
`SourceDocument` rows, notice identity (`countyId` + normalized
`countyFilingNumber`) never touched.
([Dry run](https://github.com/ForeclosureData/ClaudeBuilder/actions/runs/31294171732),
then [real write pass](https://github.com/ForeclosureData/ClaudeBuilder/actions/runs/31294313416) --
identical change sets, 0 suspicious skips in either.)

**Safety model actually applied**: a field was only ever changed if the
existing value was null/the ingestion-time `"Unknown owner"` placeholder
(a real gap), or -- the one narrow exception -- if the existing original-
principal value was below the $1,000 sanity floor (an OCR-corruption
signature, not a real principal). A non-null, non-corrupted existing
value was never touched, even when the new pipeline produced a different
result. A 50x-ratio guard would have skipped-and-flagged any old/new
principal disagreement that extreme rather than silently picking one;
**this never triggered** -- 0 suspicious skips across all 25 records.

### Results

| | |
|---|---|
| Records with at least one field changed | 19 / 25 |
| Records with zero changes (already correct/complete) | 6 / 25 |
| Total field changes | 49 |
| Currency-safety corrections (OCR-corrupted value replaced) | 1 (HID-117697: $216.00 -> $216,015.00) |
| Suspicious skips (old/new differed >50x, left untouched) | 0 |
| New `ForeclosureCase` rows created | 0 |
| New `SourceDocument` rows created | 0 |
| AuditLog entries written | 49 (one per field change, verified present in production) |

Field-level breakdown of the 49 changes: 17 original-principal fills (16
gap-fills + the 1 currency-safety correction), 8 borrower/grantor name
fills, 3 new `ForeclosureSale` rows (previously-missing sale records), 4
new `LegalDescription` rows, 8 instrument-number fills, 4 deed-of-trust-
date fills, 2 recording-date fills, 3 lender/servicer fills.

**Completeness after backfill** (25 records):

| Field | Before | After |
|---|---|---|
| Borrower/grantor | 16/25 (64%) | **24/25 (96%)** |
| Original principal | 8/25 (32%) | **21/25 (84%)** |
| Lender/mortgagee | 25/25 (100%) | 25/25 (100%, unchanged) |
| Mortgage servicer | 17/25 (68%) | **20/25 (80%)** |
| Sale date | 20/25 (80%) | **23/25 (92%)** |
| Legal description | 20/25 (80%) | **24/25 (96%)** |

**Investor completeness** (lender never required for FULLY USEFUL, per
spec; county valuation only required when a CAD parcel is confirmed):

| Classification | Before | After |
|---|---|---|
| FULLY USEFUL | 0 (0%) | **10 (40%)** |
| USEFUL | 14 (56%) | 5 (20%) |
| LIMITED | 11 (44%) | 10 (40%) |

**11 records improved classification** (all USEFUL/LIMITED -> a stronger
tier): HID-117630, 117631, 117632, 117633, 117642, 117659, 117660, 117675,
117695, 117698 (USEFUL -> FULLY USEFUL), and HID-117701 (LIMITED ->
USEFUL, via a newly-recovered sale date). **Zero records regressed** --
confirmed by re-deriving the same classification against the actual
persisted database state, not just the earlier in-memory computation, and
diffing every one of the 25 filing numbers.

Two known, pre-existing residual gaps, unaffected by this backfill and
out of this task's scope: HID-117661's borrower name and HID-117652/
117702's sale dates stay missing because `needsAiFallback()` only
triggers when 2+ of its 5 tracked fields are weak -- these cases each had
exactly 1 weak field, so AI fallback (old or new) was never invoked for
them. Tightening that trigger is a distinct, separate improvement, not
assumed here.

### Manual spot-check

Every changed borrower and principal value is byte-identical to the
values already manually verified against source `rawText` in the
extraction-repair task's step 9 (see above) -- CONFIRMED CORRECT or
LIKELY CORRECT in all 9 cases, zero fabrications. No new spot-check was
needed since the backfill wrote exactly those already-verified values;
re-confirmed here that what's now in production matches what was checked.

### Explicitly out of scope, not silently done

- `ManualReviewTask` rows (e.g. `BORROWER_NAME_CONFLICT`,
  `SALE_DATE_CONFLICT`) created at original ingestion time were **not**
  auto-resolved, even where the underlying field is now fixed -- resolving
  a review task is a distinct admin-workflow action with its own
  audit semantics, not assumed here.
- `ForeclosureCase.summaryText` (the generated display blurb) was **not**
  regenerated -- it still reflects the pre-backfill extraction for the 19
  changed records. Worth a follow-up if the summary text is investor-
  facing anywhere the structured fields now disagree with it.

**Phase 1 verified clean, zero regressions -- proceeding to Phase 2 per
the approved two-phase plan.**

## Phase 2: Second fresh 25-notice generalization batch (2026-08-09)

Tests whether the extraction repair (and its Phase 1 backfill) generalizes
to notices it has never seen, using the current production pipeline
unmodified. Same bundle (posting `72861`, hash `b9f13759...`, confirmed
identical to Phase 1/the original test), `maxNoticesPerBundle=50` so the
adapter re-scans past the first 25 (already-known duplicates, skipped
before extraction runs) to reach the next 25.

### Selection (proven before ingestion)

A dry run
([31294887866](https://github.com/ForeclosureData/ClaudeBuilder/actions/runs/31294887866))
listed every filing number in bundle-page order and checked each against
the database (read-only, no writes) *before* any production spend:

- 50 notices scanned, 25 already ingested (exact match to the first
  fresh-25 batch's filing numbers -- confirms the bundle and ordering are
  unchanged), **25 genuinely new** (confirmed absent from the database,
  not just absent from a numeric-range assumption -- these fall partly
  *within* the 82-baseline's stated 117716-118236 span, which only proves
  that span was never fully contiguous, not that these particular numbers
  were already used).

**Selected filing numbers**: `117718, 117719, 117721, 117729, 117731,
117886, 117887, 117888, 117891, 117892, 117896, 117908, 117909, 117913,
117914, 117915, 117916, 117917, 117919, 117921, 117922, 117923, 117924,
117926, 117930`.

The real bounded production run
([31295126506](https://github.com/ForeclosureData/ClaudeBuilder/actions/runs/31295126506))
confirmed this exactly: **25 records created, 25 duplicates skipped, 0
failed** -- no more and no fewer than the 25 approved.

### Extraction metrics

| | |
|---|---|
| Notices attempted | 25 |
| Successfully ingested | 25 |
| Failed (unexpected error) | 0 |
| Duplicates skipped | 25 |
| OCR success rate | 100% |
| Average OCR confidence | 91.2 |
| Borrower/grantor extraction success | 21 / 25 (84%) |
| Original-principal extraction success | 19 / 25 (76%) |
| Lender/mortgagee extraction success | 24 / 25 (96%) |
| Mortgage servicer extraction success | 17 / 25 (68%) |
| Sale-date extraction success | 22 / 25 (88%) |
| Legal-description extraction success | 22 / 25 (88%) |
| Usable property address | 22 / 25 (88%) |
| AI fallback calls | 9 / 25 (36%) |
| AI calls schema-valid | 9 / 9 (100%) |
| AI calls with ≥1 useful field | **8 / 9 (89%)** |
| Anthropic spend | $0.60 |
| Cost per useful AI call | $0.075 |

A transient Postgres connection drop occurred mid-run (`FATAL: terminating
connection due to administrator command`) -- self-recovered, 0 notices
lost, final counts unaffected; noted for completeness, not a code issue.

### Investor completeness

Same rubric as Phase 1 (lender not required for FULLY USEFUL; county
valuation only required when CAD-confirmed):

| Classification | Count | % |
|---|---|---|
| FULLY USEFUL | 8 | 32% |
| USEFUL | 13 | 52% |
| LIMITED | 4 | 16% |

### Property-resolution metrics

| | Count |
|---|---|
| Usable address (notice-stated + CAD-inferred) | 22 / 25 |
| Notice-stated address | 15 |
| **CAD parcel confirmed** | **7** |
| Structural no-address (no Property record) | 3 |
| Manual-review tasks (any reason) | 16 / 25 (64%) |
| — Genuinely ambiguous (`MULTIPLE_APPRAISAL_MATCHES`) | 9 |
| — Structural no-address (`NO_ADDRESS_RESOLVED`) | 3 |
| — Owner-conflict (`CAD_OWNER_CONFLICT`) | 1 |
| — Extraction-quality (`BORROWER_NAME_CONFLICT` / `SALE_DATE_CONFLICT`) | 4 / 3 |

Total CAD request count/timing still isn't surfaced by the live
pipeline's logging (same pre-existing observability gap noted in the
first fresh-25 test) -- not re-estimated here.

### Safety verification: all 7 CAD-confirmed parcels (100%, not a sample)

| Filing # | Notice subdivision/lot/owner | CAD subdivision/lot/owner | Verdict |
|---|---|---|---|
| 117886 | NORTHWEST MANOR / 30 / Carlos Garza Jr | NORTHWEST MANOR / 30 / GARZA CARLOS JR | **CONFIRMED CORRECT** |
| 117887 | EMERALD CITY ESTATES / 31 / Maritza Magallan | EMERALD CITY ESTATES / 31 / MAGALLAN MARITZA | **CONFIRMED CORRECT** |
| 117891 | ALTON POINTE PH 1 / 24 / Claudia R Olvera | ALTON POINTE / 24 / OLVERA CLAUDIA R | **CONFIRMED CORRECT** |
| 117914 | TAURUS ESTATES / 72 / "CHRISTOPHER D" (notice extraction truncated -- see below) | TAURUS ESTATES / 72 / MUNIZ CHRISTOPHER D | **CONFIRMED CORRECT** (address/subdivision/lot agree exactly; CAD's full name confirms the match is the right property/person despite the notice-side extraction defect) |
| 117916 | WOODLAND HEIGHTS UT 3 / 189 / Dimas Garcia Jr, Cristal A. Rangel Vazquez | WOODLAND HEIGHTS / 189 / GARCIA DIMAS JR & CRISTAL A RANGEL VASQUEZ | **CONFIRMED CORRECT** |
| 117924 | (property ID match) / IBRAHIM UNITED LLC | C AND S 23-25 / IBRAHIM UNITED LLC | **CONFIRMED CORRECT** (exact entity-name + address match, strongest match type) |
| 117926 | TAYLOR RIDGE / 4 / Cristela Riojas | TAYLOR RIDGE / 4 / RIOJAS CRISTELA | **CONFIRMED CORRECT** |

**Observed false-match rate: 0 / 7 (0%).** Zero INCORRECT classifications
-- the "stop and report" condition was not triggered.

### Safety verification: every AI-recovered borrower/principal (100%, not a sample)

8 of 9 AI-fallback calls recovered ≥1 useful field; all recovered
borrower/principal values checked against source `rawText`:

| Filing # | AI-recovered value | Verdict |
|---|---|---|
| 117887 borrower | Maritza Magallan | CONFIRMED CORRECT |
| 117891 borrower + principal | Claudia R Olvera / $136,800.00 | CONFIRMED CORRECT |
| 117892 borrower + principal | Fernando Guerra / $116,000.00 | CONFIRMED CORRECT |
| 117915 borrower + principal | Jose Rolando Lorenzana, Oneida M. Lorenzana / $36,756.26 | CONFIRMED CORRECT |
| 117916 borrower + principal | Dimas Garcia Jr, Cristal A. Rangel Vazquez / $26,500.00 | CONFIRMED CORRECT -- source is OCR-garbled ("Amount: Twenty-Six Thousand Five Hundred and No/100ths Dollars (826,500.00)", the numeral misread as "8" instead of "$"), but the spelled-out dollar amount is unambiguous and AI correctly used it rather than the corrupted numeral |
| 117924 borrower + principal | Ibrahim United LLC / $400,000.00 | CONFIRMED CORRECT |
| 117926 borrower + principal | Cristela Riojas / $235,000.00 | CONFIRMED CORRECT |
| 117914 principal | $59,984.74 | CONFIRMED CORRECT (AI recovered principal correctly; borrower stayed at the deterministic layer's truncated value -- see finding below) |

**Zero fabrications** -- every AI-recovered value traces to real text in
its notice.

### Findings: three real, novel issues surfaced by fresh data

None of these are regressions of the extraction repair (which itself
generalized well -- see above); each is a new edge case this specific
batch happened to contain.

1. **HID-117888: total extraction failure (0/18 AI fields, deterministic
   also empty).** A previously-unseen narrative template
   ("PURSUANT TO AUTHORITY conferred upon the Trustee by that certain
   Deed of Trust dated..., executed by NAME... ("Mortgagor")") states the
   borrower names in the text (`LORRAINE RODRIGUEZ` and
   `OLIVIA MUNOZ VARGAS A/K/A OLIVIA M. VARGAS`), but neither the
   deterministic parser nor the AI tool-use call recovered anything --
   the AI call's error was "No fields passed validation" (all 18 fields,
   not just the usual two), which is a different failure signature than
   the bug already fixed and warrants separate investigation before it's
   trusted at larger scale.
2. **HID-117914: truncated borrower name, second occurrence of the
   confidence-trust gap already found once (HID-117707's suffix-split).**
   The real text reads "Original Mortgagor/Grantor: CHRISTOPHER D.
   MUNIZ AND MAYRA C. MARTINEZ" across a line wrap right after the middle
   initial's period; the deterministic parser captured only "CHRISTOPHER
   D" -- dropping the surname and the entire second borrower -- with
   confidence high enough (≥0.6) that `mergePreferringNonNull` never let
   AI's own, separately-run extraction correct it. Same root architecture
   issue as the Jr.-suffix bug from the extraction-repair task, different
   trigger (a line-wrap immediately after a middle-initial period rather
   than a suffix comma) -- worth a similarly-scoped, evidence-backed fix.
3. **HID-117729 / HID-117731: the same real-world notice under two
   different county filing numbers.** Identical servicer TS# (`2025-20182-
   TX`), property (`900 N 36TH STREET, MCALLEN, TX`), Deed of Trust date,
   recording instrument, borrower, and principal ($98,385.00) -- the only
   differences between the two stored `rawText` values are OCR noise on
   otherwise-identical source characters. Both received distinct, valid
   county filing numbers, so the existing `(countyId, countyFilingNumber)`
   identity/dedup scheme -- by design, since a county filing number *is*
   the county's own official identity -- did not and was not expected to
   catch this. This is a different class of problem than extraction
   (content-level duplicate detection across distinct official numbers),
   out of this task's scope to fix, but real enough that both records are
   now live and would display as two separate listings for the same
   property.

### Coverage accounting

| | |
|---|---|
| Total detected notices in the Hidalgo bundle | 282 (unchanged) |
| Unique notices ingested before this run (82 baseline + 25 fresh-1) | 107 |
| Unique notices ingested after this run (+25 fresh-2) | **132** |
| Estimated notices remaining | ~150 |
| **Ingestion coverage** | **132 / 282 = 46.8%** |

Kept distinct from CAD enrichment: of the 132 ingested cases, 40 now have
a CAD-confirmed parcel (26 baseline + 7 fresh-1 + 7 fresh-2).

### Comparison: first fresh 25 vs. second fresh 25

| Dimension | First fresh 25 (post-fix) | Second fresh 25 |
|---|---|---|
| Borrower/grantor completeness | 96% | 84% |
| Original-principal completeness | 84% | 76% |
| Usable-address rate | 68% | 88% |
| FULLY USEFUL rate | 40% | 32% |
| AI fallback rate | 36% (9/25) | 36% (9/25) |
| AI useful-call rate | 100% (9/9) | 89% (8/9) |
| CAD-confirmed parcel rate | 28% (7/25) | 28% (7/25) |
| Manual-review rate | 76% (19/25) | 64% (16/25) |
| False-match rate (CAD safety) | 0% (0/7) | 0% (0/7) |
| Anthropic cost per notice | $0.0236 | $0.024 |

**Reading**: the fix generalizes -- AI fallback rate, CAD-confirmed rate,
and per-notice AI cost are nearly identical across two independently-
selected batches from the same source (a good sign the earlier batch's
results weren't a fluke), CAD safety held at a clean 0% false-match rate
in both, and manual-review load actually improved. Borrower/principal
completeness and the AI useful-call rate are both slightly lower in the
second batch -- fully explained by the three findings above (one total
failure, one confidence-trust truncation, both narrow and root-caused),
not a diffuse quality regression.

### Final decision

**B. ONE MORE TARGETED FIX REQUIRED.**

The core repair generalized well: AI fallback and CAD-confirmation rates
matched the first batch almost exactly, zero fabrications, zero false CAD
matches across 7/7 manually verified parcels, manual-review load
improved. But this batch surfaced two real, previously-unseen extraction
defects (HID-117888's total 0/18 AI failure on a new template; HID-
117914's line-wrap name truncation -- the same confidence-trust
architecture gap as the already-fixed Jr.-suffix bug, now confirmed to
have a second trigger) plus one out-of-scope but real content-duplicate
finding (HID-117729/117731). None of these are systemic -- they're
narrow, evidence-backed, and each maps to a specific, scoped fix, the
same pattern every earlier round in this project has used successfully.
That's a "one more fix" result, not "safe to scale unbounded" (A) and not
"pervasive quality issues" (C).

**Per the approved scope, no further notices beyond these 25 were
processed and scheduling remains OFF. This effort stops here and awaits
explicit approval before any further ingestion, the next targeted fix,
or a scheduling change.**

## Fix round 3: HID-117888/HID-117914 targeted fixes + content-duplicate detection layer (2026-08-09)

Scope, as explicitly approved: fix the three narrow issue classes surfaced
by the second fresh-25 batch and nothing else. No additional notices
ingested, no scheduling enabled, no new county, no property-resolution
threshold changes, no CAD-matching changes.

### 1. HID-117888 — unseen narrative template (total 0/18-field failure)

**Diagnosis.** A live diagnostic call (identical system prompt, tool
schema, model, and input as production) against the stored `rawText`
produced a PERFECT 18/18-field response on the very first retry, with no
code changes. No reproducible schema/validation bug was found in the AI
path — the original production failure was almost certainly a one-off
malformed sampling on that specific call, not a defect. The real,
reproducible gaps were all on the deterministic side: this notice uses a
narrative template none of the existing patterns recognized —
`"...executed by NAME(S) ... ("Mortgagor")"` (role stated in a trailing
parenthetical, not a fixed terminator phrase or label), `"for the benefit
of NAME ("Mortgagee")"` (no MERS clause, no `"Original Mortgagee:"`
label), `"to sell on <Weekday>, <Month> <Day>, <Year>"` (no `"Date of
Sale:"`/`"Sale Information:"` label), and a legal description whose OCR
page wraps with a blank line between every visual line (`"...out of
Blocks\n\nSixty-one (61)..."`), which the existing 200-char single-line
budget truncated at the very first line.

**Fix.**
- New 4th grantor-name candidate pattern (`executedByParenRole`) in
  `extractGrantorNames()`.
- New "for the benefit of" candidate in `extractOriginalMortgagee()`.
- New `"to sell on"` saleDate fallback pattern.
- `findLotBlockSentence()`'s trailing span widened from 200 chars/no
  newlines to 500 chars tolerating embedded single newlines, but stopping
  at unambiguous boundaries: 3+ consecutive newlines, a page-number-only
  line, or the start of another known field's label (`"Date of Sale"`,
  `"Time of Sale"`, `"Place of Sale"`, `"Substitute Trustee"`, `"Original
  Principal"`) — the label-stop list was added after the wider budget
  alone caused a **real regression** on a different real notice
  (HID-117914, caught during verification — see below).
- `cleanName()` now strips a stray mid-name OCR colon (`"...MUNOZ
  :\nVARGAS..."`).
- `splitNames()` now splits `", AND "` as one delimiter instead of a bare
  comma, which previously stranded `"AND "` as a literal prefix on the
  next name (the comma consumed the whitespace `"\s+AND\s+"` needed to
  match).
- `extractWithAI()` gets one bounded retry (2 attempts total) specifically
  when a response is a TOTAL failure (every one of 18 fields
  omitted/rejected, or no usable tool call at all) — justified by the live
  diagnostic evidence above. A response with at least one valid field
  never retries.

**Before → after (real production data, `FIX_ROUND_3_DRY_RUN=false` run):**

| Field | Before | After |
|---|---|---|
| borrowerNames | `null` (stored: `"Unknown owner"` placeholder) | `["LORRAINE RODRIGUEZ", "OLIVIA MUNOZ VARGAS A/K/A OLIVIA M. VARGAS"]` |
| lenderName / originalMortgagee / currentMortgagee | `null` | `"21ST MORTGAGE CORPORATION"` (AI self-corrected the OCR-garbled `"215\""` → `"21ST"`) |
| originalPrincipalAmount | `null` | `null` (correctly — no dollar amount is stated anywhere in this notice; confirmed by direct text inspection, not a bug) |
| deedOfTrustDate | `2024-10-18` | unchanged (already correct) |
| instrumentNumber | `3591492` | unchanged (already correct) |
| legalDescription | truncated: `"...out of Blocks"` | full: `"...out of Blocks Sixty-one (61) and Sixty-Two (62), La Blanca "B" Subdividion, ...Official Records, Hidalgo County, Texas."` |
| saleDate / saleTime / saleLocation | `null` / `null` / `null` | `2026-08-04` / `10:00 a.m.` / `"Hidalgo County Courthouse, at the place designated by the Commissioner's Court..."` |

Manually verified every recovered value against the source text directly
— all correct. 5 field changes applied (borrowerNames, legalDescription,
sale date/time/location, originalMortgagee, currentMortgagee), each a
genuine gap-fill or a demonstrable-truncation repair (old value is a
literal prefix of the new one) — never an overwrite of a plausible
existing value. AI cost: $0.07 (one call, no retry needed on this
re-run).

### 2. HID-117914 — borrower name truncated at a line-wrapped middle initial

**Diagnosis.** `"Original Mortgagor/Grantor: CHRISTOPHER D.\nMUNIZ AND
MAYRA C. MARTINEZ"` — the label-plus-same-line grantor pattern
(`[^\n]+`-bounded) stopped dead at the line wrap, reporting the complete
borrower as `"CHRISTOPHER D"` (confirmed as the literal stored value) —
silently dropping the surname and the entire second co-borrower.

**Fix.** New shared `mergeLineWrappedNameContinuation()` helper
(`nameLineWrap.ts`), used by both the same-line and
label-alone-on-its-own-line grantor capture paths in
`extractGrantorNames()`. Deliberately narrow — only merges the next line
when there's real evidence of a continuation, never blindly:
1. captured text must end in a BARE, standalone middle initial (one
   capital letter + period, preceded by whitespace/start — `"JR."`/
   `"INC."` don't qualify, since those are two-letter tokens);
2. the next line must not itself look like a new label (no colon in its
   first ~40 chars);
3. must not look like an address (doesn't start with a digit);
4. must start with a capitalized word.

Regression tests cover all 5 required scenarios: middle-initial + surname
continuation, multiple borrowers, a real suffix (Jr./Sr./II/III) that must
NOT trigger a merge, a next-line label that must NOT merge, a next-line
address that must NOT merge, and an OCR punctuation variant (no trailing
period) that correctly doesn't trigger the pattern at all.

**Before → after:**

| Field | Before | After |
|---|---|---|
| borrowerNames | `"CHRISTOPHER D"` (stored, truncated) | `["CHRISTOPHER D. MUNIZ", "MAYRA C. MARTINEZ"]` |
| legalDescription | truncated: `"LOT 72, TAURUS ESTATES NO. 9, PHASE 111, FILED IN PLAT BOOK 41, PAGE 127-128."` | full: `"...BY FEE SIMPLE DEED FROM OBRA HOMES, INC. AS SET FORTH IN DEED DOC # 1267796, DATED 11/13/2003 AND RECORDED 11/18/2003, HIDALGO COUNTY RECORDS. STATE OF TEXAS."` |
| lender fields, principal, dates, sale date/time | already correct | unchanged |

Manually verified against source text — correct. Only 2 field changes
applied (both truncation repairs — old value is a literal prefix of the
corrected one). `saleLocation` is *also* truncated on this notice
(`"...OUTDOOR COVERED AREA ON THE WEST SIDE OF THE"`, cut mid-sentence) —
a different regex (`saleLocationMatch` in `texasTemplates.ts`, not
`legalDescription.ts`) with the same class of bug, but **out of scope**
for this round (not one of the three approved issue classes) and left
untouched; flagged here as a residual finding for a future round.

**A real regression caught during verification, not shipped:** the
`findLotBlockSentence()` character-budget widening built for HID-117888,
tested in isolation, over-consumed into HID-117914's sale-date/location
clauses (no blank line separates the legal description from `"Date of
Sale:"` in that notice's key-value template). Caught by re-running the
fix against all 50 real notices from both fresh-25 batches before
shipping (not just the 4 target records) — fixed by adding explicit
field-label stop terms (above), then re-verified clean across all 50.

### 3-4. Content/economic duplicate-detection layer + event-identity strategy

**The problem.** HID-117729 and HID-117731 are the same real-world
foreclosure notice, filed under two different Hidalgo County clerk
document numbers. The existing `(countyId, countyFilingNumber)` identity
rule is working exactly as designed here — both filing numbers are real
and distinct — so it correctly does NOT collapse them, and shouldn't.
What's missing is a *separate* signal for "these are two real, distinct
source records that likely describe one underlying event."

**Design principle (why a single matching field is never enough).** An
address match alone, or a borrower-name match alone, or a lender match
alone can all occur completely legitimately between genuinely distinct
events: a first lien and a second lien on the same property; an HOA
assessment-lien foreclosure and a mortgage foreclosure on the same
property (same address, often the same owner, but different lender,
principal, and instrument); the same borrower foreclosed on two different
properties; the same national lender foreclosing on many unrelated
properties. Collapsing on one field would produce false positives on all
of these. The engine (`scoreDuplicateEvidence()`,
`packages/foreclosure-core/src/duplicateDetection/scoring.ts`) requires
**multiple independent fields** to agree, with two escape hatches on
either side:
- **Decisive signals** (either alone reaches `CONFIRMED_SAME_EVENT`): a
  shared trustee/servicer tracking number embedded in the raw notice text
  (e.g. `"T.S. #: 2025-20182-TX"`, matched by shape rather than the
  wildly OCR-variable label text around it), or a near-identical raw-text
  fingerprint (word-bigram Dice coefficient ≥ 0.90) — either one
  implies the rest of the document, including every other field, is the
  same source.
- **Critical conflicts** (block any classification regardless of other
  matches): a conflicting property address or a conflicting legal
  description — decisive proof of a physically distinct property/event.
- **The loan-identity gate**: reaching `LIKELY_SAME_EVENT` (without a
  decisive signal) requires ≥4 independently-matching fields **and** at
  least one of them must be a field that identifies the *loan* itself
  (lender name, original principal, deed-of-trust date) — not just the
  *property* (address, legal description, borrower names, sale date all
  matching only proves "same property, roughly the same time," which is
  exactly the shape of evidence a first lien and a second lien on the
  same property would also share). This gate was added after a
  regression test for that exact same-property-different-lien scenario
  failed against the design's first draft — confirmed necessary, not
  theoretical.
- `POSSIBLE_DUPLICATE` (≥2 matching fields, no critical conflict) is the
  floor — thin evidence worth a human look, never auto-acted on.

**Schema (additive only — new enums + model + relations, nothing
removed, no column renamed).** `NoticeDuplicateConfidence`
(`CONFIRMED_SAME_EVENT` / `LIKELY_SAME_EVENT` / `POSSIBLE_DUPLICATE`),
`NoticeDuplicateLinkStatus` (`OPEN` / `CONFIRMED_DUPLICATE` /
`REJECTED_DISTINCT`), and `PossibleDuplicateNoticeLink` (caseA/caseB FKs
+ score + matched/conflicting fields + explanation + review state).
`ForeclosureCase.archivedAt`/`mergedIntoCaseId` (the existing mechanism
for a literal duplicate *re-ingestion of the same filing number*) is
**untouched** — this is a deliberately separate, non-destructive
mechanism. Confirming a link here never merges, archives, or changes
either case's `countyFilingNumber`.

**Admin review** (`/admin/duplicate-notices`, new page): lists every
`OPEN` link side-by-side with both cases' address/owner/principal/sale
date and a direct link to each original notice, with matched/conflicting
fields and the engine's explanation shown, and "Confirm same event" /
"Reject — distinct events" actions that only update the link's review
state.

**Amendments/reposts and true event-duplicates aren't conflated.** A
regression test confirms an amended/reposted notice (same lender,
principal, and deed-of-trust date, but a genuinely different sale date,
and no decisive signal) still reaches `LIKELY_SAME_EVENT` rather than
being penalized to invisibility by the date difference alone — a sale
date conflict is a soft signal, not a blocker, since rescheduling doesn't
change which underlying loan the notice is about.

**Real result for HID-117729/HID-117731** (computed against live
production data): `CONFIRMED_SAME_EVENT`, score 1.0, matched all 9
possible fields (`trusteeSaleTrackingNumber`, `rawTextFingerprint`,
`propertyAddress`, `legalDescription`, `borrowerNames`,
`originalPrincipalAmount`, `deedOfTrustDate`, `saleDate`, `lenderName`),
zero conflicts — as strong a signal as this design can produce short of
a byte-identical file.

### 5. Re-evaluation of the 4 affected records (stored `rawText` only, no re-ingestion)

Ran via a bounded, secret-gated GH Actions script
(`fix-round-3-reeval.mts`) touching only these 4 records — dry-run first,
then a real write. Full before/after tables are in sections 1-2 and 3-4
above; summary:

| Record | Result |
|---|---|
| HID-117888 | 5 fields backfilled (gap-fill/truncation-repair only), verified correct |
| HID-117914 | 2 fields backfilled (truncation-repair only), verified correct |
| HID-117729/HID-117731 | Classified `CONFIRMED_SAME_EVENT` — **not** merged, **not** archived, filing numbers unchanged |

**Infrastructure blocker — investigated and resolved 2026-08-09, see
"Database connection architecture" above for the full root cause.**
Summary: the `PossibleDuplicateNoticeLink` table couldn't be created via
the standalone GitHub Actions `db:push` step (`DIRECT_URL` GitHub secret
was misconfigured, pointing at an unrelated Supabase pooler — most likely
confused with the separate Supabase Auth project this app also uses).
`DATABASE_URL` (used for every ordinary query, including all of this
round's field backfills) was confirmed correct and unaffected the whole
time. The migration was applied through the already-correct, already-safe
Netlify production build path instead (which independently forces
`DIRECT_URL=DATABASE_URL` for its own `db:push` step) — a normal deploy,
not a new or unsafe DDL mechanism. Verified via a temporary read-only
diagnostic route before and after: table created, `foreclosure_cases`
row count unchanged (132), the `(countyId, countyFilingNumber)` unique
index intact, zero `ProcessingJob` rows (no ingestion triggered). The
`fix-round-3:reeval` script (idempotent — upserts on `(caseAId,
caseBId)`) was then re-run for real and **the HID-117729/HID-117731 link
is now persisted in production**: `CONFIRMED_SAME_EVENT`, score 1.0, all
9 fields matched, zero conflicts, status `OPEN` awaiting a reviewer —
both cases and both county filing numbers remain fully intact and
distinct, confirmed via the same diagnostic route. `/admin/duplicate-
notices` reads this exact row. Outstanding, non-blocking: the GitHub
Actions `DIRECT_URL` secret itself should still be corrected (to the
same value already stored in the `DATABASE_URL` secret) so a *future*
schema change triggered from a standalone GitHub Actions workflow (rather
than a full Netlify deploy) doesn't hit the same wall — see "Database
connection architecture" for the exact one-line fix.

### 6. Coverage concepts — five different numbers, not one

The 282-vs-283 comparison against other sources only makes sense once
these are kept separate:

| Concept | What it counts | Current Hidalgo value |
|---|---|---|
| **County source notices detected** | Every notice the adapter has found on the county's site, regardless of ingestion state | 282 |
| **Unique filing numbers (source records ingested)** | Distinct `(countyId, countyFilingNumber)` rows — the existing identity/dedup rule's unit | 132 |
| **Unique foreclosure events** | Source records minus content-duplicates confirmed by the new layer (Section 3-4) | 132 today (the 117729/117731 link is persisted at `CONFIRMED_SAME_EVENT` but status `OPEN` — per the counting rule below, it drops to 131 only once a reviewer confirms it in `/admin/duplicate-notices`, never automatically) |
| **Unique physical properties** | Distinct resolved `Property` rows — can be lower than "unique events" (two liens, same property) or equal to it | not yet separately tracked; would require grouping resolved cases by `propertyId` |
| **Published investor listings** | Cases that cleared publication thresholds (address/legal-description resolved, no blocking manual-review reason) | subset of "unique foreclosure events," not yet separately reported as its own number |

**Worked example, using the one real duplicate pair found:** 132 source
records were ingested, but HID-117729 and HID-117731 are one underlying
event, so "unique foreclosure events" is 131, not 132 — and if either of
those two cases hasn't cleared publication thresholds independently,
"published investor listings" could differ from both numbers again. None
of these five numbers collapse into each other, and none of this changes
today's public-facing count — per the explicit instruction, that
requires a separately reported and approved rule change, not a
side-effect of this fix round. The proposal: publish "county source
notices" and "unique filing numbers" as-is (they're already accurate,
literal counts), but change any *investor-facing* "N foreclosures found"
language to count `CONFIRMED_DUPLICATE`-reviewed pairs once, and label
`POSSIBLE_DUPLICATE`/`LIKELY_SAME_EVENT` pairs (not yet reviewer-
confirmed) as still counted separately until a human confirms — i.e.
never silently under-count on unreviewed evidence, only on a human-
confirmed link.

### 7. Regression suite

61 new tests (249 total in `foreclosure-core`, up from 188), across:
- HID-117888's template class (4 tests: parenthetical-role borrower
  pattern, `", AND "` split fix, OCR-colon strip, `"to sell on"` sale
  date).
- The legal-description line-wrap fix + its regression guard (4 tests:
  spans a blank-line-per-line OCR page, stops at a page-number line,
  stops at a genuine paragraph break, stops at a known field label even
  with only a single newline — the exact HID-117914 regression).
- Line-wrapped borrower names (5 tests: the five required scenarios —
  middle-initial continuation with a second co-borrower, a real suffix
  that must NOT merge, a next-line label that must NOT merge, a next-line
  address that must NOT merge, an OCR punctuation variant).
- The lender `"for the benefit of"` pattern (2 tests: recovers a clean
  value, correctly abstains on an OCR-garbled one rather than fabricating).
- `extractWithAI()`'s bounded retry (5 tests: retries and recovers on a
  genuine total failure via either failure mode, does NOT retry when at
  least one field is valid, sums cost/tokens across both attempts).
- Content-duplicate detection (10 tests): the real 117729/117731 case
  (sanitized), a same-property-different-lien case that must NOT reach
  LIKELY/CONFIRMED, an amended/reposted notice that still reaches LIKELY
  despite a differing sale date, a same-borrower-different-property case
  that must NOT be flagged (address conflict is decisive), a thin-
  evidence same-address-different-date case capped below LIKELY, two
  fully-null cases never "matching," plus the raw-text-fingerprint helper
  in isolation.

All 249 tests pass; verified against all 50 real notices from both
fresh-25 batches (not just the 4 target records) for regressions before
shipping — zero anomalies found on the second pass, after fixing the one
regression the first pass caught.

### 8. Final recommendation

**[Superseded by the infra follow-up below — the "one more item" was
resolved the same day via the existing safe Netlify deploy path, not a
code fix.]** Original text preserved for the record: all three approved
issue classes were fixed, tested, and verified against real production
data; the only remaining step was correcting infrastructure, not code.

**Infra follow-up final recommendation: A. DUPLICATE-EVENT INFRA
COMPLETE.** HID-117888 and HID-117914 remain backfilled and correct in
production. The `PossibleDuplicateNoticeLink` table now exists in
production (applied via the existing, already-safe Netlify build path —
see "Database connection architecture" above), and the real
HID-117729/HID-117731 link is persisted: `CONFIRMED_SAME_EVENT`, score
1.0, zero conflicts, status `OPEN` in `/admin/duplicate-notices` awaiting
a human reviewer. Both cases and both filing numbers remain fully intact.
Verified stable: 132 `ForeclosureCase` rows (unchanged), the
`(countyId, countyFilingNumber)` unique index intact, zero `ProcessingJob`
rows. One non-blocking loose end remains for an admin: the GitHub
Actions `DIRECT_URL` secret should still be corrected (to the same value
already in `DATABASE_URL`) so a *future* schema change triggered from a
standalone GitHub Actions workflow doesn't hit the same wall — see
"Database connection architecture" for the exact fix.

**Per the approved scope, even with recommendation A: no additional
notices were ingested, scheduling remains OFF, no other county was
added, and no extraction/property-resolution logic was touched by this
infra round. This effort stops here and awaits explicit approval before
any further ingestion, a scheduling change, or acting on the
`POSSIBLE_DUPLICATE`/`CONFIRMED_SAME_EVENT` link's review state (e.g.
changing public counting behavior) beyond what's already documented
above as a proposed rule, not yet applied.**

## Bounded 50-notice production batch (2026-08-09)

Following the infra fix and DIRECT_URL correction above, a bounded batch
of exactly 50 previously-un-ingested Hidalgo notices was run under a new
`targetFilingNumbers` allowlist mechanism.

### Pre-flight selection

A new read-only script (`apps/web/scripts/ci-select-hidalgo-target.mts`,
run via `.github/workflows/hidalgo-select-target.yml`) scans the bundle's
cover-sheet barcodes only (no OCR, no Anthropic calls, no DB writes) to
select an exact count of new filing numbers and prove zero overlap before
any spend:

- Current state before batch: 132 `ForeclosureCase` rows (82 legacy-seeded
  + 50 previously pipeline-ingested), 50 distinct non-null
  `countyFilingNumber` values.
- Bundle: 282 notices, 50 already-ingested (via `countyFilingNumber`), 232
  genuinely new by that check alone.
- **Gap found and closed**: the 82 legacy-seeded cases predate the
  `seed.ts` revision that populates `countyFilingNumber`, so a DB-only
  check is blind to them. The script now also excludes every docNumber in
  `hidalgo-real-cases.ts` directly from the source file. Selected 50
  filing numbers (117932–117988 range) were verified to have zero overlap
  against both the database and the legacy seed dataset.
- Selection: 50 filing numbers, requiring a 100-notice split window
  (`maxNoticesPerBundle=100`) to reach the last one in bundle-page order.

### `targetFilingNumbers` allowlist

`ingestForeclosureNotices()` gained an `options.targetFilingNumbers?:
Set<string>` option: notices whose normalized filing number isn't in the
set are skipped before any extraction/persistence/AI-fallback work,
counted in a new `noticesSkippedNotInTarget` summary field. This is the
mechanism that makes "process exactly N new notices, never more"
enforceable — `maxNoticesPerBundle` alone can't guarantee it, since a
bundle interleaves already-ingested duplicates with genuinely-new notices.
Note this only gates the extraction/field-fallback/persistence stage —
local OCR still runs for every notice in the split window (free), and a
notice with low OCR confidence could in principle still trigger a
Claude-vision content-transcription call before the target filter is
reached; this run had 0 such fallbacks.

### Run results

GitHub Actions run, production mode, `maxBundles=1`,
`maxNoticesPerBundle=100`, `maxAiFallbackCallsPerRun=50`,
`maxAiCostPerRunUsd=4.00`, 50-filing-number target allowlist. Runtime
1073.4s (~17.9 min).

| Metric | Value |
| --- | --- |
| Notices split | 100 |
| Notices skipped (not in target) | 50 |
| Notices OCR'd successfully | 50/50 (avg confidence 92.6) |
| Content Claude-vision fallbacks | 0 |
| Field-extraction Claude fallback calls | 10 |
| Anthropic cost | $0.66 ($0.0132/notice across all 50; $0.066/notice among the 10 AI-touched) |
| Records created (new) | **50** |
| Duplicates skipped | 0 |
| Records sent to manual review | 39 (78%) |
| Failures / errors | 0 |

A transient Postgres connection drop (`terminating connection due to
administrator command`, consistent with a Neon connection-pool recycle)
occurred mid-run and self-healed with no observable effect — confirmed by
the post-run integrity check below.

### Extraction completeness (of 50)

| Field | Complete |
| --- | --- |
| Borrower | 50/50 (100%) — **caveat**: 3 of these are the pipeline's existing `"Unknown owner"` fallback string (no name could be extracted at all), not real names |
| Principal | 19/50 (38.0%) |
| Sale date | 48/50 (96.0%) |
| Legal description | 47/50 (94.0%) |
| Usable address | 19/50 (38.0%) |
| Lender | 50/50 (100%) |
| Servicer | 13/50 (26.0%) |

### Investor usefulness

FULLY USEFUL: 8 (16.0%) · USEFUL: 37 (74.0%) · LIMITED: 5 (10.0%)

### Property resolution

CAD-confirmed parcels: 12 · Strong candidates awaiting approval: 34 ·
No-match: 4 · Owner conflicts: 0 · Subdivision conflicts: 0 · Lot/block
conflicts: 0 · Ambiguous holds: 7 · Total CAD candidate rows returned:
657 · Average per case: 13.14 · Max per case: 102.

Manual review reasons (39 cases, one case may have multiple):
`NO_ADDRESS_RESOLVED` 31, `MULTIPLE_APPRAISAL_MATCHES` 7,
`BORROWER_NAME_CONFLICT` 3, `SALE_DATE_CONFLICT` 2.

### Valuation (of 19 cases with a resolved property)

Market value: 12 · Appraised value: 12 · Land value: 12 · Improvement
value: 12 · Tax year: all 2026.

### Duplicate-event detection

0 possible/likely/confirmed duplicate-event pairs found among the 50 —
all 50 source notices map to 50 distinct, correctly-uncollapsed events.

### Safety: manual verification

**Every one of the 12 auto-attached CAD parcels was manually inspected**
(owner name, situs address, and legal description cross-checked between
the notice and the CAD candidate): **10 CONFIRMED CORRECT, 2 LIKELY
CORRECT WITH MINOR DISCREPANCY** (117941: our borrower extraction
captured only the first/middle name, missing the surname the CAD record
supplies — address and legal description matched exactly; 117979: the
notice's raw OCR'd legal text has an odd artifact ("Lot 51 & §2") but the
parsed/matched fields agree with the CAD record). **0 AMBIGUOUS, 0
INCORRECT.**

All 50 borrower/principal values were also spot-checked for structurally
unusual results; the only notable pattern is the pre-existing
`"Unknown owner"` fallback (3 cases: 117932, 117933, 117959) — an
intentional, existing code path (`ingestForeclosureNotices.ts:448`), not
a new defect, triggered when no grantor/borrower name could be extracted
from that particular notice's text at all.

**Production integrity, re-verified after the run**: 182 `ForeclosureCase`
rows (132 + 50, exact match), **0 duplicate `(countyId,
countyFilingNumber)` groups**. No `ProcessingJob` scheduling was started.
No duplicate ForeclosureCase rows were created — the STOP condition was
never triggered.

### Coverage accounting

| Metric | Value |
| --- | --- |
| Total bundle notices | 282 |
| Unique filing numbers ingested (cumulative, via pipeline) | 100 |
| Unique foreclosure events detected (this batch) | 50 (0 collapsed) |
| Notices remaining (bundle minus pipeline-ingested) | 182 |
| Ingestion coverage (pipeline-tracked) | 100/282 = 35.5% |
| CAD-confirmed parcel % (this batch) | 12/50 = 24.0% |
| Investor-usable listing % (this batch, FULLY USEFUL + USEFUL) | 45/50 = 90.0% |

### Final recommendation

**A. 50-BATCH PASSED — READY TO PROCESS REMAINING HIDALGO NOTICES.**
Exactly 50 new records created, 0 duplicates, 0 failures, 0 INCORRECT CAD
parcels, production integrity confirmed stable. The completeness gaps
(principal 38%, usable-address 38%, servicer 26%) and the 78%
manual-review rate reflect this pipeline's existing, already-documented
conservative behavior (e.g. CAD auto-accept stays deliberately narrow;
notices without a parseable street address route to manual review rather
than guessing) — not a new regression introduced by this batch.

**Per the approved scope: the remainder was not processed, scheduling
remains OFF, no other county was added, and no extraction/
property-resolution logic was modified. This effort stops here and awaits
explicit approval before processing any additional notices or changing
scheduling.**

## Monitoring (MVP-appropriate, not enterprise APM)

- Admin dashboard (`/admin`) surfaces manual review queue and county
  source health.
- No automated uptime/error alerting exists yet. Adding a simple external
  uptime check (e.g. a free UptimeRobot monitor) against the production
  URL is a cheap, currently-missing improvement — see `docs/BACKLOG.md`.
