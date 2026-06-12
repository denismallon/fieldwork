import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@libsql/client/web";

const SESSION_COOKIE = "session";

export async function middleware(request: NextRequest) {
  const sessionId = request.cookies.get(SESSION_COOKIE)?.value;

  if (sessionId) {
    const client = createClient({
      url: process.env.TURSO_DATABASE_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });

    const result = await client.execute({
      sql: "SELECT email, expires_at FROM sessions WHERE id = ?",
      args: [sessionId],
    });

    const row = result.rows[0];
    const now = Math.floor(Date.now() / 1000);

    if (row && Number(row.expires_at) > now) {
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set("x-user-email", String(row.email));
      return NextResponse.next({ request: { headers: requestHeaders } });
    }
  }

  const loginUrl = new URL("/login", request.url);
  const response = NextResponse.redirect(loginUrl);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}

export const config = {
  matcher: ["/((?!login|auth/verify|_next/static|_next/image|favicon.ico).*)"],
};
