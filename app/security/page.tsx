import Link from "next/link";

/**
 * /security — the privacy & cryptography story.
 *
 * Why this page exists: the app's most defensible property
 * is "your data never reaches any backend." There is no
 * server-side database, no analytics, no telemetry — every
 * projection runs in your tab, and the only optional
 * persistence layer is end-to-end-encrypted Google Drive.
 * That's worth a page that says exactly what happens, in
 * plain English, with links to the actual source code so
 * it's verifiable.
 *
 * Not legal advice. Not an audit. Just an honest
 * description of the architecture, written so a technical
 * user can read the code and confirm it matches.
 */
export const metadata = {
  title: "Security & Privacy — wealthtrajectory",
};

export default function SecurityPage() {
  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-5 py-10 text-text">
      <Link
        href="/"
        className="text-[12px] text-text-muted hover:text-text"
      >
        ← Back
      </Link>

      <h1 className="mt-3 text-2xl font-semibold">Security & Privacy</h1>
      <p className="mt-2 text-sm text-text-dim">
        We built this app for ourselves first — meaning we wanted
        retirement projections without handing our finances to
        another SaaS. The architecture reflects that. Here&apos;s
        exactly what happens to your data.
      </p>

      <Section title="Where your data lives">
        <Bullet bold="In your browser.">
          All projections, scoring, budget math, Monte Carlo
          simulations, and chart rendering run client-side
          in your tab. The math engine never makes a
          network request.
        </Bullet>
        <Bullet bold="In your Google Drive.">
          Cloud sync uses Google&apos;s{" "}
          <Code>appDataFolder</Code> — a hidden, app-specific
          folder in YOUR Drive that only this app can read or
          write. It does not appear in your Drive UI; we
          can&apos;t see it from any server because there is no
          server. Other apps can&apos;t see it either.
        </Bullet>
        <Bullet bold="In your local IndexedDB.">
          When you&apos;re signed out, state persists in your
          browser&apos;s IndexedDB so a refresh doesn&apos;t lose your
          work. You can clear it at any time via your
          browser&apos;s site-data controls.
        </Bullet>
        <Bullet bold="Never on any backend.">
          There is no server-side database in this build. No
          portfolio data, no spending, no plan parameters — none
          of it leaves your device unless you opt into Google
          Drive backup (and even then, optionally encrypted
          with a key only you hold).
        </Bullet>
      </Section>

      <Section title="Optional end-to-end encryption">
        <p className="text-[13px] leading-relaxed text-text-muted">
          Set a passphrase in Data → End-to-end encryption and
          the same seal applies to every surface where your data
          might leave the tab: local export downloads AND, if
          you sign in, your Google Drive backup. No sign-in
          required — encryption works for the Drive-free path
          (local export / import) too. The math:
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-text-muted">
          <li>
            <Code>AES-256-GCM</Code> for the cipher
          </li>
          <li>
            Key derived from your passphrase via{" "}
            <Code>PBKDF2-HMAC-SHA-256</Code> with{" "}
            <Code>250,000 iterations</Code> and a random
            16-byte salt per envelope
          </li>
          <li>
            12-byte random nonce (IV) per write — never reused
          </li>
          <li>
            Envelope schema documented as{" "}
            <Code>fp-enc-v1</Code> in{" "}
            <Code>lib/crypto.ts</Code> — a file you exported
            locally and a Drive-stored ciphertext are byte-for-
            byte equivalent if both were sealed with the same
            passphrase
          </li>
        </ul>
        <p className="mt-3 text-[13px] leading-relaxed text-text-muted">
          The passphrase lives only in your tab&apos;s memory.
          Closing the tab wipes it. We never see it, never
          send it, never persist it. If you forget it, the
          encrypted file is unreadable — there is no
          recovery flow, by design.
        </p>
      </Section>

      <Section title="What we deliberately don't do">
        <Bullet bold="No account aggregation.">
          We don&apos;t use Plaid, Yodlee, MX, or any other
          account-sync provider. You type your account
          balances. If that&apos;s a non-starter, this is
          probably not the right tool for you, and that&apos;s
          okay.
        </Bullet>
        <Bullet bold="No analytics on financial data.">
          No tracking of your portfolio values, target NW,
          spend rates, or projections. We don&apos;t aggregate
          user data for any product or marketing purpose
          because we can&apos;t — we don&apos;t have it.
        </Bullet>
        <Bullet bold="No model training.">
          Your data is not used to train any model, build any
          benchmark, or improve any recommendation. There
          isn&apos;t even a recommendation engine.
        </Bullet>
        <Bullet bold="No background workers touching your data.">
          There are no background jobs, no scheduled tasks, no
          server-side workers. The only network traffic from
          this app is your tab calling{" "}
          <Code>/api/quote/&lt;ticker&gt;</Code> for live prices
          (a thin proxy that fetches Finnhub, with Yahoo as a
          fallback — only the ticker symbol is sent, never your
          holdings) and, optionally, the Google Drive API on
          your behalf.
        </Bullet>
      </Section>

      <Section title="What can go wrong">
        <Bullet bold="You forget the encryption passphrase.">
          Your Drive backup is unrecoverable. Use a password
          manager. Disable encryption from the Data page if
          you&apos;d rather have plaintext-recoverable backups.
        </Bullet>
        <Bullet bold="You sign in on a new device without the passphrase.">
          The app refuses to overwrite your encrypted backup
          with plaintext. A persistent banner prompts for the
          passphrase before any sync.
        </Bullet>
        <Bullet bold="Google Drive API changes break sync.">
          Possible. We monitor deprecation notices, but a
          weekend without sync is a real risk. Your data
          stays safe in IDB locally; you just lose
          cross-device sync until we patch.
        </Bullet>
        <Bullet bold="A browser bug exposes IndexedDB to malicious script.">
          Theoretical. We use the same browser primitives
          every other web app uses; if Chrome has a zero-day,
          we&apos;re affected like the rest of the web.
        </Bullet>
      </Section>

      <Section title="Verify this yourself">
        <p className="text-[13px] leading-relaxed text-text-muted">
          The encryption layer is small and readable:
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-text-muted">
          <li>
            <Code>lib/crypto.ts</Code> — wrap/unwrap, key
            derivation, envelope format
          </li>
          <li>
            <Code>lib/cloudSync.ts</Code> — push/pull guards
            (shrinkage, encryption-required, race protection)
          </li>
          <li>
            <Code>lib/syncSafety.ts</Code> — fail-closed
            invariants for upload
          </li>
        </ul>
        <p className="mt-3 text-[13px] leading-relaxed text-text-muted">
          Open your browser&apos;s DevTools network tab while
          using the app. The only outbound requests you&apos;ll
          see are{" "}
          <Code>/api/quote/&lt;ticker&gt;</Code> (same-origin
          proxy to Finnhub for live equity / bond / crypto
          prices, with Yahoo Finance as fallback — only the
          ticker is sent, never your holdings or balances) and,
          if you&apos;ve opted in,{" "}
          <Code>googleapis.com</Code> (Drive backup). Nothing
          else. Your portfolio data is never transmitted
          anywhere by this app.
        </p>
      </Section>

      <Section title="The trade, plainly">
        <p className="text-[13px] leading-relaxed text-text-muted">
          Most personal-finance apps trade your data for
          convenience (Plaid sync, auto-categorization). This
          app trades convenience (you type your balances) for
          the architecture above. That&apos;s the deal. If
          it&apos;s the right one for you, welcome. If not,
          the spreadsheet you already have works on the same
          principle.
        </p>
      </Section>

      <p className="mt-10 text-[11px] text-text-dim">
        Found a security issue? Open an issue on GitHub or
        email the maintainer. The encryption layer is small
        and auditable — second opinions are welcome.
      </p>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold text-text">{title}</h2>
      <div className="mt-2 space-y-3">{children}</div>
    </section>
  );
}

function Bullet({
  bold,
  children,
}: {
  bold: string;
  children: React.ReactNode;
}) {
  return (
    <div className="text-[13px] leading-relaxed text-text-muted">
      <span className="font-semibold text-text">{bold}</span>{" "}
      {children}
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-bg-elevated px-1 py-0.5 text-[12px] font-mono text-text">
      {children}
    </code>
  );
}
