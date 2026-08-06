# Cost Controls

The subscription price (~$5/mo) only works if per-user infrastructure and
AI cost stays a small fraction of that. This document lists every control
in the codebase and where it lives.

## Ingestion-time controls

| Control | Where |
|---|---|
| Skip re-download of unchanged county pages | `CountySource.lastAttemptAt` / ETag-style check in adapter (documented hook) |
| Skip re-processing of unchanged documents | `SourceDocument.sha256Hash` unique constraint; pipeline checks hash before doing any work |
| Extract embedded PDF text before OCR | `lib/extraction/pipeline.ts` step order; OCR provider only invoked for pages flagged `hasUsableText = false` |
| OCR only flagged pages, not whole documents | `OcrProvider.recognizePage(page)` — per-page, not per-document |
| Deterministic parsing before AI | `lib/extraction/pipeline.ts`: Layer 2 (AI) only runs on fields Layer 1 left `null`/low-confidence |
| AI JSON schema keeps prompts small & responses parseable without retries | `lib/extraction/ai/schema.ts` |
| Monthly AI/OCR budget cap | `BudgetLimit` table; `lib/jobs/queue.ts` refuses to enqueue `AI_EXTRACT`/`OCR_PAGE` jobs once the current month's summed `costCents` meets the cap |
| Retry limits + dead-letter | `ProcessingJob.attempts` / `maxAttempts`; jobs exceeding max move to `DEAD_LETTER` status instead of retrying forever |
| Per-document cost tracking | `SourceDocument.processingCostCents`, summed from the `ProcessingJob.costCents` of jobs tied to it |
| Admin alert when cost exceeds limit | Admin dashboard cost widget turns red past `BudgetLimit.alertThresholdPct`; hook point for email/Slack alert in `lib/jobs/processors` (documented, not wired to a real notifier in MVP) |

## Serving-time controls

| Control | Where |
|---|---|
| Summaries generated once, stored, never regenerated per page view | `ForeclosureCase.summaryText` column, written by `GENERATE_SUMMARY` job |
| Property list/detail pages are server components reading Postgres directly | No client-side re-fetch loops, no polling |
| CSV export is a bounded, plan-limited batch job, not unlimited on-demand generation | `ExportJob` + `PlanConfig.monthlyCsvExportLimit` |
| Free tier hides enriched fields server-side | `lib/billing/plans.ts` — field visibility resolved on the server, not hidden via CSS |

## What this MVP deliberately does NOT do (to control cost)

- No vector database / embeddings — search is plain SQL filtering, which
  is what the spec's filter list actually needs.
- No microservices, no message broker — one Postgres-backed job queue.
- No per-request AI calls for "smart" UI copy — the AI summary is
  generated once per case at ingestion time.
- No OCR library bundled by default — `OcrProvider` is an interface with a
  stub implementation until real document volume justifies the dependency
  and its cost.

## Approximate processing cost per notice (displayed in admin + doc detail)

`SourceDocument.processingCostCents` is the sum of:
- Download bandwidth (negligible, not separately metered in MVP)
- OCR cost, if any pages required OCR (`$ per page` from the active OCR
  provider config)
- AI extraction cost, if Layer 2 fired (`$ per 1K tokens` from the active
  model's published pricing, computed from actual token usage returned by
  the API call)

Displayed on the document detail panel and aggregated on the admin cost
dashboard, split by county and by day/month.
