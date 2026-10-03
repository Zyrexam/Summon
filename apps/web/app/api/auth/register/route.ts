import { NextResponse } from "next/server";
import { createUser, normalizeEmail, signToken } from "@summon/core";
import { pool, tokenSecret } from "@/lib/pg";
import { hashPassword } from "@/lib/password";
import { isRateLimited } from "@/lib/rate-limit";

export async function POST(request: Request) {
  let body: { email?: string; password?: string; name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const email = normalizeEmail(body.email ?? "");
  const password = body.password ?? "";
  const name = (body.name ?? "").trim() || "Guest";
  if (!email.includes("@") || password.length < 6) {
    return NextResponse.json(
      { error: "Valid email and password (6+ chars) required" },
      { status: 400 },
    );
  }
  if (await isRateLimited(request, email)) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  }
  try {
    const user = await createUser(
      pool,
      crypto.randomUUID(),
      email,
      await hashPassword(password),
      name,
    );
    if (!user) {
      return NextResponse.json({ error: "Email already registered" }, { status: 409 });
    }
    const token = await signToken(user.id, tokenSecret);
    return NextResponse.json({ token, user: { id: user.id, email, name: user.name } });
  } catch {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }
}
