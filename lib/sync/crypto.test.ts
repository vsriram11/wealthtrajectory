// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { encryptString, decryptString, looksEncrypted } from "@/lib/sync/crypto";

describe("encryptString / decryptString round-trip", () => {
  it("recovers the original plaintext with the correct passphrase", async () => {
    const original = JSON.stringify({
      hello: "world",
      n: 42,
      nested: { a: [1, 2, 3] },
    });
    const envelope = await encryptString(original, "hunter2-correct-horse");
    const recovered = await decryptString(envelope, "hunter2-correct-horse");
    expect(recovered).toBe(original);
  });

  it("rejects the wrong passphrase", async () => {
    const envelope = await encryptString("secret payload", "right");
    await expect(decryptString(envelope, "wrong")).rejects.toThrow(
      /wrong passphrase/i,
    );
  });

  it("produces different ciphertext each call (random IV)", async () => {
    const a = await encryptString("x", "k");
    const b = await encryptString("x", "k");
    expect(a).not.toBe(b);
  });

  it("envelope is JSON with schema 'fp-enc-v1'", async () => {
    const envelope = await encryptString("hi", "k");
    const obj = JSON.parse(envelope);
    expect(obj.schema).toBe("fp-enc-v1");
    expect(typeof obj.salt).toBe("string");
    expect(typeof obj.iv).toBe("string");
    expect(typeof obj.ciphertext).toBe("string");
  });

  it("looksEncrypted detects envelopes vs plaintext JSON", () => {
    const env = JSON.stringify({
      schema: "fp-enc-v1",
      salt: "x",
      iv: "y",
      ciphertext: "z",
    });
    const plain = JSON.stringify({ household: {}, schema: 1 });
    expect(looksEncrypted(env)).toBe(true);
    expect(looksEncrypted(plain)).toBe(false);
    expect(looksEncrypted("not json at all")).toBe(false);
  });

  it("empty passphrase rejected on encrypt and decrypt", async () => {
    await expect(encryptString("x", "")).rejects.toThrow(/passphrase/i);
    const env = await encryptString("x", "k");
    await expect(decryptString(env, "")).rejects.toThrow(/passphrase/i);
  });
});
