type Primitive = null | undefined | string | number | boolean | symbol | bigint;
type NonRecursiveType =
  | Primitive
  | void
  | Date
  | RegExp
  | ((...args: never) => unknown)
  | (new (...args: never) => unknown)
  | Promise<unknown>;
type SkipPrettify =
  | NonRecursiveType
  | ArrayBuffer
  | ArrayBufferView
  | Blob
  | File
  | EventTarget;

export type Prettify<T> = T extends SkipPrettify
  ? T
  : T extends Map<infer K, infer V>
    ? Map<Prettify<K>, Prettify<V>>
    : T extends ReadonlyMap<infer K, infer V>
      ? ReadonlyMap<Prettify<K>, Prettify<V>>
      : T extends WeakMap<infer K extends WeakKey, infer V>
        ? WeakMap<K, Prettify<V>>
        : T extends Set<infer U>
          ? Set<Prettify<U>>
          : T extends ReadonlySet<infer U>
            ? ReadonlySet<Prettify<U>>
            : T extends WeakSet<infer U extends WeakKey>
              ? WeakSet<U>
              : T extends object
                ? { [K in keyof T]: Prettify<T[K]> }
                : T;
