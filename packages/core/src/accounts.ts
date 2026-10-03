export type AuthUser = { id: string; email: string; password_hash: string; name: string };
export type CreatedUser = { id: string; name: string };

export type Queryable = {
  query<T>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
};

export const INSERT_USER_SQL =
  `INSERT INTO users (id, email, password_hash, name)
   VALUES ($1, $2, $3, $4)
   ON CONFLICT (email) DO NOTHING
   RETURNING id, name`;

export const SELECT_USER_BY_EMAIL_SQL =
  `SELECT id, email, password_hash, name FROM users WHERE email = $1`;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function createUser(
  db: Queryable,
  id: string,
  email: string,
  passwordHash: string,
  name: string,
): Promise<CreatedUser | null> {
  const result = await db.query<CreatedUser>(INSERT_USER_SQL, [
    id,
    normalizeEmail(email),
    passwordHash,
    name,
  ]);
  return result.rows[0] ?? null;
}

export async function findUserByEmail(db: Queryable, email: string): Promise<AuthUser | null> {
  const result = await db.query<AuthUser>(SELECT_USER_BY_EMAIL_SQL, [normalizeEmail(email)]);
  return result.rows[0] ?? null;
}
