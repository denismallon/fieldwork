import { createClient, type Client } from "@libsql/client";

const globalForDb = globalThis as unknown as { __turso?: Client };

function createDbClient(): Client {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    throw new Error("TURSO_DATABASE_URL is not set");
  }

  return createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
}

function getDbClient(): Client {
  if (!globalForDb.__turso) {
    globalForDb.__turso = createDbClient();
  }
  return globalForDb.__turso;
}

// Lazily constructed so that importing this module doesn't require Turso
// credentials to be present at build time — the client is only created the
// first time a query actually runs.
export const db: Client = new Proxy({} as Client, {
  get(_target, prop) {
    const client = getDbClient();
    const value = Reflect.get(client, prop);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
