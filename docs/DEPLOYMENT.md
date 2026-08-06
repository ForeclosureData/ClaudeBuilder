# Deployment

## Recommended production setup (cheap, boring, reliable)

- **App hosting:** Netlify or Vercel, Next.js App Router build. Either
  works; Netlify is already used elsewhere in this repo's parent org.
- **Database:** Supabase (hosted Postgres) free/small-tier to start.
  Supabase Auth is *not* used (NextAuth/Credentials is used instead, to
  keep auth logic in-repo and portable) — only Supabase's Postgres and
  optionally its Storage bucket for documents.
- **Object storage:** Supabase Storage (S3-compatible) or Cloudflare R2 for
  source PDFs, behind the `StorageAdapter` interface in `lib/storage`.
- **Background jobs:** a scheduled function (Netlify Scheduled Functions /
  Vercel Cron) invoking `POST /api/jobs/run` on a fixed interval (e.g.
  every 5–15 minutes), which claims a small batch of `ProcessingJob` rows
  and processes them within the function's time limit. No separate worker
  fleet needed at MVP scale.
- **Payments:** Stripe (Checkout + Billing Portal + webhook).

## Environment variables

See `.env.example`. At minimum for a working deploy:
`DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`STRIPE_PRICE_ID_MONTHLY`.

## First deploy checklist

1. Provision Postgres (Supabase project or any managed Postgres).
2. `npm install`
3. `npm run db:migrate` (or `db:push` for a quick first deploy) against the
   production `DATABASE_URL`.
4. `npm run db:seed` **only** in a demo/staging environment — never seed
   fictional data into a real production database.
5. Set all required env vars in the hosting provider.
6. Configure the Stripe webhook endpoint to point at
   `https://<domain>/api/stripe/webhook` and copy the signing secret into
   `STRIPE_WEBHOOK_SECRET`.
7. Configure the scheduled function to call the job runner endpoint.
8. Smoke test: sign up, view property list/detail, upgrade flow (Stripe
   test mode), CSV export, watchlist.

## Local development

```bash
cd foreclosuredata
cp .env.example .env
docker compose up -d          # local Postgres on 5433
npm install
npm run db:push
npm run db:seed
npm run dev                   # http://localhost:3100
npm run test                  # unit tests
```

## Backup & recovery

- Use your Postgres provider's automated daily backups (Supabase provides
  this on paid tiers; for free tier, add a scheduled `pg_dump` to object
  storage).
- Source documents are content-addressed by SHA-256 (`SourceDocument.sha256Hash`)
  — losing the storage bucket loses raw PDFs but not extracted data;
  re-downloading from the original county source URL (if still available)
  restores them.
- Treat `ExtractedField`, `ForeclosureCase`, `Property`, and `Loan` tables
  as the primary asset to protect — they represent the processing work
  already paid for.

## Monitoring (MVP-appropriate, not enterprise APM)

- Admin dashboard (`/admin`) surfaces: failed jobs, dead-lettered jobs,
  county-source sync health, and monthly AI/OCR spend vs. budget.
- Add a simple external uptime check (e.g. a free UptimeRobot monitor) on
  `/api/health` in production.
