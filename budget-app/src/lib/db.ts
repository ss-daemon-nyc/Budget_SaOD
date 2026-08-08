import { Pool } from "pg";

/**
 * One connection string drives both environments:
 *   demo        postgres://postgres@localhost:5433/budget
 *   Supabase    the "Connection pooling" URI from Project Settings → Database
 *
 * Nothing else in the app changes between the two.
 */
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
  );
}

const globalForPool = globalThis as unknown as { _pool?: Pool };

export const pool =
  globalForPool._pool ??
  new Pool({
    connectionString,
    max: 5,
    // Supabase requires TLS; a local demo server does not offer it.
    ssl: /supabase|amazonaws|\bsslmode=require\b/.test(connectionString)
      ? { rejectUnauthorized: false }
      : undefined,
  });

if (process.env.NODE_ENV !== "production") globalForPool._pool = pool;

/** Numerics come back from pg as strings to preserve precision. */
export const num = (v: string | number | null): number =>
  v === null ? 0 : typeof v === "number" ? v : Number(v);
