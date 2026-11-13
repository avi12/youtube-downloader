import { svelte } from "eslint-config-avi12/svelte";

export default svelte({ ignores: ["build/", ".output/", ".wxt/", ".verify-output/", "User Data/", "user-profiles/", "patches/", "scripts/", "src/layers/processing/entrypoints/mux-worker/opfs.d.ts", ".claude/worktrees/"] });
