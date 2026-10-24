-- Additive ReturnLoop extension tables.
-- This does not recreate or modify the existing profiles/items/report tables.
-- Run after reviewing the existing project's RLS conventions.

begin;

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('teacher', 'admin')),
  approved_at timestamptz not null default now(),
  approved_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique,
  building text not null,
  name text not null,
  department_id uuid references public.departments (id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.complaints (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations (id) on delete restrict,
  submitted_by uuid not null references public.profiles (id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text not null check (char_length(btrim(description)) between 1 and 2000),
  status text not null default 'submitted' check (status in ('submitted', 'under_review', 'assigned', 'in_progress', 'resolved')),
  assigned_department_id uuid references public.departments (id) on delete set null,
  assigned_to uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  assigned_at timestamptz,
  started_at timestamptz,
  resolved_at timestamptz,
  resolution_notes text check (resolution_notes is null or char_length(resolution_notes) <= 2000)
);

create table if not exists public.complaint_status_history (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references public.complaints (id) on delete cascade,
  old_status text,
  new_status text not null check (new_status in ('submitted', 'under_review', 'assigned', 'in_progress', 'resolved')),
  changed_by uuid references public.profiles (id) on delete set null,
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now()
);

create table if not exists public.email_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid references public.profiles (id) on delete set null,
  notification_id uuid references public.notifications (id) on delete set null,
  email_type text not null,
  provider_message_id text,
  status text not null check (status in ('queued', 'sent', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists complaints_status_created_idx on public.complaints (status, created_at desc);
create index if not exists complaints_location_idx on public.complaints (location_id);
create index if not exists complaints_assigned_department_idx on public.complaints (assigned_department_id);
create index if not exists complaint_history_complaint_created_idx on public.complaint_status_history (complaint_id, created_at desc);
create index if not exists email_delivery_logs_status_created_idx on public.email_delivery_logs (status, created_at desc);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles r
    where r.user_id = (select auth.uid()) and r.role = 'admin'
  );
$$;

create or replace function public.is_approved_teacher()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles r
    where r.user_id = (select auth.uid()) and r.role in ('teacher', 'admin')
  );
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.is_approved_teacher() from public;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_approved_teacher() to authenticated;

create or replace function public.record_complaint_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.complaint_status_history (complaint_id, new_status, changed_by)
    values (new.id, new.status, coalesce((select auth.uid()), new.submitted_by));
  elsif new.status is distinct from old.status then
    insert into public.complaint_status_history (complaint_id, old_status, new_status, changed_by)
    values (new.id, old.status, new.status, (select auth.uid()));
  end if;
  return new;
end;
$$;

drop trigger if exists complaints_record_status_change on public.complaints;
create trigger complaints_record_status_change
  after insert or update of status on public.complaints
  for each row execute function public.record_complaint_status_change();

alter table public.user_roles enable row level security;
alter table public.departments enable row level security;
alter table public.locations enable row level security;
alter table public.complaints enable row level security;
alter table public.complaint_status_history enable row level security;
alter table public.email_delivery_logs enable row level security;

create policy "user_roles_read_self_or_admin" on public.user_roles
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

create policy "departments_read_authenticated" on public.departments
  for select to authenticated
  using (active or public.is_admin());

create policy "departments_manage_admin" on public.departments
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "locations_read_authenticated" on public.locations
  for select to authenticated
  using (active or public.is_admin());

create policy "locations_manage_admin" on public.locations
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "complaints_read_submitter_or_staff" on public.complaints
  for select to authenticated
  using (submitted_by = (select auth.uid()) or public.is_approved_teacher());

create policy "complaints_insert_self" on public.complaints
  for insert to authenticated
  with check (submitted_by = (select auth.uid()));

create policy "complaints_update_staff" on public.complaints
  for update to authenticated
  using (public.is_approved_teacher())
  with check (public.is_approved_teacher());

create policy "complaint_history_read_submitter_or_staff" on public.complaint_status_history
  for select to authenticated
  using (
    public.is_approved_teacher()
    or exists (
      select 1 from public.complaints c
      where c.id = complaint_id and c.submitted_by = (select auth.uid())
    )
  );

create policy "email_logs_read_admin" on public.email_delivery_logs
  for select to authenticated
  using (public.is_admin());

revoke all on table public.user_roles, public.departments, public.locations,
  public.complaints, public.complaint_status_history, public.email_delivery_logs
  from anon, authenticated;

grant select on public.user_roles to authenticated;
grant select on public.departments, public.locations to authenticated;
grant select, insert on public.complaints to authenticated;
grant select on public.complaint_status_history to authenticated;
grant select on public.email_delivery_logs to authenticated;
grant insert, update, delete on public.departments, public.locations to authenticated;
grant update on public.complaints to authenticated;

do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.complaints;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.complaint_status_history;
    exception when duplicate_object then null;
    end;
  end if;
end;
$$;

commit;