/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        // Apply to every route. Defense-in-depth against click-
        // jacking (no third-party iframe should embed this app),
        // referrer leakage (full URL would expose user state),
        // MIME sniffing, and unnecessary device-permission
        // surface area.
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Permissions-Policy",
            value:
              "geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), accelerometer=(), gyroscope=()",
          },
          // CSP — minimal allowlist that supports the actual
          // outbound surface the app uses:
          //   - Google sign-in (GIS loads from accounts.google.com
          //     AND pulls sub-resources from gstatic.com — both
          //     allow-listed in script-src; oauth iframes go
          //     through accounts.google.com)
          //   - Google Drive APIs (googleapis.com, oauth2)
          //   - Yahoo Finance + Finnhub quote fallbacks
          //   - inline scripts for Next.js hydration data
          //     (avoidable in a future refactor via nonce-based
          //     hashing wired into the Next.js runtime)
          //
          // One Tap is intentionally NOT used (we use the popup
          // flow), so `frame-ancestors 'none'` is safe — no
          // sign-in flow renders an iframe pointing back at us.
          //
          // CRITICAL: missing `gstatic.com` from script-src breaks
          // Google sign-in for every user. Verified once at deploy
          // by signing in on the preview URL.
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com https://*.gstatic.com",
              "style-src 'self' 'unsafe-inline' https://accounts.google.com",
              // *.googleusercontent.com covers lh3 (user avatars)
              // and any future bucket variant Google rotates to.
              "img-src 'self' data: blob: https://*.googleusercontent.com",
              "font-src 'self' data:",
              // *.googleapis.com covers www.googleapis.com,
              // oauth2.googleapis.com, content-storage.googleapis.com,
              // and any future API surface Google rotates to.
              "connect-src 'self' https://accounts.google.com https://*.googleapis.com https://query1.finance.yahoo.com https://query2.finance.yahoo.com https://finnhub.io",
              // Only accounts.google.com is used (OAuth popup); One
              // Tap is intentionally not wired so the narrow
              // allowlist is safe.
              "frame-src https://accounts.google.com",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              "upgrade-insecure-requests",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
