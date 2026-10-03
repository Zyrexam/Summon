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