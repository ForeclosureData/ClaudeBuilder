# supabase/

This directory exists for compatibility with the Supabase CLI (`supabase
db reset`, `supabase migration up`, etc.) and so a reviewer can see the
exact SQL that will run against a real Supabase project.

**Prisma (`packages/database/prisma/schema.prisma`) is the source of
truth.** These migration files are generated from it, not hand-maintained:

```bash
# Regenerate 0001_init.sql after changing schema.prisma:
pnpm --filter @foreclosuredata/database exec prisma migrate diff \
  --from-empty --to-schema-datamodel prisma/schema.prisma --script \
  > ../../supabase/migrations/0001_init.sql
```

`0002_rls.sql` is a copy of `packages/database/sql/rls.sql` (Row Level
Security policies + the `profiles.id → auth.users.id` foreign key +
the `handle_new_user` trigger). Edit the original and re-copy — see that
file's header for why it can't be a normal Prisma migration.

For day-to-day development against the local docker-compose Postgres,
just use Prisma directly (`pnpm db:push`, `pnpm db:seed`) — you only need
this directory when standing up or resetting a real Supabase project.
