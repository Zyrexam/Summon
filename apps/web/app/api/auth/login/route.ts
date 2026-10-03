import { NextResponse } from "next/server";
import { findUserByEmail, normalizeEmail, signToken } from "@summon/core";
import { getPool, getTokenSecret } from "@/lib/pg";
import { verifyPassword } from "@/lib/password";
import { authErrorResponse, describeAuthError } from "@/lib/auth-errors";
import { isRateLimited } from "@/lib/rate-limit";

export async function POST(request: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const email = normalizeEmail(body.email ?? "");
  const password = body.password ?? "";
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }
  if (await isRateLimited(request, email)) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  }
  try {
    const user = await findUserByEmail(getPool(), email);
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }
    const token = await signToken(user.id, getTokenSecret());
    return NextResponse.json({
      token,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (cause) {
    // The caller learns nothing; the operator learns everything.
    console.error(JSON.stringify(describeAuthError("login", cause)));
    const failure = authErrorResponse(cause);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
