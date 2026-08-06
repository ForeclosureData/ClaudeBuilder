# County & State Expansion Roadmap

ForeclosureData is **Texas-first**, starting with Hidalgo County. The
architecture is built to eventually support nationwide coverage, but this
document describes a deliberately staged rollout — we do not build (or
claim) more coverage than is actually live.

**The public site only ever lists a county as available once its
`availabilityStatus` is `SUPPORTED`.** Every other county shown (via
search, `/counties`, or a county's own page) is explicitly labeled
"coming soon" with its real status. The Texas Unlimited plan is described
as *"Access every currently supported Texas county, including newly added
Texas counties as they launch"* — never as covering all of Texas until
that's true.

## County availability lifecycle

`CountyAvailabilityStatus` (see `packages/database/prisma/schema.prisma`):

`REQUESTED → RESEARCHING → CONNECTOR_DEVELOPMENT → TESTING → SUPPORTED`,
with `TEMPORARILY_UNAVAILABLE` and `DEPRECATED` as off-ramps at any point
(e.g. a county changes its posting site and the connector needs rework).

Each `County`/`CountySource` row tracks, per the pilot's own KPI needs:
source website, source vendor, access method, whether direct downloads
are available, whether authentication or CAPTCHA is present, whether
documents have embedded text vs. need OCR, last successful sync,
connector health, known access restrictions, approximate monthly notice
volume, and the raw counters used to compute address-resolution success
rate, manual-review rate, and processing cost per notice (see "Pilot
KPIs" below).

## Source access methods (adapter-based, never bypasses controls)

`SourceAccessMethod` enumerates how an adapter is allowed to reach a
county's notices — chosen per county based on what that county's site
actually supports, never by working around a technical control:

- `DIRECT_HTTP_DOWNLOAD` — a stable URL serves the PDF directly (Hidalgo's fixture adapter models this).
- `HTML_PAGE_PARSING` — notices are listed in HTML, no PDF index API.
- `VENDOR_SEARCH_PORTAL` — a third-party posting vendor (e.g. a shared county-notice platform) with a search UI.
- `BROWSER_AUTOMATION` — Playwright, only when a portal requires JS interaction and permits automated access.
- `OFFICIAL_API` — the county or a vendor exposes a real API.
- `APPROVED_BULK_DATA_FEED` — a negotiated data-sharing arrangement.
- `PUBLIC_INFORMATION_REQUEST_IMPORT` — records obtained via a public-information request, imported manually.
- `MANUAL_ADMINISTRATOR_UPLOAD` — an admin uploads notices by hand until a connector is justified.

We never bypass CAPTCHA, authentication, or rate limits. A county whose
site requires that gets `MANUAL_ADMINISTRATOR_UPLOAD` or
`PUBLIC_INFORMATION_REQUEST_IMPORT` until a legitimate access path exists.

## State-level configuration (no Texas-only hardcoding)

`StateConfig` (keyed by `stateCode`) holds jurisdiction-specific
foreclosure procedure notes, terminology (e.g. "substitute trustee"),
statutory notice periods, and court-system notes. `County.state` links to
it. Shared domain models (`ForeclosureCase`, `Loan`, `ForeclosureSale`,
etc.) never encode Texas-only assumptions directly — a new state ships by
adding a `StateConfig` row and a county adapter, not by editing those
models.

## Rollout phases

1. **Hidalgo County end-to-end pilot.** Prove discovery → download →
   hashing → extraction → address resolution → manual review → summary →
   subscription/entitlement gating, all the way through. This is the
   current build.
2. **Five to ten varied Texas counties.** Deliberately different source
   systems and volumes: Cameron, Bexar, Dallas or Tarrant, Harris, and at
   least one smaller rural county (Starr) — chosen to stress-test the
   adapter interface against real variety, not to chase coverage.
3. **Highest-demand Texas counties**, prioritized by the criteria below.
4. **Broad Texas coverage.**
5. **One carefully selected additional state** — the first real test of
   the `StateConfig` abstraction.
6. **Repeatable state expansion**, using whatever process phase 5 proves out.

We do not begin live nationwide ingestion at any point in this roadmap
without first proving the pipeline at each smaller scale.

## Expansion prioritization criteria

A county/state's position in the queue is a function of:

- User requests (`CountyRequest` rows — the public "Request a County" form)
- Population
- Foreclosure notice volume
- Search demand (autocomplete queries for unsupported counties)
- Technical feasibility (access method, CAPTCHA/auth, OCR burden)
- Processing cost per notice
- Revenue potential

## Pilot KPIs (tracked per `CountySource`)

- Notices discovered (`noticesDiscoveredCount`)
- Download success rate (`documentsDownloadedCount` / `noticesDiscoveredCount`, failures in `downloadFailureCount`)
- Extraction success rate (`documentsProcessedCount` minus `extractionFailureCount`, over attempts)
- Address-resolution success rate (`addressResolvedCount` / `documentsProcessedCount`)
- False-match rate (`falseMatchReportedCount` / `addressResolvedCount` — sourced from `CorrectionReport`s confirmed as address errors)
- Manual-review rate (`manualReviewCount` / `documentsProcessedCount`)
- Average processing cost (`totalProcessingCostCents` / `documentsProcessedCount`)
- Average processing time (derived from `ProcessingJob` timestamps)
- Connector failures (`connectorFailureCount`)
- Notice cancellation detection rate (`cancellationsDetectedCount` / expected cancellations from `RECHECK_NOTICE` jobs)

These are surfaced on the admin dashboard's county-health view so a
county can be judged ready to move `TESTING → SUPPORTED` on evidence, not
guesswork.

## Per-county checklist (unchanged from earlier draft, still applies)

- [ ] Confirm public posting site URL(s), source vendor, and robots.txt / terms of use
- [ ] Confirm access method (see enum above) and document any CAPTCHA/auth
- [ ] Confirm whether notices are text-based PDFs or scans (OCR cost)
- [ ] Confirm appraisal-district data access for address resolution
- [ ] Confirm trustee-sale posting cadence to size the polling schedule
- [ ] Add fixtures + adapter tests before requesting `TESTING` status
- [ ] Set an initial monthly AI/OCR budget for the county in `BudgetLimit`
- [ ] Review pilot KPIs above before promoting to `SUPPORTED`
