"use server";

import { db } from "@/lib/db";
import { sendMagicLinkEmail } from "@/lib/email";
import { MAGIC_LINK_DURATION_SECONDS, nowInSeconds } from "@/lib/auth";

export interface RequestMagicLinkState {
  submitted: boolean;
}

export async function requestMagicLink(
  _prevState: RequestMagicLinkState,
  formData: FormData,
): Promise<RequestMagicLinkState> {
  const email = String(formData.get("email") || "")
    .trim()
    .toLowerCase();

  const allowedEmails = (process.env.ALLOWED_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (email && allowedEmails.includes(email)) {
    const token = crypto.randomUUID() + crypto.randomUUID();
    const now = nowInSeconds();

    await db.execute({
      sql: "INSERT INTO magic_link_tokens (id, email, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
      args: [crypto.randomUUID(), email, token, now + MAGIC_LINK_DURATION_SECONDS, now],
    });

    await sendMagicLinkEmail(email, token);
  }

  // Always report success, regardless of whether the email was recognised.
  return { submitted: true };
}
