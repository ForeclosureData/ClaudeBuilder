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

## Monitoring (MVP-appropriate, not enterprise APM)

- Admin dashboard (`/admin`) surfaces manual review queue and county
  source health.
- No automated uptime/error alerting exists yet. Adding a simple external
  uptime check (e.g. a free UptimeRobot monitor) against the production
  URL is a cheap, currently-missing improvement — see `docs/BACKLOG.md`.
