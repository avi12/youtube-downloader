import { z } from "@/lib/zod";

/**
 * A type guard from a schema. Page objects (components, controllers, windows) are validated in place and used as
 * they are, since a parsed copy would lose their identity and their methods' `this`
 */
export function createGuard<Schema extends z.ZodType>(schema: Schema) {
  return (value: unknown): value is z.infer<Schema> => schema.safeParse(value).success;
}

/**
 * An optional field that never fails the object around it: a value YouTube shapes differently is typed by the schema
 * but let through untouched, so one odd branch can't reject a whole response. Only for guards, never `.parse`
 */
export function tolerated<Schema extends z.ZodType>(schema: Schema) {
  return schema.optional().catch(undefined);
}

/** A required array whose items are typed by the schema but not checked, so one odd item can't reject the rest */
export function uncheckedArray<Schema extends z.ZodType>(_itemSchema: Schema) {
  return z.custom<z.infer<Schema>[]>(Array.isArray);
}

/**
 * A guard whose schema is built on first use. For classes that exist only in a browser (`Element`, `CSSStyleRule`): a
 * schema built at import time would throw when WXT imports the entrypoints in Node to read their options
 */
export function createLazyGuard<Schema extends z.ZodType>(getSchema: () => Schema) {
  return (value: unknown): value is z.infer<Schema> => getSchema().safeParse(value).success;
}
