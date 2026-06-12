import { Resend } from "resend";

let resendClient: Resend | null = null;

function getResendClient(): Resend {
  if (!resendClient) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error("RESEND_API_KEY is not set");
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

export async function sendMagicLinkEmail(email: string, token: string): Promise<void> {
  const appUrl = process.env.APP_URL;
  const from = process.env.EMAIL_FROM;
  const replyTo = process.env.EMAIL_REPLY_TO;

  if (!appUrl) throw new Error("APP_URL is not set");
  if (!from) throw new Error("EMAIL_FROM is not set");

  const verifyUrl = `${appUrl}/auth/verify?token=${token}`;

  await getResendClient().emails.send({
    from,
    to: email,
    replyTo: replyTo || undefined,
    subject: "Sign in to Fieldwork",
    html: `
      <p>Click the link below to sign in to Fieldwork.</p>
      <p><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p>This link expires in 15 minutes. If you didn't request it, you can ignore this email.</p>
    `,
  });
}
