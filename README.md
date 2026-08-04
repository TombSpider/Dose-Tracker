# Dose & Test Log — setup guide

This app is a static site (HTML/CSS/JS) backed by Supabase for storage. You need to do the account/hosting steps yourself — I can't create accounts or click through dashboards on your behalf. Everything below is what to do with the files in this folder.

## 1. Create the Supabase project

1. Go to supabase.com, sign up, create a new project. Set a strong database password and save it somewhere safe (a password manager). Pick a region close to you.
2. Once it's provisioned, go to the **SQL Editor**, paste the entire contents of `schema.sql`, and run it. This creates all the tables and locks them down with Row Level Security so only your logged-in account can read or write your data.
3. Go to **Project Settings → API**. Copy the **Project URL** and the **anon/public key**.
4. Open `config.js` in this folder and paste those two values in, replacing the placeholders.

## 2. Push to GitHub

1. Create a free GitHub account if you don't have one.
2. Create a new **public** repository (public is fine — no secrets live in this code; the anon key is designed to be exposed client-side, and RLS is what actually protects your data).
3. Upload all the files in this folder (including the hidden `.github` folder) to the repo — either via the web UI's drag-and-drop upload, or with git if you're comfortable with it.
4. In the repo, go to **Settings → Pages**. Under "Source," choose "Deploy from a branch," select `main` and the root folder, save.
5. After a minute or two, your app will be live at `https://yourusername.github.io/your-repo-name/`.

## 3. Create your account in the app

1. Open the live URL. You'll see a sign-in/create-account screen.
2. Click "Create account," enter an email and password.
3. **Check your Supabase project's Authentication settings** — if "Confirm email" is turned on, you'll need to click a confirmation link sent to that email before you can sign in. For a single-user personal app, you can turn this off in Supabase (Authentication → Providers → Email → toggle off "Confirm email") to skip that step entirely.
4. Sign in. You're in — this account is now the only one that can ever see your data, enforced at the database level.

## 4. Set up the keep-alive Action

1. In the GitHub repo, go to **Settings → Secrets and variables → Actions**.
2. Add two repository secrets: `SUPABASE_URL` and `SUPABASE_ANON_KEY`, using the same values you put in `config.js`.
3. That's it — the workflow in `.github/workflows/keep-alive.yml` will now ping your Supabase project automatically every 3 days, keeping the free-tier database from pausing after 7 days of inactivity. You can also trigger it manually from the repo's **Actions** tab any time.

## Ongoing notes

- **Backups:** the free Supabase tier doesn't include automated backups. Periodically export your data — I can add an export button if you want one built in, since the current version doesn't have it (the old localStorage-based backup logic doesn't apply anymore now that data lives in Supabase).
- **Free tier limits:** 500 MB database, project pauses (not deletes) after 7 days idle without the keep-alive ping. If you ever exceed 500 MB — very unlikely for text-based logs like this — you'd need to upgrade to Supabase's paid tier.
- **PDF import parsing:** the Quest lab report parser is best-effort pattern matching, not a robust document parser. Always check the review screen before confirming an import — reference ranges and units are formatted inconsistently even within a single report, and some rows may need manual correction.
- **This hasn't been tested against a live Supabase project yet** — since I can't create one myself, there's a real chance of small bugs surfacing once real credentials are in place (a typo in a field name, an edge case in a query). Once you've got it deployed, let me know what breaks and I'll fix it.
