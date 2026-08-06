-- ForeclosureData — Row Level Security + Supabase auth wiring.
--
-- Run this ONLY against a real Supabase Postgres instance (it references
-- `auth.users`, which does not exist on the local docker-compose Postgres
-- used for plain Prisma dev work). After `prisma db push`/`migrate deploy`
-- has created the tables, apply this file once per environment:
--
--   pnpm --filter @foreclosuredata/database db:rls
--
-- Re-running is safe: every statement is idempotent (IF NOT EXISTS / OR
-- REPLACE / DROP POLICY IF EXISTS before CREATE POLICY).

-- ── Tie profiles.id to Supabase's auth.users ────────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'profiles_id_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_id_fkey
      foreign key (id) references auth.users (id) on delete cascade;
  end if;
end $$;

-- Auto-create a profile row whenever a Supabase auth user is created.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, created_at, updated_at)
  values (new.id, new.email, now(), now())
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── Helper: is the current user an admin? ───────────────────────────────
create or replace function public.is_admin()
returns boolean as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'ADMIN'
  );
$$ language sql security definer stable;

-- ── Enable RLS everywhere ────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.saved_properties enable row level security;
alter table public.correction_reports enable row level security;
alter table public.export_jobs enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notification_events enable row level security;
alter table public.properties enable row level security;
alter table public.foreclosure_cases enable row level security;
alter table public.foreclosure_sales enable row level security;
alter table public.loans enable row level security;
alter table public.source_documents enable row level security;
alter table public.counties enable row level security;
alter table public.plan_configs enable row level security;

-- ── User-owned tables: row owner or admin only ──────────────────────────
drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_update_own_or_admin" on public.profiles;
create policy "profiles_update_own_or_admin" on public.profiles
  for update using (id = auth.uid() or public.is_admin());

drop policy if exists "subscriptions_select_own_or_admin" on public.subscriptions;
create policy "subscriptions_select_own_or_admin" on public.subscriptions
  for select using (profile_id = auth.uid() or public.is_admin());

drop policy if exists "saved_properties_owner_all" on public.saved_properties;
create policy "saved_properties_owner_all" on public.saved_properties
  for all using (profile_id = auth.uid() or public.is_admin())
  with check (profile_id = auth.uid());

drop policy if exists "correction_reports_owner_select" on public.correction_reports;
create policy "correction_reports_owner_select" on public.correction_reports
  for select using (profile_id = auth.uid() or public.is_admin());

drop policy if exists "correction_reports_owner_insert" on public.correction_reports;
create policy "correction_reports_owner_insert" on public.correction_reports
  for insert with check (profile_id = auth.uid() or profile_id is null);

drop policy if exists "correction_reports_admin_update" on public.correction_reports;
create policy "correction_reports_admin_update" on public.correction_reports
  for update using (public.is_admin());

drop policy if exists "export_jobs_owner_all" on public.export_jobs;
create policy "export_jobs_owner_all" on public.export_jobs
  for all using (profile_id = auth.uid() or public.is_admin())
  with check (profile_id = auth.uid());

drop policy if exists "notification_preferences_owner_all" on public.notification_preferences;
create policy "notification_preferences_owner_all" on public.notification_preferences
  for all using (profile_id = auth.uid() or public.is_admin())
  with check (profile_id = auth.uid());

drop policy if exists "notification_events_owner_select" on public.notification_events;
create policy "notification_events_owner_select" on public.notification_events
  for select using (profile_id = auth.uid() or public.is_admin());

-- ── Public-record domain tables: read for anyone, write for admin/service ──
-- These are public records. RLS here is a backstop against accidental
-- writes from a non-service-role connection, not a content-visibility
-- control — field-level plan gating (free vs. paid) happens in the API
-- layer via the entitlement service, since RLS cannot mask columns.
drop policy if exists "counties_read_all" on public.counties;
create policy "counties_read_all" on public.counties for select using (true);
drop policy if exists "counties_admin_write" on public.counties;
create policy "counties_admin_write" on public.counties for all using (public.is_admin());

drop policy if exists "plan_configs_read_all" on public.plan_configs;
create policy "plan_configs_read_all" on public.plan_configs for select using (true);
drop policy if exists "plan_configs_admin_write" on public.plan_configs;
create policy "plan_configs_admin_write" on public.plan_configs for all using (public.is_admin());

drop policy if exists "properties_read_all" on public.properties;
create policy "properties_read_all" on public.properties for select using (true);
drop policy if exists "properties_admin_write" on public.properties;
create policy "properties_admin_write" on public.properties for all using (public.is_admin());

drop policy if exists "foreclosure_cases_read_all" on public.foreclosure_cases;
create policy "foreclosure_cases_read_all" on public.foreclosure_cases for select using (true);
drop policy if exists "foreclosure_cases_admin_write" on public.foreclosure_cases;
create policy "foreclosure_cases_admin_write" on public.foreclosure_cases for all using (public.is_admin());

drop policy if exists "foreclosure_sales_read_all" on public.foreclosure_sales;
create policy "foreclosure_sales_read_all" on public.foreclosure_sales for select using (true);
drop policy if exists "foreclosure_sales_admin_write" on public.foreclosure_sales;
create policy "foreclosure_sales_admin_write" on public.foreclosure_sales for all using (public.is_admin());

drop policy if exists "loans_read_all" on public.loans;
create policy "loans_read_all" on public.loans for select using (true);
drop policy if exists "loans_admin_write" on public.loans;
create policy "loans_admin_write" on public.loans for all using (public.is_admin());

drop policy if exists "source_documents_read_all" on public.source_documents;
create policy "source_documents_read_all" on public.source_documents for select using (true);
drop policy if exists "source_documents_admin_write" on public.source_documents;
create policy "source_documents_admin_write" on public.source_documents for all using (public.is_admin());

-- Note: the app's own Postgres connection (Prisma, via DATABASE_URL) uses
-- the Supabase service role, which bypasses RLS by design — these policies
-- protect the anon/authenticated Supabase client paths (e.g. a future
-- direct-from-mobile read of a public table) and the Supabase SQL editor.
