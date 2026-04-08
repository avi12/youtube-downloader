/**
 * Cross-world reactive signals using defineCustomEventMessaging.
 *
 * Both MAIN and isolated content script worlds share window's custom events,
 * making defineCustomEventMessaging the reliable cross-world communication channel.
 * Each signal wraps a Svelte 5 $state and syncs writes via custom events.
 *
 * Works on Chrome MV3 and Firefox MV3 (128+).
 */

import { defineCustomEventMessaging } from "@webext-core/messaging/page";
import { SvelteMap, SvelteSet } from "svelte/reactivity";

const SYNC_NAMESPACE = "ytdl-sync";

// ─── Single-value signal ─────────────────────────────────────────────────────

type SignalSchema<T> = { value: (data: T) => void };
type SignalMessenger<T> = ReturnType<typeof defineCustomEventMessaging<SignalSchema<T>>>;

export function createSignalMessenger<T>(key: string) {
  return defineCustomEventMessaging<SignalSchema<T>>({
    namespace: `${SYNC_NAMESPACE}-${key}`
  });
}

export function createSyncedSignal<T>(messenger: SignalMessenger<T>, initial: NoInfer<T>) {
  let current = $state(initial);
  let isSyncing = false;

  messenger.onMessage("value", ({ data }) => {
    isSyncing = true;
    current = data;
    isSyncing = false;
  });

  return {
    get value() {
      return current;
    },
    set value(newValue: T) {
      current = newValue;

      if (!isSyncing) {
        void messenger.sendMessage("value", newValue);
      }
    }
  };
}

// ─── Map-based signal ────────────────────────────────────────────────────────

type MapEntryPayload<T> = {
  mapKey: string;
  mapValue: T | undefined;
};
type MapSchema<T> = { entry: (data: MapEntryPayload<T>) => void };
type MapMessenger<T> = ReturnType<typeof defineCustomEventMessaging<MapSchema<T>>>;

export function createMapMessenger<T>(key: string): MapMessenger<T> {
  return defineCustomEventMessaging<MapSchema<T>>({
    namespace: `${SYNC_NAMESPACE}-${key}`
  });
}

export function createSyncedMap<T>(messenger: MapMessenger<T>) {
  const map = new SvelteMap<string, T>();
  const suppressed = new SvelteSet<string>();
  let isSyncing = false;

  messenger.onMessage("entry", ({ data: { mapKey, mapValue } }) => {
    if (suppressed.has(mapKey)) {
      return;
    }

    isSyncing = true;

    if (mapValue === undefined) {
      map.delete(mapKey);
    } else {
      map.set(mapKey, mapValue);
    }

    isSyncing = false;
  });

  return {
    get(key: string) {
      return map.get(key);
    },
    keys() {
      return map.keys();
    },
    set(mapKey: string, value: T) {
      if (suppressed.has(mapKey)) {
        return;
      }

      map.set(mapKey, value);

      if (!isSyncing) {
        void messenger.sendMessage("entry", { mapKey, mapValue: value });
      }
    },
    /** Marks a key as suppressed - all set/sync updates are ignored until unsuppress. */
    delete(mapKey: string) {
      suppressed.add(mapKey);
      map.delete(mapKey);

      if (!isSyncing) {
        void messenger.sendMessage("entry", { mapKey, mapValue: undefined });
      }
    },
    /** Clears suppression so set/sync updates are accepted again. */
    unsuppress(mapKey: string) {
      suppressed.delete(mapKey);
    }
  };
}
