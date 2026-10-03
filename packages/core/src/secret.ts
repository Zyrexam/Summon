/**
 * The fallback both apps use so the repo runs with no setup. It is published in
 * the README, which means it must never be allowed to reach production.
 */
export const DEV_SECRET_FALLBACK = "summon-dev-secret";

/** Anything shorter than this is not a secret, whatever its name suggests. */
export const MIN_SECRET_LENGTH = 32;

export function assertStrongSecret(
  secret: string | undefined,
  isProduction: boolean,
): void {
  if (!isProduction) return;
  if (!secret || secret.trim() === "") {
    throw new Error(
      "TOKEN_SECRET is not set. Generate one with: openssl rand -base64 48",
    );
  }
  if (secret === DEV_SECRET_FALLBACK) {
    throw new Error(
      "TOKEN_SECRET is still the published development default. Generate a real one with: openssl rand -base64 48",
    );
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `TOKEN_SECRET must be at least ${MIN_SECRET_LENGTH} characters to be unguessable.`,
    );
  }
}