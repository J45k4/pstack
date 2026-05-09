import { useCallback, useRef, useSyncExternalStore } from "react";

export type StoreListener = () => void;
export type StoreSelector<State, Selected> = (state: State) => Selected;
export type StoreEquality<Selected> = (left: Selected, right: Selected) => boolean;
export type StoreUpdater<State> =
  | Partial<State>
  | ((draft: State) => void | State | Partial<State>);

export type StoreSnapshot<State> = Partial<State>;

export type LoadedStoreSnapshot<State> = {
  savedAt: Date;
  snapshot: StoreSnapshot<State>;
};

export type StoreStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export type StorePersistence<State> = {
  key: string;
  storage: StoreStorage;
  version?: number;
  keys?: readonly (keyof State)[];
  debounceMs?: number;
};

export type StoreOptions<State> = {
  persistence?: StorePersistence<State>;
};

export const shallowEqual = <T>(left: T, right: T) =>
  Object.is(left, right) ||
  (typeof left === "object" &&
    left !== null &&
    typeof right === "object" &&
    right !== null &&
    Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every(key =>
      Object.is(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
      ),
    ));

function cloneState<State>(state: State): State {
  if (typeof structuredClone === "function") {
    return structuredClone(state);
  }

  if (Array.isArray(state)) {
    return [...state] as State;
  }

  if (state && typeof state === "object") {
    return { ...state };
  }

  return state;
}

function pick<State extends object>(
  source: State,
  keys: readonly (keyof State)[] | undefined,
) {
  if (!keys) {
    return source;
  }

  const picked: Partial<State> = {};

  for (const key of keys) {
    const value = source[key];

    if (value !== undefined) {
      picked[key] = value;
    }
  }

  return picked;
}

export class Store<State extends object> {
  private state: State;
  private readonly initialState: State;
  private readonly listeners = new Set<StoreListener>();
  private readonly persistence: StorePersistence<State> | undefined;
  private persistSubscribed = false;
  private lastPersistedJson = "";
  private writeTimer: Timer | undefined;
  private writeInFlight = false;
  private writeDirty = false;

  constructor(schema: State, options: StoreOptions<State> = {}) {
    this.initialState = cloneState(schema);
    this.state = cloneState(schema);
    this.persistence = options.persistence;
  }

  get<T = State>() {
    return this.state as unknown as T;
  }

  set(update: StoreUpdater<State>) {
    const next =
      typeof update === "function"
        ? this.applyUpdater(update)
        : {
            ...this.state,
            ...update,
          };

    if (Object.is(next, this.state)) {
      return;
    }

    this.state = next;
    this.emit();
  }

  clear() {
    this.state = cloneState(this.initialState);
    this.emit();
  }

  subscribe(listener: StoreListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onChange<Selected>(
    selector: StoreSelector<State, Selected>,
    callback: (selected: Selected) => void,
    equality: StoreEquality<Selected> = shallowEqual,
  ) {
    let lastValue = selector(this.state);

    return this.subscribe(() => {
      const nextValue = selector(this.state);

      if (equality(lastValue, nextValue)) {
        return;
      }

      lastValue = nextValue;
      callback(nextValue);
    });
  }

  use<Selected>(
    selector: StoreSelector<State, Selected>,
    equality: StoreEquality<Selected> = shallowEqual,
  ) {
    const getSnapshot = useCallback(() => selector(this.get()), [selector]);
    const lastValueRef = useRef(getSnapshot());

    return useSyncExternalStore(
      this.subscribe.bind(this),
      () => {
        const next = getSnapshot();

        if (!equality(lastValueRef.current, next)) {
          lastValueRef.current = next;
        }

        return lastValueRef.current;
      },
      getSnapshot,
    );
  }

  async loadSnapshot(): Promise<LoadedStoreSnapshot<State> | null> {
    if (!this.persistence) {
      return null;
    }

    const raw = await this.persistence.storage.getItem(this.persistence.key);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as {
      version?: number;
      savedAt?: number;
      data?: StoreSnapshot<State>;
    };

    this.lastPersistedJson = raw;

    return {
      savedAt: new Date(parsed.savedAt ?? Date.now()),
      snapshot: parsed.data ?? {},
    };
  }

  async activateSnapshot(snapshot?: StoreSnapshot<State> | null) {
    if (snapshot) {
      this.set(snapshot);
    }

    this.attachPersistence();
  }

  async activatePersistence() {
    this.attachPersistence();
    await this.writeNow();
  }

  async clearPersisted() {
    if (!this.persistence) {
      return;
    }

    await this.persistence.storage.removeItem(this.persistence.key);
    this.lastPersistedJson = "";
  }

  async discard() {
    this.clear();
    await this.clearPersisted();
    this.attachPersistence();
  }

  private applyUpdater(update: (draft: State) => void | State | Partial<State>) {
    const draft = cloneState(this.state);
    const result = update(draft);

    if (result === undefined) {
      return draft;
    }

    if (result && typeof result === "object") {
      return {
        ...this.state,
        ...result,
      };
    }

    return result as State;
  }

  private emit() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private attachPersistence() {
    if (!this.persistence || this.persistSubscribed) {
      return;
    }

    this.persistSubscribed = true;
    this.subscribe(() => this.scheduleWrite());
  }

  private scheduleWrite() {
    const debounceMs = this.persistence?.debounceMs ?? 2_000;

    if (this.writeTimer) {
      return;
    }

    this.writeTimer = setTimeout(() => {
      this.writeTimer = undefined;
      void this.writeNow();
    }, debounceMs);
  }

  private async writeNow() {
    if (!this.persistence) {
      return;
    }

    if (this.writeInFlight) {
      this.writeDirty = true;
      return;
    }

    this.writeInFlight = true;

    try {
      const data = pick(this.state, this.persistence.keys);
      const json = JSON.stringify({
        version: this.persistence.version ?? 1,
        savedAt: Date.now(),
        data,
      });

      if (json !== this.lastPersistedJson) {
        await this.persistence.storage.setItem(this.persistence.key, json);
        this.lastPersistedJson = json;
      }
    } finally {
      this.writeInFlight = false;

      if (this.writeDirty) {
        this.writeDirty = false;
        this.scheduleWrite();
      }
    }
  }
}

export function createStore<State extends object>(
  schema: State,
  options?: StoreOptions<State>,
) {
  return new Store(schema, options);
}
