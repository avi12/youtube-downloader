// Loads the HMR runtime and then the built popup entry. The dev server fills the three literals.
const ENTRY = "@@ENTRY@@";
const RUNTIME_PATH = "@@RUNTIME_PATH@@";
const POPUP_PATH = "@@POPUP_PATH@@";

globalThis.ytdlDevHmrEntry = ENTRY;
await import(RUNTIME_PATH);
await import(POPUP_PATH);
