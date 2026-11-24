// Closed sets of values the dev tooling shares across its modules

export const FileExtension = {
  Svelte: ".svelte",
  SvelteTs: ".svelte.ts",
  SvelteJs: ".svelte.js",
  Ts: ".ts",
  Js: ".js",
  Css: ".css",
  Html: ".html"
} as const;

// The browser target names WXT and Vite take
export const BuildBrowser = {
  Chrome: "chrome",
  Firefox: "firefox"
} as const;
export type BuildBrowser = (typeof BuildBrowser)[keyof typeof BuildBrowser];

export const OsPlatform = {
  Windows: "win32",
  Linux: "linux",
  MacOs: "darwin"
} as const;

// Rolldown output entries
export const OutputChunkType = {
  Chunk: "chunk",
  Asset: "asset"
} as const;

export const LOOPBACK_HOST = "127.0.0.1";
