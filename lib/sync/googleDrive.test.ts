// @vitest-environment jsdom
/**
 * googleDrive.ts wraps Drive REST calls scoped to the appDataFolder.
 * Tests mock the fetch global to verify the right URLs + bodies are
 * sent and the response shapes are parsed correctly.
 *
 * Coverage targets:
 *   - findBackupFile happy path + 0-result case + multi-result sort
 *   - downloadBackup happy path + non-OK rejection
 *   - uploadBackup creates a NEW file when none exists (multipart POST)
 *   - uploadBackup PATCHes an existing file + cleans up duplicates
 *   - loadQuoteCache returns null on missing / malformed / wrong schema
 *   - saveQuoteCache routes through uploadFile
 *   - loadActiveSession returns null on missing / malformed
 *   - claimActiveSession writes a session marker
 *
 * The `authed` helper is exercised implicitly via every call.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuoteCache } from "@/lib/sync/googleDrive";

const TOKEN = "test-access-token";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  (globalThis as unknown as { fetch: typeof fetch }).fetch =
    fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("findBackupFile", () => {
  it("returns null when Drive reports zero files matching the name", async () => {
    const { findBackupFile } = await import("@/lib/sync/googleDrive");
    fetchMock.mockResolvedValueOnce(jsonResponse({ files: [] }));
    const out = await findBackupFile(TOKEN);
    expect(out).toBeNull();
  });

  it("returns the newest file when Drive reports duplicates (lex sort on RFC 3339)", async () => {
    // Appdata folder doesn't enforce filename uniqueness — past
    // race bugs can leave orphaned duplicates. The function MUST
    // pick the most recently modified one so a stale duplicate
    // can't be read as the current state.
    const { findBackupFile } = await import("@/lib/sync/googleDrive");
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        files: [
          { id: "old", name: "wt", modifiedTime: "2024-01-01T00:00:00Z" },
          { id: "new", name: "wt", modifiedTime: "2026-05-01T00:00:00Z" },
          { id: "mid", name: "wt", modifiedTime: "2025-06-01T00:00:00Z" },
        ],
      }),
    );
    const out = await findBackupFile(TOKEN);
    expect(out).toEqual({ id: "new", modifiedTime: "2026-05-01T00:00:00Z" });
  });

  it("throws when the upstream API returns non-OK", async () => {
    const { findBackupFile } = await import("@/lib/sync/googleDrive");
    fetchMock.mockResolvedValueOnce(
      new Response("Forbidden", { status: 403 }),
    );
    await expect(findBackupFile(TOKEN)).rejects.toThrow(/Drive 403/);
  });

  it("includes the Authorization header on the lookup request", async () => {
    const { findBackupFile } = await import("@/lib/sync/googleDrive");
    fetchMock.mockResolvedValueOnce(jsonResponse({ files: [] }));
    await findBackupFile(TOKEN);
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
    });
  });

  it("scopes the search to appDataFolder", async () => {
    const { findBackupFile } = await import("@/lib/sync/googleDrive");
    fetchMock.mockResolvedValueOnce(jsonResponse({ files: [] }));
    await findBackupFile(TOKEN);
    const [url] = fetchMock.mock.calls[0];
    // Without `spaces=appDataFolder` the query would search the
    // user's entire Drive — a privacy violation. Pin the scope.
    expect(url).toContain("spaces=appDataFolder");
  });
});

describe("downloadBackup", () => {
  it("returns the raw response text on success", async () => {
    const { downloadBackup } = await import("@/lib/sync/googleDrive");
    fetchMock.mockResolvedValueOnce(new Response("ciphertext-or-json-bytes"));
    const out = await downloadBackup(TOKEN, "file-id-123");
    expect(out).toBe("ciphertext-or-json-bytes");
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://www.googleapis.com/drive/v3/files/file-id-123?alt=media",
    );
  });

  it("throws on a non-OK download response", async () => {
    const { downloadBackup } = await import("@/lib/sync/googleDrive");
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    await expect(downloadBackup(TOKEN, "x")).rejects.toThrow(
      /Drive download 500/,
    );
  });
});

describe("uploadBackup — create path (no existing file)", () => {
  it("POSTs a multipart create when Drive reports zero existing files", async () => {
    const { uploadBackup } = await import("@/lib/sync/googleDrive");
    fetchMock.mockResolvedValueOnce(jsonResponse({ files: [] })); // findAllFiles
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: "new-id", modifiedTime: "2026-05-15T00:00:00Z" }),
    );
    const out = await uploadBackup(TOKEN, '{"ciphertext":"…"}');
    expect(out).toEqual({
      id: "new-id",
      modifiedTime: "2026-05-15T00:00:00Z",
    });
    // Two fetches: the search + the multipart POST.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [createUrl, createInit] = fetchMock.mock.calls[1];
    expect(createUrl).toContain("uploadType=multipart");
    expect((createInit as RequestInit).method).toBe("POST");
    // Body should be a multipart/related blob containing both
    // the metadata + the payload content.
    expect((createInit as RequestInit).body).toContain('"appDataFolder"');
    expect((createInit as RequestInit).body).toContain('"ciphertext":"…"');
  });

  it("throws when the create POST fails", async () => {
    const { uploadBackup } = await import("@/lib/sync/googleDrive");
    fetchMock.mockResolvedValueOnce(jsonResponse({ files: [] }));
    fetchMock.mockResolvedValueOnce(
      new Response("server error", { status: 500 }),
    );
    await expect(uploadBackup(TOKEN, "{}")).rejects.toThrow(/Drive create 500/);
  });
});

describe("uploadBackup — update path (existing file)", () => {
  it("PATCHes the most recent file when one already exists", async () => {
    const { uploadBackup } = await import("@/lib/sync/googleDrive");
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        files: [
          { id: "primary", name: "wt", modifiedTime: "2026-05-01T00:00:00Z" },
        ],
      }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: "primary", modifiedTime: "2026-05-15T00:00:00Z" }),
    );
    const out = await uploadBackup(TOKEN, '{"updated":true}');
    expect(out.id).toBe("primary");
    // Method must be PATCH against the existing file id.
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toContain("/upload/drive/v3/files/primary");
    expect((init as RequestInit).method).toBe("PATCH");
  });

  it("cleans up older duplicates after a successful PATCH", async () => {
    const { uploadBackup } = await import("@/lib/sync/googleDrive");
    // Three duplicates returned — the function PATCHes the
    // newest and DELETEs the two older ones (best-effort).
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        files: [
          { id: "new", name: "wt", modifiedTime: "2026-05-01T00:00:00Z" },
          { id: "mid", name: "wt", modifiedTime: "2025-06-01T00:00:00Z" },
          { id: "old", name: "wt", modifiedTime: "2024-01-01T00:00:00Z" },
        ],
      }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: "new", modifiedTime: "2026-05-15T00:00:00Z" }),
    );
    // Two cleanup deletes — best-effort, can fail silently.
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const out = await uploadBackup(TOKEN, '{"x":1}');
    expect(out.id).toBe("new");
    // Total fetches: 1 search + 1 PATCH + 2 DELETEs = 4.
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const deleteCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === "DELETE",
    );
    expect(deleteCalls).toHaveLength(2);
    // The DELETE URLs target the OLDER duplicates, not the new one.
    const deletedIds = deleteCalls
      .map(([url]) => String(url).split("/").pop())
      .sort();
    expect(deletedIds).toEqual(["mid", "old"]);
  });

  it("succeeds even if the duplicate-cleanup deletes fail (best-effort)", async () => {
    const { uploadBackup } = await import("@/lib/sync/googleDrive");
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        files: [
          { id: "new", name: "wt", modifiedTime: "2026-05-01T00:00:00Z" },
          { id: "old", name: "wt", modifiedTime: "2024-01-01T00:00:00Z" },
        ],
      }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: "new", modifiedTime: "2026-05-15T00:00:00Z" }),
    );
    // Delete fails with a 500.
    fetchMock.mockRejectedValueOnce(new Error("delete network error"));

    // The function must NOT throw — cleanup is best-effort.
    const out = await uploadBackup(TOKEN, "{}");
    expect(out.id).toBe("new");
  });
});

describe("loadQuoteCache", () => {
  it("returns null when no quote cache file exists", async () => {
    const { loadQuoteCache } = await import("@/lib/sync/googleDrive");
    fetchMock.mockResolvedValueOnce(jsonResponse({ files: [] }));
    expect(await loadQuoteCache(TOKEN)).toBeNull();
  });

  it("returns the parsed cache when file + schema check pass", async () => {
    const { loadQuoteCache } = await import("@/lib/sync/googleDrive");
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        files: [{ id: "qc", name: "q", modifiedTime: "2026-05-01T00:00:00Z" }],
      }),
    );
    const cache: QuoteCache = {
      schema: 1,
      bySymbol: {
        VOO: {
          history: [{ t: 1, p: 100 }],
          currentPrice: 580,
          name: "Vanguard S&P 500",
          fetchedAt: 1_700_000_000_000,
        },
      },
    };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(cache)));
    expect(await loadQuoteCache(TOKEN)).toEqual(cache);
  });

  it("returns null when the file content is malformed JSON", async () => {
    const { loadQuoteCache } = await import("@/lib/sync/googleDrive");
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        files: [{ id: "qc", name: "q", modifiedTime: "2026-05-01T00:00:00Z" }],
      }),
    );
    fetchMock.mockResolvedValueOnce(new Response("{not-json"));
    // Malformed cache → null, NOT a crash. Consumers fall back
    // to a fresh fetch.
    expect(await loadQuoteCache(TOKEN)).toBeNull();
  });

  it("returns null when the file has the wrong schema version", async () => {
    const { loadQuoteCache } = await import("@/lib/sync/googleDrive");
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        files: [{ id: "qc", name: "q", modifiedTime: "2026-05-01T00:00:00Z" }],
      }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ schema: 99, bySymbol: {} })),
    );
    // Schema mismatch → null. A future v2 cache uploaded by a
    // newer client must NOT be parsed as a v1 cache.
    expect(await loadQuoteCache(TOKEN)).toBeNull();
  });
});

describe("saveQuoteCache", () => {
  it("uploads the cache via the upload path", async () => {
    const { saveQuoteCache } = await import("@/lib/sync/googleDrive");
    fetchMock.mockResolvedValueOnce(jsonResponse({ files: [] }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: "new", modifiedTime: "2026-05-15T00:00:00Z" }),
    );
    const cache: QuoteCache = { schema: 1, bySymbol: {} };
    await saveQuoteCache(TOKEN, cache);
    // Two calls: search + create. The body of the create call
    // must contain the JSON cache.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, createInit] = fetchMock.mock.calls[1];
    expect((createInit as RequestInit).body).toContain('"schema":1');
  });
});

describe("loadActiveSession + claimActiveSession", () => {
  it("loadActiveSession returns null when no session marker exists", async () => {
    const { loadActiveSession } = await import("@/lib/sync/googleDrive");
    fetchMock.mockResolvedValueOnce(jsonResponse({ files: [] }));
    expect(await loadActiveSession(TOKEN)).toBeNull();
  });

  it("loadActiveSession returns the parsed marker when present", async () => {
    const { loadActiveSession } = await import("@/lib/sync/googleDrive");
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        files: [{ id: "s", name: "wt", modifiedTime: "2026-05-01T00:00:00Z" }],
      }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          sessionId: "sess-abc",
          signedInAt: 1_700_000_000_000,
        }),
      ),
    );
    expect(await loadActiveSession(TOKEN)).toEqual({
      sessionId: "sess-abc",
      signedInAt: 1_700_000_000_000,
    });
  });

  it("loadActiveSession returns null when the marker has the wrong shape", async () => {
    const { loadActiveSession } = await import("@/lib/sync/googleDrive");
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        files: [{ id: "s", name: "wt", modifiedTime: "2026-05-01T00:00:00Z" }],
      }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ sessionId: 12345 /* should be string */ })),
    );
    expect(await loadActiveSession(TOKEN)).toBeNull();
  });

  it("claimActiveSession writes the session marker", async () => {
    const { claimActiveSession } = await import("@/lib/sync/googleDrive");
    fetchMock.mockResolvedValueOnce(jsonResponse({ files: [] }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: "new", modifiedTime: "2026-05-15T00:00:00Z" }),
    );
    await claimActiveSession(TOKEN, "sess-new");
    const [, createInit] = fetchMock.mock.calls[1];
    expect((createInit as RequestInit).body).toContain('"sessionId":"sess-new"');
    // signedInAt is stamped at call time — must be a finite ms epoch.
    expect((createInit as RequestInit).body).toMatch(/"signedInAt":\d+/);
  });
});
