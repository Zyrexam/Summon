import { describe, expect, it } from "vitest";

describe("serverless pool configuration", () => {
  it("bounds the pool so a warm lambda cannot hoard connections", async () => {
    const { poolOptions } = await import("./pg-config");
    expect(poolOptions("postgresql://u:p@host/db").max).toBeLessThanOrEqual(2);
  });

  it("fails fast instead of hanging on a stalled connection", async () => {
    const { poolOptions } = await import("./pg-config");
    const options = poolOptions("postgresql://u:p@host/db");
    expect(options.connectionTimeoutMillis).toBeGreaterThan(0);
  });

  it("closes idle connections so Neon is not held open for nothing", async () => {
    const { poolOptions } = await import("./pg-config");
    expect(poolOptions("postgresql://u:p@host/db").idleTimeoutMillis).toBeGreaterThan(0);
  });

  it("caps how long a single query may run", async () => {
    const { poolOptions } = await import("./pg-config");
    expect(poolOptions("postgresql://u:p@host/db")).toMatchObject({
      statement_timeout: expect.any(Number),
    });
  });

  it("passes the connection string through untouched", async () => {
    const { poolOptions } = await import("./pg-config");
    const url = "postgresql://u:p@host/db?sslmode=require";
    expect(poolOptions(url).connectionString).toBe(url);
  });

  it("refuses to build a pool without a connection string", async () => {
    const { poolOptions } = await import("./pg-config");
    expect(() => poolOptions("")).toThrow(/DATABASE_URL/);
  });
});