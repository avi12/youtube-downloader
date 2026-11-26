import { z } from "@/lib/zod";
import { createGuard } from "@/lib/zod-guard";

export const isString = createGuard(z.string());
export const isFunction = createGuard(z.function());
