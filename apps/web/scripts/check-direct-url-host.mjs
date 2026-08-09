/**
 * ONE-OFF, read-only: prints only the hostname/port of DATABASE_URL and
 * DIRECT_URL (never the credentials) so a human can confirm DIRECT_URL now
 * resolves to the same production host family as DATABASE_URL, after the
 * GitHub Actions secret was corrected. No Prisma Client import, no DB
 * connection attempted -- pure string parsing of the two env vars, so this
 * cannot touch schema or data. Deleted immediately after use.
 */
function hostPort(name) {
  const raw = process.env[name];
  if (!raw) {
    console.log(`${name}: NOT SET`);
    return;
  }
  try {
    const u = new URL(raw);
    console.log(`${name}: hostname=${u.hostname} port=${u.port || "(default)"} db=${u.pathname.slice(1)}`);
  } catch {
    console.log(`${name}: (unparseable)`);
  }
}

hostPort("DATABASE_URL");
hostPort("DIRECT_URL");
