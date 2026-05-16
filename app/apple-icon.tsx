import { ImageResponse } from "next/og";

// iOS Safari "Add to Home Screen" reads <link rel="apple-touch-icon">.
// Critical: must be a PNG, ideally 180x180. Next.js detects this file
// and emits the proper meta tag. The icon is full-bleed (no transparent
// background) because iOS applies its own corner mask.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0d12",
        }}
      >
        <svg
          width="180"
          height="180"
          viewBox="0 0 512 512"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect width="512" height="512" fill="#0a0d12" />
          <defs>
            <linearGradient id="flame" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="#fbbf24" />
              <stop offset="50%" stopColor="#f97316" />
              <stop offset="100%" stopColor="#38bdf8" />
            </linearGradient>
          </defs>
          <path
            d="M 256 100 C 230 160, 200 200, 200 260 C 200 300, 230 320, 256 320 C 282 320, 312 300, 312 260 C 312 200, 282 160, 256 100 Z"
            fill="url(#flame)"
          />
          <polyline
            points="160 380, 220 350, 280 360, 350 300"
            fill="none"
            stroke="#38bdf8"
            strokeWidth="14"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    ),
    { ...size },
  );
}
