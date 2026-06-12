import { cookies } from "next/headers";
import { db } from "./db";

export const SESSION_COOKIE = "session";
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7; // 7 days
export const MAGIC_LINK_DURATION_SECONDS = 60 * 15; // 15 minutes

export function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export async function getSession(): Promise<{ email: string } | null> {
  const sessionId = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;

  const result = await db.execute({
    sql: "SELECT email, expires_at FROM sessions WHERE id = ?",
    args: [sessionId],
  });

  const row = result.rows[0];
  if (!row) return null;
  if (Number(row.expires_at) < nowInSeconds()) return null;

  return { email: String(row.email) };
}

export async function createSession(email: string): Promise<{ id: string; expiresAt: number }> {
  const id = crypto.randomUUID();
  const now = nowInSeconds();
  const expiresAt = now + SESSION_DURATION_SECONDS;

  await db.execute({
    sql: "INSERT INTO sessions (id, email, expires_at, created_at) VALUES (?, ?, ?, ?)",
    args: [id, email, expiresAt, now],
  });

  return { id, expiresAt };
}

export async function destroySession(sessionId: string): Promise<void> {
  await db.execute({
    sql: "DELETE FROM sessions WHERE id = ?",
    args: [sessionId],
  });
}
