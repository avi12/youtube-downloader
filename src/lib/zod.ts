import { z } from "zod";

// YouTube enforces Trusted Types (require-trusted-types-for 'script'), which blocks the
// `new Function` capability probe Zod runs the first time an object schema is built. Zod
// swallows the throw and falls back, but Chrome still records the CSP violation as a
// console error. Running jitless skips the probe entirely, so import `z` from here.
z.config({ jitless: true });

export { z };
