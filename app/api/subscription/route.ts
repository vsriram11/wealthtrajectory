import { NextRequest } from "next/server";

export const runtime = "nodejs";

/**
 * Subscription status endpoint.
 *
 * In this build every user is treated as "pro" — there is no
 * subscription tier and every feature is free. The endpoint is
 * preserved (rather than removed) to keep the gating-related call
 * sites in `useIsPro` / `ProGate` consistent and unchanged. If
 * gating were ever reintroduced for any reason, it would live in
 * this one file plus the two referenced above — not scattered
 * across consumers.
 *
 * No PII is consumed here; the email query param is accepted for
 * API-shape compatibility with the legacy gated form but is
 * intentionally unused.
 */
export async function GET(req: NextRequest) {
  void req.nextUrl.searchParams.get("email");
  return json({ status: "pro", reason: "oss build — all features free" });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, max-age=300",
    },
  });
}
