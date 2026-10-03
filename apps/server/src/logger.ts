export type LogLevel = "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

export type Logger = {
  info: (event: string, fields?: LogFields) => void;
  warn: (event: string, fields?: LogFields) => void;
  error: (event: string, fields?: LogFields) => void;
};

export type LoggerOptions = {
  sink?: (line: string) => void;
  now?: () => number;
};

/**
 * Field names that must never reach a log line. A relay handles bearer
 * tokens, room keys and passwords; a stray log file should not outlive them.
 */
const SECRET_FIELDS = new Set([
  "token",
  "password",
  "key",
  "secret",
  "authorization",
  "cookie",
  "password_hash",
  "enc",
  "iv",
]);

function safeFields(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [name, value] of Object.entries(fields)) {
    if (SECRET_FIELDS.has(name.toLowerCase())) {
      out[name] = "[redacted]";
    } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[name] = value;
    } else if (value === null || value === undefined) {
      out[name] = value;
    } else {
      out[name] = String(value);
    }
  }
  return out;
}

/**
 * One JSON object per line, so `jq 'select(.event=="knock_denied")'` works on
 * a running relay. The relay has no other observability; without this, a
 * rejected knock or a silent auth failure leaves no trace at all.
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const sink = options.sink ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = options.now ?? Date.now;

  const write = (level: LogLevel, event: string, fields: LogFields = {}) => {
    const line = JSON.stringify({
      ts: new Date(now()).toISOString(),
      level,
      event,
      ...safeFields(fields),
    });
    sink(line);
  };

  return {
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields),
  };
}

export const logger = createLogger();