import pg from "pg";

import type { Queryable } from "@summon/core";

const { Pool } = pg;

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://summon:summon@127.0.0.1:5432/summon";

export const pool: Queryable = new Pool({ connectionString });

export const tokenSecret = process.env.TOKEN_SECRET ?? "summon-dev-secret";
