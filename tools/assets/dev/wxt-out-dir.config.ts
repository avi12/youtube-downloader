// A wrapper around wxt.config.ts that moves WXT's outDir, so a second dev server builds beside the first.
// WXT's CLI has no out-dir flag; the Rust launcher passes this file with `-c` and the two paths in env vars.
import { pathToFileURL } from "node:url";

const { YTDL_WXT_BASE_CONFIG, YTDL_WXT_OUT_DIR } = process.env;
const { default: baseConfig } = await import(pathToFileURL(YTDL_WXT_BASE_CONFIG ?? "").href);

export default typeof baseConfig === "function"
  ? async (...parameters: unknown[]) => ({
     ...(await baseConfig(...parameters)),
     outDir: YTDL_WXT_OUT_DIR 
  })
  : {
     ...baseConfig,
     outDir: YTDL_WXT_OUT_DIR 
  };
