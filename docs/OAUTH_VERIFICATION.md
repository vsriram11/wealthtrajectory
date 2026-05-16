# OAuth Verification + the 100-User Cap

> **Quick context:** this project uses Google Sign-In + Google Drive
> (the `drive.appdata` scope) to optionally sync a user's plan
> across devices. To Google, that's a SENSITIVE scope. Without
> going through Google's OAuth verification process, the app is
> capped at 100 unique users. The decision documented here is:
> **we accept that cap and don't pursue verification** — and the
> reason is that this is an open-source side project that should
> not require paid infrastructure to run.

## What the cap actually means

Google's OAuth consent screen has three states. Today this app is
in the second:

| State | Who can sign in | UX |
|---|---|---|
| **Testing** | Only emails added to the test-user allowlist (max 100) | More cautious consent screen + refresh tokens expire in 7 days |
| **Published, Unverified** | Any Google user, up to **100 unique users total** for SENSITIVE scopes | One-time "unverified app" warning screen; "Advanced → Continue (unsafe)" link |
| **Published, Verified** | Any Google user, no cap | Clean consent screen, no warning |

Past 100 unique users in the Unverified state, sign-ins start
failing with `access_denied`. The cap is enforced by Google, not
by anything in this codebase.

## Why we don't pursue verification

OAuth verification is technically free, but it requires:

1. A **privacy policy** + **terms of service** hosted on a domain
   you own (i.e. registered to you, controllable via DNS — not a
   `*.vercel.app` or `*.netlify.app` subdomain).
2. **Domain ownership verification** in Google Search Console
   (DNS TXT record or HTML file upload).
3. An app **homepage** on the same owned domain.
4. **App icon** (120×120 PNG, no transparency).
5. A **demo video** (3-5 minutes) showing the sign-in flow + how
   each scope is used.
6. **Justification questionnaire** for every sensitive scope:
   what data is accessed, why, whether it ever leaves the user's
   Google account.
7. **Review back-and-forth** with Google's OAuth team — first
   response in days, full process in 2-6 weeks (anecdotally).

The blocking step is **(1) + (2) + (3)**: every cheap path costs
something.

- `github.io` subdomains are on Google's [Public Suffix
  List](https://publicsuffix.org), so they're verifiable in Search
  Console via HTML-file upload. But Google's OAuth review team
  has historically been inconsistent about accepting subdomain
  privacy-policy URLs for SENSITIVE scopes — submissions get
  bounced with "we need a domain you own" feedback.
- `vercel.app` / `netlify.app` subdomains are NOT verifiable
  because the developer doesn't control DNS for the parent.
- A custom domain costs **~$8-$15/year** at the cheapest
  registrars (Namecheap, Porkbun). Hosting itself stays free
  (Vercel + GitHub Pages absorb that).

The project's design principle is **zero recurring cost**.
$8/year is small in absolute terms, but it's a recurring
financial commitment tied to the project's lifetime, and that's
exactly what we don't want.

## What the cap doesn't mean

**This isn't a 100-user-total cap on the app.** It's specifically
a cap on users who sign in for Drive sync. The app:

- Works fully offline-first via IndexedDB.
- Persists demo data + real-mode data without any sign-in.
- Lets any user export their plan as JSON (encrypted with their
  own passphrase if they choose) and re-import on another device.
  Cross-device "manual sync" via that export remains free + works
  forever.

So:
- Users 1-100 who want auto-sync via Drive can sign in.
- User 101+ who hits the cap sees `access_denied` and falls back
  to manual export/import.
- All 1000+ users (whatever scale we reach) can use the rest of
  the app indefinitely.

The cap is real, but the failure mode is graceful.

## How the cap is communicated in-app

`app/_components/data/GoogleSyncCard.tsx` translates the
`access_denied` response into user-facing copy that explains the
fallback. The sign-in button has a sub-caption that mentions the
manual export/import path. The Data page surfaces export/import
above the Drive sync card so the free path is the discoverable
default.

## If we ever change our mind

The lowest-friction path to verification is:

1. Buy a `.com` for the project. The cheapest reputable
   registrar is Porkbun (~$10/year for the first year, $11
   renewal). Namecheap, Cloudflare Registrar, and Gandi are
   comparable.
2. Point its DNS at the Vercel deployment (`wealthtrajectory.com`
   → A record to Vercel's edge). Vercel deployments accept custom
   domains on the free tier.
3. Host `/privacy` + `/terms` as Next.js routes on the same
   domain — no separate static site needed; just two new
   `app/privacy/page.tsx` + `app/terms/page.tsx` files.
4. Verify ownership in Google Search Console via DNS TXT
   (Cloudflare DNS makes this a 5-minute task).
5. Fill out the OAuth verification form. Cite `drive.appdata`
   as the only sensitive scope. Justification: "users opt in to
   back up their personal-finance plan to their own Drive's
   app-private folder; no other Drive access; data never leaves
   their Google account; the app reads/writes ONLY files it
   created."
6. Record the demo video.
7. Submit. Wait. Respond to reviewer questions.

Total cost: $10-$15/year + a few hours of paperwork. Total
calendar time: 2-6 weeks from form submission to verification.

If the project ever crosses 100 users AND we want to keep the
sign-in path open, this is the playbook. Until then, the
sign-in-free path covers everyone.

## Local-only crypto: what's intact without sign-in

This is the design that makes the 100-cap acceptable:

- **Export to JSON**: works for any user, no sign-in. Triggered
  from Data → "Export."
- **Import from JSON**: same. Triggered from Data → "Import."
- **Encryption (AES-256-GCM)**: the same crypto module that
  encrypts Drive backups also encrypts local exports when the
  user sets a passphrase. The envelope format
  (`schema: "fp-enc-v1"`) is identical — a file you exported
  locally and a file Google Drive would have stored are byte-for-
  byte equivalent if both are sealed with the same passphrase.
- **Cross-device transfer**: AirDrop / iCloud Drive / Dropbox /
  attached to an email — anything that moves a JSON file. The
  file is encrypted at rest in whatever transport the user
  picks.

The Pro tier (currently ungated, marker preserved in code) is
**Drive sync's convenience**: auto-push on every change, never
think about it, multi-device cross-sync. That's the value to
monetize if we ever want to, not the data freedom itself.

## Related code

- `lib/sync/googleAuth.ts` — defines the OAuth scope (`drive.appdata`).
- `lib/sync/cloudSync.ts` — pull/push logic.
- `lib/sync/crypto.ts` — `encryptString` / `decryptString` /
  `unwrapBackup`. Used by both Drive sync AND local export.
- `app/_components/data/EncryptionCard.tsx` — passphrase setup UI.
- `app/_components/data/DataIO.tsx` — local export/import.
- `app/_components/data/GoogleSyncCard.tsx` — Drive sync UI.
- `app/_components/ui/ProGate.tsx` — Pro-tier marker (pass-through
  today; ready for future monetization).
