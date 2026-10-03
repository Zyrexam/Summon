export type RoomKeyDeps = {
  load: (sessionId: string) => string | null;
  save: (sessionId: string, key: string) => void;
  generate: () => Promise<string>;
};

export type RoomKeyStore = {
  get: (sessionId: string) => string | null;
  /** Remembers a key handed over by the host; never regenerated afterwards. */
  seed: (sessionId: string, key: string) => void;
  ensure: (sessionId: string) => Promise<string>;
};

/**
 * A room key is generated at most once per session for the lifetime of the tab.
 * Regenerating after a reload would orphan every admitted member (P1-2), so the
 * persisted copy wins over a fresh key whenever one exists.
 */
export function createRoomKeyStore(deps: RoomKeyDeps): RoomKeyStore {
  const keys = new Map<string, string>();
  return {
    get: (sessionId) => keys.get(sessionId) ?? deps.load(sessionId),
    seed: (sessionId, key) => {
      keys.set(sessionId, key);
      deps.save(sessionId, key);
    },
    ensure: async (sessionId) => {
      const existing = keys.get(sessionId) ?? deps.load(sessionId);
      if (existing) {
        keys.set(sessionId, existing);
        return existing;
      }
      const generated = await deps.generate();
      keys.set(sessionId, generated);
      deps.save(sessionId, generated);
      return generated;
    },
  };
}