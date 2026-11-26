import { z } from "@/lib/zod";

/**
 * A type guard from a schema. Page objects (components, controllers, windows) are validated in place and used as
 * they are, since a parsed copy would lose their identity and their methods' `this`
 */
export function createGuard<Schema extends z.ZodType>(schema: Schema) {
  return (value: unknown): value is z.infer<Schema> => schema.safeParse(value).success;
}

/**
 * A guard for a hand-written type YouTube owns. The schema checks only the fields the extension relies on, so real
 * data is never rejected over the rest
 */
export function createShapeGuard<Value>(schema: z.ZodType) {
  return (value: unknown): value is Value => schema.safeParse(value).success;
}

/** A page method called for its effect, with no arguments; zod checks only that it is a function */
export const VOID_METHOD_SCHEMA = z.function({
  input: [],
  output: z.void()
});

/**
 * A guard whose schema is built on first use. For classes that exist only in a browser (`Element`, `CSSStyleRule`): a
 * schema built at import time would throw when WXT imports the entrypoints in Node to read their options
 */
export function createLazyGuard<Schema extends z.ZodType>(getSchema: () => Schema) {
  return (value: unknown): value is z.infer<Schema> => getSchema().safeParse(value).success;
}
