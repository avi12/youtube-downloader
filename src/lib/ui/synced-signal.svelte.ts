import { defineCustomEventMessaging } from "@webext-core/messaging/page";
import { SvelteMap, SvelteSet } from "svelte/reactivity";

const SYNC_NAMESPACE = "ytdl-sync";

type SignalSchema<T> = {
  value: (data: T) => void;
};
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

type MapEntryPayload<T> = {
  mapKey: string;
  mapValue: T | undefined;
};
type MapSchema<T> = {
  entry: (data: MapEntryPayload<T>) => void;
};
type MapMessenger<T> = ReturnType<typeof defineCustomEventMessaging<MapSchema<T>>>;

export function createMapMessenger<T>(key: string) {
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
