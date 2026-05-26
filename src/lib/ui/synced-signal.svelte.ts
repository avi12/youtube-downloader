import type { MapMessenger, SignalMessenger } from "./synced-signal-types";
import { SvelteMap, SvelteSet } from "svelte/reactivity";

export {
  createMapMessenger,
  createSignalMessenger
} from "./synced-signal-types";

export function createSyncedSignal<T>({ messenger, initial }: {
  messenger: SignalMessenger<T>;
  initial: NoInfer<T>;
}) {
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
    const isKeySuppressed = suppressed.has(mapKey);
    if (isKeySuppressed) {
      return;
    }

    isSyncing = true;

    const isDeleted = mapValue === undefined;
    if (isDeleted) {
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
      const isSetKeySuppressed = suppressed.has(mapKey);
      if (isSetKeySuppressed) {
        return false;
      }

      map.set(mapKey, value);

      if (!isSyncing) {
        void messenger.sendMessage("entry", {
          mapKey,
          mapValue: value
        });
      }

      return true;
    },
    setLocal(mapKey: string, value: T) {
      const isLocalKeySuppressed = suppressed.has(mapKey);
      if (isLocalKeySuppressed) {
        return false;
      }

      map.set(mapKey, value);
      return true;
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
