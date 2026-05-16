# wealthtrajectory — PRIVACY & SECURITY MODEL

This document describes the threat model, the data-flow boundaries, and the
encryption design for wealthtrajectory. It is the source of truth when product
or engineering decisions involve user data: when in doubt, this document wins.

The headline property: **the user's financial data never leaves their device
in plaintext, and never reaches our servers at all.**

---

## 1. THREAT MODEL

### 1.1 In scope
We design against the following adversaries:

- **A casual snooper** who picks up the user's unlocked device and opens the
  browser. They can already see most things, but should not be able to read
  any encrypted Drive backup.
- **A Google insider** with read access to Drive bytes. They should not be
  able to read the user's financial data even though it is stored in the
  user's Drive `appDataFolder`.
- **A network attacker** (rogue Wi-Fi, MITM) intercepting traffic between
  the user and our infrastructure. They should learn no financial content.
- **A malicious browser extension** the user has installed. We cannot fully
  defend against this — an extension with full page access can read the DOM
  — but our architecture should not make the attack easier (no in-memory
  credentials beyond the working session, no plaintext storage in
  localStorage).
- **A cross-device account-takeover attempt** using the user's Google
  identity but without their passphrase. They should not be able to decrypt
  the Drive backup.

### 1.2 Out of scope
We do not defend against:

- **Compromise of the user's device itself** (OS-level malware, evil-maid
  attacks, etc.).
- **Coerced disclosure** of the user's passphrase.
- **Forensic recovery** of in-browser memory after a session.
- **The user choosing not to use encryption.** End-to-end encryption is
  opt-in (PRD §7.10). When off, the Drive backup is plaintext JSON inside
  the user's own `appDataFolder`.

### 1.3 What an attacker who steals the Drive backup learns
- **With encryption on**: a ciphertext blob, an init vector, and a salt.
  No structural information about account count, holding count, or balance
  magnitude. They cannot mount an offline brute-force without (a) the
  passphrase, or (b) defeating 250,000-round PBKDF2 + a randomly generated
  per-user salt.
- **With encryption off**: the full plaintext JSON of the user's household.
  This is documented in-app and the user opts in by skipping the encryption
  setup.

---

## 2. DATA-FLOW BOUNDARIES

```
┌────────────────────────────────────────────────────────────────┐
│  USER'S DEVICE                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ Browser tab                                            │    │
│  │ ─ Zustand store (in-memory)        ← session passphrase│    │
│  │ ─ IndexedDB (plaintext)            ← user's household  │    │
│  │ ─ Web Crypto subtle API            ← encrypt / decrypt │    │
│  └─────────────────────┬──────────────────────────────────┘    │
│                        │ ciphertext over HTTPS                  │
└────────────────────────┼──────────────────────────────────────┘
                         ▼
┌────────────────────────────────────────────────────────────────┐
│  GOOGLE DRIVE (user's appDataFolder, scoped to this app)        │
│  ─ Ciphertext blob                                              │
│  ─ IV (per write)                                               │
│  ─ Salt (stable per user)                                       │
│  ─ Encryption marker file (signals "this user uses encryption") │
└────────────────────────────────────────────────────────────────┘
```

**Our servers never see user financial data.** The only server-side
components are:
1. Google OAuth (for sign-in only; we use Google's tokens).
2. Optional price-quote proxy (sends only ticker symbols, no balances).

Both are intentionally minimal so the privacy story is auditable.

---

## 3. STORAGE TIERS

### 3.1 IndexedDB (primary local store)
Plaintext on the user's device. This is the source of truth. Wiping the
browser's storage permission for this site wipes the data.

### 3.2 Drive `appDataFolder` (optional backup)
Per-app private sandbox in the user's Drive. Each Drive-using app sees only
its own files; the user can revoke access to wipe ours. We write either:
- Ciphertext (when encryption is on), or
- Plaintext JSON (when off).

### 3.3 Browser session memory (Zustand)
The working copy of the household lives in memory. The passphrase, when in
use, lives here too — **and only here**. We never write the passphrase to
IndexedDB, never to Drive, never to a cookie, never to a log.

### 3.4 Local export files (Drive-free, sign-in-free)
Triggered by the user on the Data page. Produces a JSON file the user
downloads to their own filesystem (or cloud-storage provider — AirDrop,
iCloud Drive, Dropbox, attached to an email). Two flavors:

- **Ciphertext** (when a passphrase is loaded): same `fp-enc-v1` envelope
  used for Drive backups (§4). A file exported locally and a Drive-stored
  ciphertext are byte-for-byte equivalent if both were sealed with the same
  passphrase — the user can move between the two paths freely.
- **Plaintext JSON** (no passphrase loaded): identical schema to Drive's
  plaintext fallback. The user opts in to plaintext the same way they opt
  in for Drive — by not setting up a passphrase.

Why this matters for the threat model: the local export path is the only
data-portability surface that works for users without a Google account
(or for users past the 100-user Drive sync cap — see
[OAUTH_VERIFICATION.md](./OAUTH_VERIFICATION.md)). Without it, those users
would have no encrypted offsite-backup option. With it, encryption coverage
is universal across every surface where data leaves the tab.

### 3.5 What we never store
- The user's plaintext passphrase (anywhere persistent).
- Server-side copies of any financial data.
- Server-side copies of any authentication secret beyond what Google
  OAuth itself manages.

---

## 4. END-TO-END ENCRYPTION DESIGN

### 4.1 Primitives
- **Symmetric cipher**: AES-256-GCM via the browser's Web Crypto subtle API.
- **Key derivation**: PBKDF2 with SHA-256, **250,000 iterations**, 32-byte
  output, random 16-byte per-user salt stored alongside the ciphertext.
- **IV**: 12 bytes, generated fresh per write via `crypto.getRandomValues`.

### 4.2 Per-write flow
1. Serialize the household to JSON.
2. Derive the data key from `(passphrase, salt)` via PBKDF2.
3. Generate a fresh 12-byte IV.
4. Encrypt with AES-256-GCM. GCM provides both confidentiality and integrity
   — a tampered ciphertext fails to decrypt rather than producing garbage.
5. Upload `{salt, iv, ciphertext}` to the user's `appDataFolder`.

### 4.3 Per-read flow
1. Download `{salt, iv, ciphertext}` from `appDataFolder`.
2. Prompt the user for the passphrase if it isn't already in memory.
3. Derive the data key from `(passphrase, salt)`.
4. Decrypt with the IV. A wrong passphrase fails authentication; we surface
   "incorrect passphrase" without leaking which step failed.

### 4.4 Encryption marker
A small unencrypted marker file in `appDataFolder` records "this user has
opted into encryption." It carries no secret material; its purpose is to
tell the app on a fresh device to *prompt for passphrase before downloading
the ciphertext*, so we never accidentally treat ciphertext as plaintext
JSON.

### 4.5 Passphrase rotation
Decrypt with the old passphrase, re-encrypt with the new passphrase (new
salt, new IV), upload. There is intentionally no recovery path: a forgotten
passphrase means the Drive backup is unrecoverable. The app tells the user
this explicitly before they set a passphrase.

### 4.6 What is NOT encrypted at the application level
- The local IndexedDB store. Browsers do not currently offer first-class
  per-database encryption that survives a stolen, unlocked device, and
  adding our own would be security theater (the key would have to live in
  browser memory anyway).
- Quote-proxy traffic content — only ticker symbols transit, not balances.

---

## 5. SYNC SAFETY

Encryption protects content. The **shrinkage guard** protects against a
different failure mode: silent data loss when sync replaces a complete
record set with a shorter one.

### 5.1 The risk
A sync round trip could legitimately produce a shorter list (the user
deleted a scenario) or illegitimately produce a shorter list (a stale
client overwrites the freshest copy after a partial load). The latter is
catastrophic; the former is normal.

### 5.2 The guard
For every tracked collection (accounts, snapshots, scenarios, goals,
budget items, health plans, sparse maps like health-importance weights),
before writing to Drive we check:

```
if (cloud_count_now > 0 && local_count_now < cloud_count_now &&
    user_did_not_just_delete) {
  abort_write_and_alert_user
}
```

The user is shown a banner explaining the abort and given a one-tap
"override this once" path if the shrinkage is intentional. The same guard
runs in reverse on inbound sync, refusing to clobber a fresher local set
with a shorter cloud set.

### 5.3 Fresh-price preservation
When importing a Drive payload, prices with newer `lastPricedAt` timestamps
on the local side are preserved (`mergeFresherPrices`). This prevents a
stale cloud snapshot from reverting newly-fetched live quotes.

---

## 6. AUTHENTICATION

### 6.1 Google OAuth
The only externally-authenticated path. We use Google's standard OAuth
flow with the narrowest scopes that work:
- `drive.appdata` — read/write the per-app sandbox only.
- `openid email` — to identify the user across devices.

We **never** request `drive` (the user's full Drive), `gmail`, or any
non-Drive scope.

### 6.2 Local session
A per-device session ID is generated on first run and stored in
IndexedDB. The Drive marker records the most recent session ID; on
hydration, a mismatch indicates "another device has used this account
since you last opened it" and triggers a re-sync rather than a silent
overwrite. The session ID is not a credential — it's a tie-breaker for
sync conflicts.

### 6.3 No password-based identity
We do not host a username/password system. The only login mechanism is
Google OAuth. The encryption passphrase is **not** a login credential —
it is a content key, used only to decrypt cloud-stored data after
authentication.

---

## 7. WHAT WE LOG, WHAT WE DON'T

- **Client console logs**: limited to development builds. Production
  builds suppress non-error logging.
- **Crash reporting**: if added, must strip all balances, holdings, and
  account names before transmission.
- **Server-side request logs**: the quote-proxy logs ticker symbols and
  IPs for rate-limiting only. No balances ever transit the proxy.

---

## 8. KNOWN LIMITATIONS

- **Browser extensions** with full page access can read the DOM and the
  in-memory store. We rely on the user's extension hygiene.
- **A compromised device** defeats every defense documented here. End-to-
  end encryption is not a substitute for device security.
- **Quantum risk**: AES-256-GCM remains secure against currently
  known quantum attacks (Grover halves the effective key strength to 128
  bits, still infeasible). PBKDF2-SHA256 likewise.

---

## 9. WHEN DESIGNING NEW FEATURES

The checklist for any feature that touches user data:

1. Does this feature send financial data to a server we operate? If yes,
   it is rejected unless it can be made to operate on hashes / aggregates
   / opt-in payloads only.
2. Does this feature persist the passphrase anywhere durable? If yes, it
   is rejected.
3. Does this feature add a new tracked collection? If yes, add it to the
   shrinkage guard at the same time, in the same change.
4. Does this feature introduce a real-vs-nominal boundary? If yes, the
   conversion happens at the boundary, not inside downstream code, and
   the UI labels which view is active.

---

END OF PRIVACY & SECURITY MODEL
