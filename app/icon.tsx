import { ImageResponse } from "next/og";

// Next.js auto-serves this as /icon (PNG) and injects the appropriate
// <link rel="icon"> in the document head. The SVG-based metadata in
// app/layout.tsx covers modern browsers; this PNG covers iOS Safari's
// home-screen install and any client that prefers a raster icon.
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
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
          borderRadius: 96,
        }}
      >
        <svg
          width="512"
          height="512"
          viewBox="0 0 512 512"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect width="512" height="512" rx="96" fill="#0a0d12" />
          <circle
            cx="256"
            cy="256"
            r="190"
            fill="none"
            stroke="#1e2630"
            strokeWidth="6"
          />
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
