create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default 'Campus member',
  email text not null default '',
  role text not null default 'student' check (role in ('student', 'teacher')),
  student_id text,
  course_or_class text,
  section text,
  created_at timestamptz not null default now()
);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  item_name text not null,
  category text not null check (category in ('Tech', 'Study', 'Wearables', 'Personal', 'Other')),
  description text not null default '',
  qr_token text not null unique default upper(replace(gen_random_uuid()::text, '-', '')),
  status text not null default 'lost' check (status in ('lost', 'found', 'returned')),
  created_at timestamptz not null default now()
);

create table if not exists public.found_reports (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id) on delete cascade,
  finder_name text not null,
  finder_contact text not null,
  found_location text not null,
  found_date date not null,
  message text not null default '',
  status text not null default 'new' check (status in ('new', 'reviewed', 'returned', 'dismissed')),
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.profiles (id) on delete cascade,
  item_id uuid references public.items (id) on delete set null,
  found_report_id uuid references public.found_reports (id) on delete set null,
  title text not null,
  message text not null,
  notification_type text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists items_owner_created_idx on public.items (owner_id, created_at desc);
create index if not exists found_reports_item_created_idx on public.found_reports (item_id, created_at desc);
create index if not exists notifications_recipient_created_idx on public.notifications (recipient_user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.items enable row level security;
alter table public.found_reports enable row level security;
alter table public.notifications enable row level security;

create or replace function public.returnloop_is_teacher()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'teacher'
  );
$$;

revoke all on function public.returnloop_is_teacher() from public;
grant execute on function public.returnloop_is_teacher() to authenticated;

drop policy if exists "profiles_read_self_or_teacher" on public.profiles;
create policy "profiles_read_self_or_teacher" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.returnloop_is_teacher());

drop policy if exists "items_read_owner_or_teacher" on public.items;
create policy "items_read_owner_or_teacher" on public.items
  for select to authenticated
  using (owner_id = (select auth.uid()) or public.returnloop_is_teacher());

drop policy if exists "items_insert_owner" on public.items;
create policy "items_insert_owner" on public.items
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists "items_update_owner_or_teacher" on public.items;
create policy "items_update_owner_or_teacher" on public.items
  for update to authenticated
  using (owner_id = (select auth.uid()) or public.returnloop_is_teacher())
  with check (owner_id = (select auth.uid()) or public.returnloop_is_teacher());

drop policy if exists "found_reports_read_owner_or_teacher" on public.found_reports;
create policy "found_reports_read_owner_or_teacher" on public.found_reports
  for select to authenticated
  using (
    exists (
      select 1 from public.items i
      where i.id = item_id
        and (i.owner_id = (select auth.uid()) or public.returnloop_is_teacher())
    )
  );

drop policy if exists "found_reports_update_owner_or_teacher" on public.found_reports;
create policy "found_reports_update_owner_or_teacher" on public.found_reports
  for update to authenticated
  using (
    exists (
      select 1 from public.items i
      where i.id = item_id
        and (i.owner_id = (select auth.uid()) or public.returnloop_is_teacher())
    )
  )
  with check (public.returnloop_is_teacher() or status = 'dismissed');

drop policy if exists "notifications_read_recipient" on public.notifications;
create policy "notifications_read_recipient" on public.notifications
  for select to authenticated
  using (recipient_user_id = (select auth.uid()));

drop policy if exists "notifications_update_recipient" on public.notifications;
create policy "notifications_update_recipient" on public.notifications
  for update to authenticated
  using (recipient_user_id = (select auth.uid()))
  with check (recipient_user_id = (select auth.uid()));

revoke all on table public.profiles, public.items, public.found_reports, public.notifications from anon, authenticated;
grant select on table public.profiles, public.items, public.found_reports, public.notifications to authenticated;
grant insert on table public.items to authenticated;
grant update (status) on table public.items, public.found_reports to authenticated;
grant update (is_read) on table public.notifications to authenticated;

create or replace function public.returnloop_create_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email, student_id, course_or_class, section)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), 'Campus member'),
    coalesce(new.email, ''),
    nullif(new.raw_user_meta_data ->> 'student_id', ''),
    nullif(new.raw_user_meta_data ->> 'course_or_class', ''),
    nullif(new.raw_user_meta_data ->> 'section', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists returnloop_create_profile on auth.users;
create trigger returnloop_create_profile
  after insert on auth.users
  for each row execute function public.returnloop_create_profile();

insert into public.profiles (id, full_name, email, student_id, course_or_class, section)
select
  u.id,
  coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), 'Campus member'),
  coalesce(u.email, ''),
  nullif(u.raw_user_meta_data ->> 'student_id', ''),
  nullif(u.raw_user_meta_data ->> 'course_or_class', ''),
  nullif(u.raw_user_meta_data ->> 'section', '')
from auth.users u
on conflict (id) do nothing;

create or replace function public.public_item_by_token(t text)
returns table (item_name text, category text, description text, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.item_name, i.category, i.description, i.status
  from public.items i
  where upper(i.qr_token) = upper(trim(coalesce(t, '')))
  limit 1;
$$;

revoke all on function public.public_item_by_token(text) from public;
grant execute on function public.public_item_by_token(text) to anon, authenticated;

create or replace function public.submit_found_report(
  p_token text,
  p_finder_name text,
  p_finder_contact text,
  p_found_location text,
  p_found_date date,
  p_message text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_row public.items%rowtype;
  recent_reports integer;
  report_id uuid;
begin
  if length(trim(coalesce(p_finder_name, ''))) not between 1 and 100
    or length(trim(coalesce(p_finder_contact, ''))) not between 1 and 200
    or length(trim(coalesce(p_found_location, ''))) not between 1 and 200
    or p_found_date is null
    or length(coalesce(p_message, '')) > 1000 then
    return 'invalid';
  end if;

  select * into item_row
  from public.items i
  where upper(i.qr_token) = upper(trim(coalesce(p_token, '')))
  for update;

  if not found then return 'not_found'; end if;
  if item_row.status = 'returned' then return 'closed'; end if;
  if exists (
    select 1 from public.found_reports r
    where r.item_id = item_row.id and r.status in ('new', 'reviewed')
  ) then
    return 'already_reported';
  end if;

  select count(*) into recent_reports
  from public.found_reports r
  where r.item_id = item_row.id and r.created_at >= now() - interval '24 hours';
  if recent_reports >= 3 then return 'rate_limited'; end if;

  insert into public.found_reports (
    item_id, finder_name, finder_contact, found_location, found_date, message
  ) values (
    item_row.id, trim(p_finder_name), trim(p_finder_contact), trim(p_found_location),
    p_found_date, trim(coalesce(p_message, ''))
  ) returning id into report_id;

  update public.items set status = 'found' where id = item_row.id;

  insert into public.notifications (
    recipient_user_id, item_id, found_report_id, title, message, notification_type
  ) values (
    item_row.owner_id, item_row.id, report_id, 'Someone found your item',
    'A finder sent a note about your ' || item_row.item_name || '.', 'found_report'
  );

  return 'ok';
end;
$$;

revoke all on function public.submit_found_report(text, text, text, text, date, text) from public;
grant execute on function public.submit_found_report(text, text, text, text, date, text) to anon, authenticated;

create or replace function public.returnloop_mark_returned(p_item_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed_item_id uuid;
begin
  if not public.returnloop_is_teacher() then return false; end if;

  update public.items
  set status = 'returned'
  where id = p_item_id
  returning id into changed_item_id;

  if changed_item_id is null then return false; end if;

  update public.found_reports
  set status = 'returned'
  where item_id = changed_item_id and status in ('new', 'reviewed');

  return true;
end;
$$;

revoke all on function public.returnloop_mark_returned(uuid) from public;
grant execute on function public.returnloop_mark_returned(uuid) to authenticated;

create or replace function public.returnloop_notify_returned_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'returned'
    and old.status is distinct from new.status
    and (select auth.uid()) is distinct from new.owner_id then
    insert into public.notifications (recipient_user_id, item_id, title, message, notification_type)
    values (
      new.owner_id, new.id, 'Your item was returned',
      'A teacher marked your ' || new.item_name || ' as returned.', 'item_returned'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists returnloop_notify_returned_item on public.items;
create trigger returnloop_notify_returned_item
  after update of status on public.items
  for each row execute function public.returnloop_notify_returned_item();

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_publication
    where pubname = 'supabase_realtime' and not puballtables
  ) then
    begin
      alter publication supabase_realtime add table public.profiles;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.items;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.found_reports;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.notifications;
    exception when duplicate_object then null;
    end;
  end if;
end;
$$;