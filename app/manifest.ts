import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "wealthtrajectory",
    short_name: "wealthtrajectory",
    description:
      "Private, privacy-first net-worth and financial-independence planning. Track holdings, project trajectories, and stress-test against historical sequences — all client-side.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0d12",
    theme_color: "#0a0d12",
    orientation: "portrait",
    icons: [
      // PNG generated from app/icon.tsx via ImageResponse. Most reliable
      // for Android home-screen install and any browser that doesn't
      // honor SVG icons.
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      // PNG sized for iOS apple-touch-icon, also useful as an Android
      // maskable fallback.
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
      // Scalable SVG fallbacks for browsers that prefer vector.
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon-maskable.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
