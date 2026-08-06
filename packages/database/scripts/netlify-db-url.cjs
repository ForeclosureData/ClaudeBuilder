#!/usr/bin/env node
/**
 * Prints Netlify's auto-provisioned Postgres connection string to stdout, so
 * the Netlify build command can `export DATABASE_URL=$(node this-script.cjs)`
 * before running `prisma db push` / `prisma db seed` — those are separate CLI
 * processes that read DATABASE_URL directly from the shell, unlike the app
 * code's own fallback in packages/database/src/index.ts. Only relevant when
 * no project-specific DATABASE_URL (e.g. Supabase) is already configured.
 */
try {
  const { getConnectionString } = require("@netlify/database");
  const connectionString = getConnectionString();
  if (connectionString) {
    process.stdout.write(connectionString);
  }
} catch {
  // Not running in a context where @netlify/database can resolve a connection
  // — print nothing, the caller falls back to whatever DATABASE_URL is set.
}
