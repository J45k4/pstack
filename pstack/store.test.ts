import { expect, test } from "bun:test";
import { Store, createStore } from "./store";

type AppState = {
  screen: "home" | "settings";
  count: number;
  nested: {
    open: boolean;
  };
};

const initialState: AppState = {
  screen: "home",
  count: 0,
  nested: {
    open: false,
  },
};

function memoryStorage() {
  const values = new Map<string, string>();

  return {
    values,
    storage: {
      async getItem(key: string) {
        return values.get(key) ?? null;
      },
      async setItem(key: string, value: string) {
        values.set(key, value);
      },
      async removeItem(key: string) {
        values.delete(key);
      },
    },
  };
}

test("Store updates state and notifies listeners", () => {
  const store = createStore(initialState);
  let calls = 0;

  const unsubscribe = store.subscribe(() => {
    calls += 1;
  });

  store.set({ screen: "settings" });

  expect(store.get().screen).toBe("settings");
  expect(calls).toBe(1);

  unsubscribe();
  store.set({ screen: "home" });

  expect(calls).toBe(1);
});

test("Store supports draft-style updates", () => {
  const store = new Store(initialState);

  store.set(draft => {
    draft.count += 1;
    draft.nested.open = true;
  });

  expect(store.get()).toMatchObject({
    count: 1,
    nested: {
      open: true,
    },
  });
});

test("Store onChange only fires when selected value changes", () => {
  const store = new Store(initialState);
  const seen: number[] = [];

  store.onChange(
    state => state.count,
    count => seen.push(count),
  );

  store.set({ screen: "settings" });
  store.set({ count: 1 });
  store.set({ count: 1 });
  store.set({ count: 2 });

  expect(seen).toEqual([1, 2]);
});

test("Store persists selected keys", async () => {
  const { storage, values } = memoryStorage();
  const store = new Store(initialState, {
    persistence: {
      key: "app.store",
      storage,
      keys: ["screen"],
      debounceMs: 0,
    },
  });

  await store.activatePersistence();
  store.set({ screen: "settings", count: 10 });

  await new Promise(resolve => setTimeout(resolve, 1));

  const raw = values.get("app.store");

  expect(raw).toBeTruthy();
  expect(JSON.parse(raw!).data).toEqual({
    screen: "settings",
  });
});

test("Store loads saved snapshots", async () => {
  const { storage } = memoryStorage();
  const savedAt = Date.now();

  await storage.setItem(
    "app.store",
    JSON.stringify({
      version: 1,
      savedAt,
      data: {
        screen: "settings",
      },
    }),
  );

  const store = new Store(initialState, {
    persistence: {
      key: "app.store",
      storage,
    },
  });
  const snapshot = await store.loadSnapshot();

  expect(snapshot?.savedAt.getTime()).toBe(savedAt);
  expect(snapshot?.snapshot).toEqual({
    screen: "settings",
  });
});
