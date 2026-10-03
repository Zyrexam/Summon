import type {
  HistoryMessage,
  Queryable,
  SessionId,
  UserId,
} from "@summon/core";
import type { Logger } from "./logger";

/** How many ciphertext messages are kept per session for reload replay. */
export const HISTORY_LIMIT = 500;

export type PersistedMember = {
  id: UserId;
  name: string;
  host: boolean;
};

export type PersistedSession = {
  id: SessionId;
  hostId: UserId;
  members: PersistedMember[];
};

/**
 * Sessions and chat ciphertext in Postgres. Only (iv, enc) is stored: the
 * database can replay history to a rejoining socket but can never read it.
 * Every method is safe to call when the database is down — the caller
 * fire-and-forgets writes and logs the failure, so chat never blocks on it.
 */
export class SessionPersistence {
  constructor(
    private readonly db: Queryable,
    private readonly logger?: Logger,
  ) {}

  private fail(op: string, cause: unknown): void {
    this.logger?.warn("persist_failed", {
      op,
      reason: cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause),
    });
  }

  async saveSession(id: SessionId, hostId: UserId, hostName: string): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO sessions (id, host_id, status)
         VALUES ($1, $2, 'live')
         ON CONFLICT (id) DO UPDATE SET status = 'live', ended_at = NULL`,
        [id, hostId],
      );
      await this.saveMember(id, hostId, hostName, true);
    } catch (cause) {
      this.fail("save-session", cause);
    }
  }

  async saveMember(
    sessionId: SessionId,
    userId: UserId,
    name: string,
    host: boolean,
  ): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO session_members (session_id, user_id, name, host)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (session_id, user_id)
         DO UPDATE SET name = EXCLUDED.name, host = EXCLUDED.host`,
        [sessionId, userId, name, host],
      );
    } catch (cause) {
      this.fail("save-member", cause);
    }
  }

  async saveMessage(
    sessionId: SessionId,
    msg: {
      msgId: string;
      senderId: UserId;
      senderName: string;
      iv: string;
      enc: string;
      kind: "human" | "ai";
    },
  ): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO messages (session_id, msg_id, sender_id, sender_name, iv, enc, kind)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (session_id, msg_id) DO NOTHING`,
        [sessionId, msg.msgId, msg.senderId, msg.senderName, msg.iv, msg.enc, msg.kind],
      );
      await this.db.query(
        `DELETE FROM messages
         WHERE session_id = $1 AND msg_id NOT IN (
           SELECT msg_id FROM messages
           WHERE session_id = $1
           ORDER BY created_at DESC
           LIMIT ${HISTORY_LIMIT}
         )`,
        [sessionId],
      );
    } catch (cause) {
      this.fail("save-message", cause);
    }
  }

  async endSession(id: SessionId): Promise<void> {
    try {
      await this.db.query(
        `UPDATE sessions SET status = 'ended', ended_at = now() WHERE id = $1`,
        [id],
      );
    } catch (cause) {
      this.fail("end-session", cause);
    }
  }

  /**
   * Recent ciphertext for one session, oldest first. Served to a rejoining
   * member so a reload replays what was missed.
   */
  async historyFor(sessionId: SessionId): Promise<HistoryMessage[]> {
    try {
      const msgs = await this.db.query<{
        msg_id: string;
        sender_id: string;
        sender_name: string;
        iv: string;
        enc: string;
        kind: string;
        created_at: Date;
      }>(
        `SELECT msg_id, sender_id, sender_name, iv, enc, kind, created_at
         FROM messages WHERE session_id = $1
         ORDER BY created_at ASC
         LIMIT ${HISTORY_LIMIT}`,
        [sessionId],
      );
      return msgs.rows.map((m) => ({
        msgId: m.msg_id,
        iv: m.iv,
        enc: m.enc,
        from: m.sender_id,
        fromName: m.sender_name,
        kind: m.kind === "ai" ? ("ai" as const) : ("human" as const),
        at: new Date(m.created_at).toISOString(),
      }));
    } catch (cause) {
      this.fail("history-for", cause);
      return [];
    }
  }

  /**
   * Live sessions with members and recent ciphertext, oldest first.
   * Returns empty on any failure: the relay boots memory-only instead of
   * refusing to serve chat and video.
   */
  async loadLive(): Promise<{
    sessions: PersistedSession[];
    messages: Map<SessionId, HistoryMessage[]>;
  }> {
    const empty = { sessions: [], messages: new Map<SessionId, HistoryMessage[]>() };
    try {
      const sessions = await this.db.query<{ id: string; host_id: string }>(
        `SELECT id, host_id FROM sessions WHERE status = 'live'`,
      );
      if (sessions.rows.length === 0) return empty;
      const ids = sessions.rows.map((s) => s.id);
      const members = await this.db.query<{
        session_id: string;
        user_id: string;
        name: string;
        host: boolean;
      }>(
        `SELECT session_id, user_id, name, host FROM session_members
         WHERE session_id = ANY($1)`,
        [ids],
      );
      // Neon HTTP driver takes arrays as a single parameter for ANY($1).
      const msgs = await this.db.query<{
        session_id: string;
        msg_id: string;
        sender_id: string;
        sender_name: string;
        iv: string;
        enc: string;
        kind: string;
        created_at: Date;
      }>(
        `SELECT session_id, msg_id, sender_id, sender_name, iv, enc, kind, created_at
         FROM messages WHERE session_id = ANY($1)
         ORDER BY created_at ASC`,
        [ids],
      );
      const bySession = new Map<string, PersistedMember[]>();
      for (const m of members.rows) {
        const list = bySession.get(m.session_id) ?? [];
        list.push({ id: m.user_id, name: m.name, host: m.host });
        bySession.set(m.session_id, list);
      }
      const messages = new Map<SessionId, HistoryMessage[]>();
      for (const m of msgs.rows) {
        const list = messages.get(m.session_id) ?? [];
        list.push({
          msgId: m.msg_id,
          iv: m.iv,
          enc: m.enc,
          from: m.sender_id,
          fromName: m.sender_name,
          kind: m.kind === "ai" ? "ai" : "human",
          at: new Date(m.created_at).toISOString(),
        });
        messages.set(m.session_id, list);
      }
      return {
        sessions: sessions.rows.map((s) => ({
          id: s.id,
          hostId: s.host_id,
          members: bySession.get(s.id) ?? [],
        })),
        messages,
      };
    } catch (cause) {
      this.fail("load-live", cause);
      return empty;
    }
  }
}
