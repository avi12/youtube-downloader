import { defineCustomEventMessaging } from "@webext-core/messaging/page";

const SYNC_NAMESPACE = "ytdl-sync";

export type SignalSchema<T> = {
  value: (data: T) => void;
};
export type SignalMessenger<T> = ReturnType<typeof defineCustomEventMessaging<SignalSchema<T>>>;

export type MapEntryPayload<T> = {
  mapKey: string;
  mapValue: T | undefined;
};
export type MapSchema<T> = {
  entry: (data: MapEntryPayload<T>) => void;
};
export type MapMessenger<T> = ReturnType<typeof defineCustomEventMessaging<MapSchema<T>>>;

export function createSignalMessenger<T>(key: string) {
  return defineCustomEventMessaging<SignalSchema<T>>({
    namespace: `${SYNC_NAMESPACE}-${key}`
  });
}

export function createMapMessenger<T>(key: string) {
  return defineCustomEventMessaging<MapSchema<T>>({
    namespace: `${SYNC_NAMESPACE}-${key}`
  });
}
