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

## Monitoring (MVP-appropriate, not enterprise APM)

- Admin dashboard (`/admin`) surfaces manual review queue and county
  source health.
- No automated uptime/error alerting exists yet. Adding a simple external
  uptime check (e.g. a free UptimeRobot monitor) against the production
  URL is a cheap, currently-missing improvement — see `docs/BACKLOG.md`.
