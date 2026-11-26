import { svelte } from "lint-config/eslint/svelte";

export default svelte({ ignores: ["build/", ".output/", ".wxt/", ".verify-output/", "User Data/", "user-profiles/", "patches/", "scripts/", "tools/assets/browsers/", "tools/assets/payload/", "src/layers/processing/entrypoints/mux-worker/opfs.d.ts", ".claude/worktrees/"] });
