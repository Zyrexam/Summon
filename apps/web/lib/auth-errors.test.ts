import { describe, expect, it } from "vitest";

describe("auth failure reporting", () => {
  it("says the same thing to the client whatever broke", async () => {
    const { authErrorResponse } = await import("./auth-errors");
    // A wrong password and a dead database must be indistinguishable from
    // outside, or the error text becomes a probe for what is misconfigured.
    const response = authErrorResponse(new Error("ECONNREFUSED 127.0.0.1:5432"));
    expect(response.body).toEqual({ error: "Invalid credentials" });
    expect(response.status).toBe(401);
  });

  it("never returns the underlying reason to the client", async () => {
    const { authErrorResponse } = await import("./auth-errors");
    const response = authErrorResponse(new Error("password authentication failed for user \"summon\""));
    expect(JSON.stringify(response.body)).not.toContain("password authentication");
    expect(JSON.stringify(response.body)).not.toContain("summon");
  });

  it("keeps the real reason in the log line", async () => {
    const { describeAuthError } = await import("./auth-errors");
    const line = describeAuthError("login", new Error("ECONNREFUSED"));
    expect(line.event).toBe("auth_failed");
    expect(line.reason).toContain("ECONNREFUSED");
  });

  it("does not log the submitted password", async () => {
    const { describeAuthError } = await import("./auth-errors");
    const error = Object.assign(new Error("boom"), { password: "hunter2hunter2" });
    const line = describeAuthError("register", error);
    expect(JSON.stringify(line)).not.toContain("hunter2");
  });

  it("survives a thrown value that is not an Error", async () => {
    const { describeAuthError } = await import("./auth-errors");
    const line = describeAuthError("login", "just a string");
    expect(line.event).toBe("auth_failed");
    expect(typeof line.reason).toBe("string");
  });
});