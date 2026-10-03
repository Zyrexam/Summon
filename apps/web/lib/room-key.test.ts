import { describe, expect, test, vi } from "vitest";
import { createRoomKeyStore } from "./room-key";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    load: (id: string) => map.get(id) ?? null,
    save: (id: string, key: string) => {
      map.set(id, key);
    },
  };
}

describe("createRoomKeyStore", () => {
  test("generates once and reuses the same key while the session is live", async () => {
    const storage = memoryStorage();
    const generate = vi.fn(async () => "k1");
    const store = createRoomKeyStore({ ...storage, generate });

    expect(await store.ensure("s1")).toBe("k1");
    expect(await store.ensure("s1")).toBe("k1");
    expect(generate).toHaveBeenCalledTimes(1);
  });

  test("a reload reuses the persisted key instead of orphaning members", async () => {
    const storage = memoryStorage();
    const generate = vi.fn(async () => "k1");
    const first = createRoomKeyStore({ ...storage, generate });
    await first.ensure("s1");

    const reloaded = createRoomKeyStore({ ...storage, generate });
    expect(await reloaded.ensure("s1")).toBe("k1");
    expect(generate).toHaveBeenCalledTimes(1);
  });

  test("keys are per session and seeded keys are never regenerated", async () => {
    const storage = memoryStorage();
    const generate = vi.fn(async () => "generated");
    const store = createRoomKeyStore({ ...storage, generate });

    store.seed("s1", "k1");
    expect(await store.ensure("s1")).toBe("k1");
    expect(await store.ensure("s2")).toBe("generated");
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
describe("room key storage", () => {
  test("is shared across tabs, not per tab", async () => {
    const shared = new Map<string, string>();
    const perTab = new Map<string, string>();
    const make = (map: Map<string, string>) => ({
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    });
    (globalThis as Record<string, unknown>).window = {
      localStorage: make(shared),
      // sessionStorage is per tab in a real browser: this stands in for it.
      sessionStorage: make(perTab),
    };

    const { loadRoomKey, saveRoomKey } = await import("./session");
    saveRoomKey("s1", "k1");

    // The key must land in storage a second tab can see, or reopening the host
    // in a new tab mints a fresh key and orphans everyone already admitted.
    expect(shared.get("summon.roomKey.s1")).toBe("k1");
    expect(perTab.size).toBe(0);
    expect(loadRoomKey("s1")).toBe("k1");
    expect(loadRoomKey("s2")).toBeNull();

    delete (globalThis as Record<string, unknown>).window;
  });
});
