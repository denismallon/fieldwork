"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { destroySession, SESSION_COOKIE } from "@/lib/auth";

export async function signOut() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;

  if (sessionId) {
    await destroySession(sessionId);
  }

  cookieStore.delete(SESSION_COOKIE);
  redirect("/login");
}
