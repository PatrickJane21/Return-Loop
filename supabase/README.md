# ReturnLoop Supabase setup

This project uses Supabase Auth, Postgres, Row Level Security, RPC functions, and Realtime. The frontend reads only the public project URL and publishable key. Never put a `service_role` key in Vercel or browser code.

## Before changing the existing project

The migration in `migrations/20261019000000_returnloop.sql` creates the tables and functions expected by the app. It uses `create table if not exists`, backfills missing profiles without overwriting existing profile rows, and does not delete application data. It also replaces policies with its own named policies and installs/replaces triggers and functions.

Before running it against an existing Supabase project, make a database backup and compare the existing `profiles`, `items`, `found_reports`, and `notifications` definitions, policies, triggers, and functions with the migration. Do not run it blindly if any of those objects already exist with a different schema or behavior. This repository does not contain the prior project's schema, so that compatibility cannot be confirmed here. Do not create a replacement Supabase project.

If the existing project has no conflicting objects, open the existing project's SQL Editor, review the migration, then run it there. If objects differ, adapt the migration to that schema first. Applying SQL in the dashboard does not add it to Supabase's migration history; keep a record of what was applied.

## App configuration

In Vercel, open the ReturnLoop project and set **Root Directory** to `artifacts/returnloop`. Keep files outside the root included. Vercel deploys Git commits, not uncommitted workspace edits: commit and push this branch, then merge it to `main` or configure the Production branch to the pushed branch containing these changes.

Add these Production environment variables in Vercel using values from the existing Supabase project's API settings:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Save and redeploy after changing variables. Vite embeds these public values in the client bundle; use only the publishable/anon key. Never use the database password or service-role key.

In Supabase Auth settings, set the site URL to the production Vercel URL and add it to the allowed redirect URLs. Keep email confirmation settings consistent with how you want signup to work.

The app grants new signups the `student` role. To provision a teacher, first let the teacher create and confirm their account. As a trusted project administrator, find that account's UUID and promote only that profile in the Supabase SQL Editor:

```sql
select id, email from auth.users where email = 'teacher@example.edu';
update public.profiles set role = 'teacher' where id = 'PASTE-THAT-USER-UUID';
```

Never expose role editing to public signup.

## Verify

1. Open `/` and `/auth` in a private browser window. Both should load the app, not Vercel's login or a 404.
2. Create a student account and sign in. Confirm a profile is created and the dashboard loads.
3. Register an item and confirm it appears after refreshing or signing in from another browser.
4. Open the item's QR link in a signed-out browser, submit a found report, and confirm the owner sees a notification without refreshing.
5. Promote a test account to teacher, sign in as that teacher, and test marking the item returned.

The SQL migration enables Realtime for the app tables when the `supabase_realtime` publication is present. If it is configured differently in the existing project, verify the tables in Supabase's Realtime settings before testing live updates.