/**
 * Cross-world reactive signals using window.postMessage.
 *
 * Both MAIN and isolated content script worlds share window.postMessage,
 * making it the only reliable cross-world communication channel.
 * Each signal wraps a Svelte 5 $state and syncs writes via postMessage.
 *
 * Works on Chrome MV3 and Firefox MV3 (128+).
 */

const NAMESPACE = "ytdl-sync";

// ─── Transport layer ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SyncCallback = (value: any) => void;

const listeners = new Map<string, Set<SyncCallback>>();

addEventListener("message", e => {
  if (e.data?.namespace !== NAMESPACE) {
    return;
  }

  const callbacks = listeners.get(e.data.key);
  if (!callbacks) {
    return;
  }

  for (const callback of callbacks) {
    callback(e.data.value);
  }
});

function broadcast(key: string, value: unknown) {
  postMessage({ namespace: NAMESPACE, key, value }, "*");
}

function subscribe(key: string, callback: SyncCallback) {
  if (!listeners.has(key)) {
    listeners.set(key, new Set());
  }

  listeners.get(key)!.add(callback);

  return () => {
    listeners.get(key)?.delete(callback);
  };
}

// ─── Single-value signal ─────────────────────────────────────────────────────

export function createSyncedSignal<T>(key: string, initial: T) {
  let current = $state(initial);
  let isSyncing = false;

  subscribe(key, incoming => {
    isSyncing = true;
    current = incoming;
    isSyncing = false;
  });

  return {
    get value() {
      return current;
    },
    set value(newValue: T) {
      current = newValue;

      if (!isSyncing) {
        broadcast(key, newValue);
      }
    }
  };
}

// ─── Map-based signal ────────────────────────────────────────────────────────

export function createSyncedMap<T>(keyPrefix: string) {
  const entries = $state(new Map<string, T>());
  let isSyncing = false;

  subscribe(keyPrefix, incoming => {
    isSyncing = true;
    entries.set(incoming.mapKey, incoming.mapValue);
    isSyncing = false;
  });

  return {
    get(mapKey: string) {
      return entries.get(mapKey);
    },
    set(mapKey: string, value: T) {
      entries.set(mapKey, value);

      if (!isSyncing) {
        broadcast(keyPrefix, { mapKey, mapValue: value });
      }
    },
    has(mapKey: string) {
      return entries.has(mapKey);
    },
    delete(mapKey: string) {
      entries.delete(mapKey);

      if (!isSyncing) {
        broadcast(keyPrefix, { mapKey, mapValue: undefined });
      }
    },
    get size() {
      return entries.size;
    },
    values() {
      return entries.values();
    },
    keys() {
      return entries.keys();
    }
  };
}
