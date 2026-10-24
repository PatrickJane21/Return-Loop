# ReturnLoop Supabase setup

The existing Supabase project already has the initial ReturnLoop schema, policies, functions, and triggers. Its current SQL is the source of truth for table creation, profile creation, QR generation, found reports, and notifications. Do not run a second initial-schema script and do not create a replacement project.

## Follow-up migration

The only follow-up SQL in this repository is `migrations/20261019000001_realtime_and_status_security.sql`. It assumes the existing setup has created `public.items`, `public.profiles`, `public.found_reports`, `public.notifications`, and `public.is_teacher()`.

It replaces only the existing `items_update` policy so a student cannot mark their item returned, and adds the existing app tables to `supabase_realtime`. It does not recreate tables, functions, or triggers. The current `on_item_status_change` trigger remains responsible for closing reports and notifying the owner when a teacher marks an item returned.

Before applying the follow-up SQL, make a database backup and confirm the existing policy is named `items_update` and the teacher helper is `public.is_teacher()`. If either name differs, adapt the follow-up first. In Supabase, use **SQL Editor** to review and run the follow-up migration once.

## Vercel configuration

Set the Vercel **Root Directory** to `artifacts/returnloop`, and keep files outside the root included. Vercel deploys Git commits, not uncommitted workspace edits: merge the reviewed feature pull request into `main` after Preview testing.

Add these environment variables for both Preview and Production, with values from the existing Supabase project's API settings:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Save and redeploy after changing variables. Vite embeds these public values in the client bundle; use only the publishable/anon key. Never put a database password or service-role key in Vercel or browser code.

In Supabase Auth settings, set the site URL to the production Vercel URL and add it to the allowed redirect URLs. Keep email confirmation settings consistent with the desired signup behavior.

Signup and password-reset requests use the same-origin `/auth/callback` route. Add the exact production and Preview origins plus `/auth/callback` to Supabase **Authentication → URL Configuration → Redirect URLs**. Keep Supabase's confirmation template using its supported confirmation URL placeholder (normally `{{ .ConfirmationURL }}`). The app exchanges PKCE codes, supports token-hash and implicit-token callbacks, establishes the session, routes confirmed students/teachers to their existing pages, and routes recovery links to `/auth/reset`. Dashboard Site URL, allowed URLs, and email template are private project settings and must be verified in the Supabase dashboard.

New accounts are students. To make a teacher, let them register and then, as a trusted database administrator, promote only that profile after verifying the account UUID. Never expose role editing to public signup.

Signup program, specialization, and section examples are in `artifacts/returnloop/src/lib/signup-options.ts`. They are illustrative, not verified campus data. The current schema stores program and specialization together in the existing `course_or_class` field (maximum 100 characters); the UI checks that limit. It does not invent an official student-ID format. The existing schema has no unique student-ID constraint, and the current production data cannot be inspected from this repository. Run this read-only duplicate check before applying `migrations/20261020000001_unique_student_ids.sql`:

```sql
select lower(btrim(student_id)) as normalized_id, count(*)
from public.profiles
where student_id is not null and btrim(student_id) <> ''
group by lower(btrim(student_id))
having count(*) > 1;
```

Only apply the unique-index migration if the query returns no rows. If it returns duplicates, have an authorized administrator resolve them using institutional records before applying the migration. Do not delete or merge profiles automatically.

## Email notifications

Found reports currently create in-app notifications through the existing database function/trigger. No transactional email provider or delivery function is configured in this repository. Actual email delivery is therefore not implemented or verified. To add it, choose a provider (for example Resend), configure its API key as a server-side Supabase Edge Function secret, and send to the owner email resolved from the trusted item/profile relationship. Do not put provider keys in Vercel `VITE_` variables or accept the recipient address from the finder. Keep the in-app notification independent so it still works if email delivery fails.

## Verify

1. Open `/` and `/auth` in a private browser window. Both should load the app, not Vercel's login or a 404.
2. Create a student account and sign in. Confirm the profile is created and the dashboard loads.
3. Register an item and confirm it persists after refresh.
4. Open its QR link while signed out, submit a found report, and confirm the owner receives a notification without refreshing.
5. Test with a teacher account that returning an item closes open reports and sends the configured notification.

The follow-up migration enables Realtime for profiles, items, found reports, and notifications. RLS still controls what each user can receive.

## Optional classroom and admin tables

The migration `migrations/20261024000001_roles_complaints_and_email_logs.sql` adds these new tables without recreating the existing ones:

- `user_roles`: approved `teacher` and `admin` roles.
- `departments`: administrator-managed department names.
- `locations`: classroom/lab QR locations.
- `complaints`: classroom/lab issues and assignments.
- `complaint_status_history`: immutable status-change records.
- `email_delivery_logs`: server-side email attempt records.

The complaint status flow is `submitted`, `under_review`, `assigned`, `in_progress`, and `resolved`. A location QR code identifies a room; it does not grant teacher or admin access.

To apply it, first open Supabase **SQL Editor**, review the migration, and run it once. It is additive, but it is not used by the current UI until complaint/admin screens are implemented. Do not run it repeatedly.

To provision the first administrator after a user has registered and confirmed their email, use a trusted Supabase SQL Editor session. Replace the email with the approved administrator's email:

```sql
insert into public.user_roles (user_id, role, approved_by)
select id, 'admin', id
from auth.users
where lower(email) = lower('admin@example.com')
on conflict (user_id) do update
set role = 'admin', approved_at = now(), approved_by = excluded.approved_by;
```

This does not create a password or bypass Supabase Auth. The person must still sign in using their normal Supabase account. Never put a service-role key in the browser or signup form.

Outbound email is still not active. `email_delivery_logs` only records attempts; a Supabase Edge Function and a provider such as Resend must be configured separately with server-side secrets before any email is sent.