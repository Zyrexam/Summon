import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("produces a salted scrypt hash, never the password", async () => {
    const stored = await hashPassword("correct-horse-battery");
    expect(stored).not.toContain("correct-horse-battery");
    const [salt, hash] = stored.split(".");
    expect(salt).toHaveLength(32); // 16 random bytes, hex
    expect(hash).toHaveLength(128); // 64 byte scrypt output, hex
  });

  it("salts every hash, so identical passwords differ on disk", async () => {
    const [a, b] = await Promise.all([
      hashPassword("same-password"),
      hashPassword("same-password"),
    ]);
    expect(a).not.toBe(b);
    expect(await verifyPassword("same-password", a)).toBe(true);
    expect(await verifyPassword("same-password", b)).toBe(true);
  });

  it("accepts the right password and rejects the wrong one", async () => {
    const stored = await hashPassword("correct-horse-battery");
    expect(await verifyPassword("correct-horse-battery", stored)).toBe(true);
    expect(await verifyPassword("correct-horse-batteryy", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("rejects malformed stored hashes without throwing", async () => {
    for (const bad of ["", "nodot", ".", "onlysalt.", ".onlyhash", "a.b"]) {
      expect(await verifyPassword("whatever", bad)).toBe(false);
    }
  });

  it("does not block the event loop while hashing", async () => {
    // scryptSync parks the whole process for ~100ms per call. Under load that
    // serialises every other request on the instance; a tick must still land.
    let ticks = 0;
    const ticker = setInterval(() => {
      ticks += 1;
    }, 5);
    const start = Date.now();
    await hashPassword("blocking-check-password");
    const elapsed = Date.now() - start;
    clearInterval(ticker);
    expect(elapsed).toBeGreaterThan(10); // scrypt really did take real work
    expect(ticks).toBeGreaterThan(0); // but the loop was free to run
  });
});