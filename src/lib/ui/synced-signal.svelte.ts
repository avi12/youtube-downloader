import type { MapMessenger, SignalMessenger } from "./synced-signal-types";
import { SvelteMap, SvelteSet } from "svelte/reactivity";

export {
  createMapMessenger,
  createSignalMessenger
} from "./synced-signal-types";

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
        void messenger.sendMessage("entry", {
          mapKey,
          mapValue: value
        });
      }
    },
    setLocal(mapKey: string, value: T) {
      if (suppressed.has(mapKey)) {
        return;
      }

      map.set(mapKey, value);
    },
    deleteLocal(mapKey: string) {
      map.delete(mapKey);
    },
    delete(mapKey: string) {
      suppressed.add(mapKey);
      map.delete(mapKey);

      if (!isSyncing) {
        void messenger.sendMessage("entry", {
          mapKey,
          mapValue: undefined
        });
      }
    },
    unsuppress(mapKey: string) {
      suppressed.delete(mapKey);
    }
  };
}
