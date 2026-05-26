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
          //   - Google sign-in + Drive APIs
          //   - Yahoo Finance + Finnhub quote fallbacks
          //   - inline scripts ONLY for Next.js hydration data
          //     (avoidable in a future refactor; allowed via
          //     'unsafe-inline' for now since stripping it
          //     would require nonce-based hashing wired into
          //     the Next.js runtime)
          //   - workers (Web Worker for any future PWA path)
          // Reports-only equivalent could be added later if we
          // want to monitor without enforcing.
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https://lh3.googleusercontent.com",
              "font-src 'self' data:",
              "connect-src 'self' https://accounts.google.com https://www.googleapis.com https://oauth2.googleapis.com https://query1.finance.yahoo.com https://query2.finance.yahoo.com https://finnhub.io",
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
