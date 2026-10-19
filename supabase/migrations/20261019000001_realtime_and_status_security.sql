-- Apply after the existing ReturnLoop initial setup SQL.
-- This migration does not recreate tables or triggers.

begin;

drop policy if exists "items_update" on public.items;
create policy "items_update" on public.items
  for update to authenticated
  using (owner_id = (select auth.uid()) or public.is_teacher())
  with check (
    public.is_teacher()
    or (owner_id = (select auth.uid()) and status <> 'returned')
  );

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime'
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

commit;