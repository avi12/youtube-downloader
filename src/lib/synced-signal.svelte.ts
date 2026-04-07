/**
 * Cross-world reactive signals using window.postMessage.
 *
 * Both MAIN and isolated content script worlds share window.postMessage,
 * making it the only reliable cross-world communication channel.
 * Each signal wraps a Svelte 5 $state and syncs writes via postMessage.
 *
 * Works on Chrome MV3 and Firefox MV3 (128+).
 */

import { SvelteMap, SvelteSet } from "svelte/reactivity";

export const SYNC_NAMESPACE = "ytdl-sync";

/** Keys for cross-world postMessage signals (ytdl-sync namespace). */
export enum SyncKey {
  CreateDropdown = "create-dropdown",
  CloseDropdown = "close-dropdown",
  DropdownReady = "dropdown-ready",
  CancelDownload = "cancel-download",
  CancelRequest = "cancel-request",
  DownloadRequest = "download-request",
  DirectDownloadRequest = "direct-download-request",
  DownloadProgress = "download-progress",
  VideoDataRequest = "video-data-request",
  StreamData = "stream-data",
  SetButtonData = "set-button-data",
  ButtonClick = "button-click",
  ProxyFetchRequest = "proxy-fetch-request",
  ProxyFetchResponse = "proxy-fetch-response"
}

// ─── Transport layer ─────────────────────────────────────────────────────────

// Callbacks receive deserialized postMessage data - uses `any` because
// the generic type parameter isn't available at the transport layer
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SyncCallback = (value: any) => void;

const listeners = new SvelteMap<string, Set<SyncCallback>>();

addEventListener("message", e => {
  if (e.data?.namespace !== SYNC_NAMESPACE) {
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
  // JSON round-trip strips non-cloneable properties (Polymer objects,
  // functions, circular references) that would cause postMessage to throw
  const serializableValue = JSON.parse(JSON.stringify(value));
  postMessage({
    namespace: SYNC_NAMESPACE,
    key,
    value: serializableValue
  }, location.origin);
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
  const entries = new SvelteMap<string, T>();
  const suppressed = new SvelteSet<string>();
  let isSyncing = false;

  subscribe(keyPrefix, incoming => {
    // Ignore stale progress updates for cancelled downloads
    if (suppressed.has(incoming.mapKey)) {
      return;
    }

    isSyncing = true;
    entries.set(incoming.mapKey, incoming.mapValue);
    isSyncing = false;
  });

  return {
    get(mapKey: string) {
      return entries.get(mapKey);
    },
    set(mapKey: string, value: T) {
      if (suppressed.has(mapKey)) {
        return;
      }

      entries.set(mapKey, value);

      if (!isSyncing) {
        broadcast(keyPrefix, {
          mapKey,
          mapValue: value
        });
      }
    },
    has(mapKey: string) {
      return entries.has(mapKey);
    },
    /** Marks a key as suppressed - all set/sync updates are ignored until unsuppress. */
    delete(mapKey: string) {
      suppressed.add(mapKey);
      entries.delete(mapKey);

      if (!isSyncing) {
        broadcast(keyPrefix, {
          mapKey,
          mapValue: undefined
        });
      }
    },
    /** Clears suppression so set/sync updates are accepted again. */
    unsuppress(mapKey: string) {
      suppressed.delete(mapKey);
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
