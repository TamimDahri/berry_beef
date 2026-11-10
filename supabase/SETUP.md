# Setting up logins (Supabase)

1. In Supabase, open your project (region: Singapore) → **SQL Editor** → **New query**.
   Paste everything from `supabase/schema.sql` and click **Run**.
2. **Authentication → Sign In / Providers → Email**: turn off **Confirm email**.
   (Supabase's built-in email only sends 2 emails an hour. Turn it back on once a custom
   email sender such as Resend is connected.)
3. **Authentication → URL Configuration**: Site URL `https://cameronstrawberry.com`,
   and add `https://cameronstrawberry.com/**` under Redirect URLs.
4. **Project Settings → API**: copy the **Project URL** and the **anon / publishable key**
   into `js/config.js`. Both are safe to publish; the database rules protect the data.
5. Create your own account at cameronstrawberry.com/login.html, then run in the SQL Editor:
   `update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'YOUR EMAIL');`
6. Riders create their own accounts; make them riders in **Admin → Team**.

## Farm prices (added later)

7. Run `supabase/002_farm.sql` in the SQL Editor the same way.
8. In **Admin → Farm & packing**, add the farm and tap **Send her link on WhatsApp**.
