# ReturnLoop Supabase setup

The existing Supabase project already has the initial ReturnLoop schema, policies, functions, and triggers. Its current SQL is the source of truth for table creation, profile creation, QR generation, found reports, and notifications. Do not run a second initial-schema script and do not create a replacement project.

## Follow-up migration

The only follow-up SQL in this repository is `migrations/20261019000001_realtime_and_status_security.sql`. It assumes the existing setup has created `public.items`, `public.profiles`, `public.found_reports`, `public.notifications`, and `public.is_teacher()`.

It replaces only the existing `items_update` policy so a student cannot mark their item returned, and adds the existing app tables to `supabase_realtime`. It does not recreate tables, functions, or triggers. The current `on_item_status_change` trigger remains responsible for closing reports and notifying the owner when a teacher marks an item returned.

Before applying the follow-up SQL, make a database backup and confirm the existing policy is named `items_update` and the teacher helper is `public.is_teacher()`. If either name differs, adapt the follow-up first. In Supabase, use **SQL Editor** to review and run the follow-up migration once.

## Vercel configuration

Set the Vercel **Root Directory** to `artifacts/returnloop`, and keep files outside the root included. Vercel deploys Git commits, not uncommitted workspace edits: merge the `supabase-integration` branch to `main` after preview testing, or configure the Production branch to that branch.

Add these environment variables for both Preview and Production, with values from the existing Supabase project's API settings:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Save and redeploy after changing variables. Vite embeds these public values in the client bundle; use only the publishable/anon key. Never put a database password or service-role key in Vercel or browser code.

In Supabase Auth settings, set the site URL to the production Vercel URL and add it to the allowed redirect URLs. Keep email confirmation settings consistent with the desired signup behavior.

New accounts are students. To make a teacher, let them register and then, as a trusted database administrator, promote only that profile after verifying the account UUID. Never expose role editing to public signup.

## Verify

1. Open `/` and `/auth` in a private browser window. Both should load the app, not Vercel's login or a 404.
2. Create a student account and sign in. Confirm the profile is created and the dashboard loads.
3. Register an item and confirm it persists after refresh.
4. Open its QR link while signed out, submit a found report, and confirm the owner receives a notification without refreshing.
5. Test with a teacher account that returning an item closes open reports and sends the configured notification.

The follow-up migration enables Realtime for profiles, items, found reports, and notifications. RLS still controls what each user can receive.