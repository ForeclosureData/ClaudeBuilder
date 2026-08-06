# Backlog

## MVP (this build)

- [x] Architecture docs, folder structure, `.env.example`
- [x] Prisma schema covering the full entity list
- [x] Auth (sign up / sign in, USER / ADMIN roles)
- [x] Demo seed data (fictional Hidalgo County records)
- [x] Property list page: filters, pagination, indexes
- [x] Property detail page: overview, summary, source evidence, documents
- [x] Watchlist (saved properties)
- [x] CSV export (plan-limited)
- [x] "Report incorrect information" flow → `CorrectionReport`
- [x] Admin dashboard: source health, jobs, review queue, corrections, cost
- [x] County adapter interface + Hidalgo mock/fixture adapter
- [x] Deterministic extraction layer (dates, currency, legal description, TX templates)
- [x] AI-extraction schema + gated fallback (disabled without API key/budget)
- [x] Address-resolution service with confidence + explanation
- [x] Balance-estimation module (separate, clearly labeled estimate)
- [x] Stripe subscription scaffold (checkout, webhook, portal)
- [x] Unit tests for parsers/calculators
- [x] Disclaimer/compliance page
- [ ] Real Hidalgo County live adapter (blocked on ToS/site review — see Architecture §11)

## Post-MVP

- Email alerts for new/matching properties per saved search
- Manual-review admin UI: inline field correction with audit trail
- Duplicate-property merge tool in admin
- OCR provider wired to a real engine, page-level cost tracking in UI
- Real geocoding provider wired in (after probable address identified)
- Appraisal-district connector for Hidalgo (real data source)
- Per-county polling scheduler with backoff and health alerting
- Stripe dunning emails / past-due banners
- Rate limiting middleware (e.g. token bucket per IP + per user)
- Signed, expiring URLs for document downloads
- Full audit log UI with diffing
- Data retention job (purge old export files, stale sessions)

## Future

- Roll out adapters for additional Texas counties (see `docs/COUNTY_ROADMAP.md`)
- Skip-tracing integration (optional, opt-in, only after legal/vendor review)
- Multi-state expansion beyond Texas
- Team/organization accounts with seat-based billing
- Public API for title companies / lenders (higher-tier plan)
- Saved-search alerting via SMS
- Investor underwriting helpers (comps, rehab estimator) as a premium add-on
- Mobile app / PWA polish
