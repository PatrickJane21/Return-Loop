-- Apply only after the duplicate preflight in supabase/README.md returns no rows.
-- This prevents future duplicate IDs without changing existing profile data.

begin;

create unique index if not exists profiles_student_id_normalized_key
  on public.profiles (lower(btrim(student_id)))
  where student_id is not null and btrim(student_id) <> '';

commit;
