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
  : T extends Map<infer Key, infer Value>
    ? Map<Prettify<Key>, Prettify<Value>>
    : T extends ReadonlyMap<infer Key, infer Value>
      ? ReadonlyMap<Prettify<Key>, Prettify<Value>>
      : T extends WeakMap<infer Key extends WeakKey, infer Value>
        ? WeakMap<Key, Prettify<Value>>
        : T extends Set<infer Element>
          ? Set<Prettify<Element>>
          : T extends ReadonlySet<infer Element>
            ? ReadonlySet<Prettify<Element>>
            : T extends WeakSet<infer Element extends WeakKey>
              ? WeakSet<Element>
              : T extends object
                ? { [Key in keyof T]: Prettify<T[Key]> }
                : T;
