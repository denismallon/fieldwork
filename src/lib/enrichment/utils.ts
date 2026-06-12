export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export const FETCH_TIMEOUT_MS = 10_000;

/** Two-letter language prefixes checked when looking for localized paths. */
export const LANGUAGE_CODES = ["en", "fr", "de", "es", "nl", "it", "pt", "sv", "da", "fi", "nb", "pl"];

/** Fetches a URL with a realistic browser UA and a hard timeout. Returns null on any error. */
export async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, ...init.headers },
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}
