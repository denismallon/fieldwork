import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { createSession, nowInSeconds, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ERROR_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Sign-in link invalid</title>
  </head>
  <body style="font-family: system-ui, sans-serif; padding: 3rem; color: #1f2937;">
    <p>This sign-in link is invalid or has expired.</p>
    <p><a href="/login">Return to login</a></p>
  </body>
</html>`;

function errorResponse() {
  return new NextResponse(ERROR_HTML, {
    status: 400,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) return errorResponse();

  const result = await db.execute({
    sql: "SELECT id, email, expires_at, used_at FROM magic_link_tokens WHERE token = ?",
    args: [token],
  });

  const row = result.rows[0];
  if (!row) return errorResponse();

  const now = nowInSeconds();
  if (row.used_at !== null || Number(row.expires_at) < now) {
    return errorResponse();
  }

  await db.execute({
    sql: "UPDATE magic_link_tokens SET used_at = ? WHERE id = ?",
    args: [now, row.id],
  });

  const session = await createSession(String(row.email));

  const response = NextResponse.redirect(new URL("/", request.url));
  response.cookies.set(SESSION_COOKIE, session.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(session.expiresAt * 1000),
  });
  return response;
}
