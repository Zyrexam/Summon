export type AuthErrorLog = {
  event: "auth_failed";
  route: string;
  reason: string;
};

export type AuthErrorResponse = {
  status: number;
  body: { error: string };
};

/**
 * "Invalid credentials" for everything that goes wrong on the auth routes.
 * A distinct message for a dead database tells an attacker which deployments
 * are misconfigured; the real reason goes to the log, not to the caller.
 */
export function authErrorResponse(_cause: unknown): AuthErrorResponse {
  return { status: 401, body: { error: "Invalid credentials" } };
}

/** One line, no request bodies: enough to debug, nothing to leak. */
export function describeAuthError(route: string, cause: unknown): AuthErrorLog {
  const reason =
    cause instanceof Error
      ? `${cause.name}: ${cause.message}`
      : String(cause);
  return { event: "auth_failed", route, reason };
}
