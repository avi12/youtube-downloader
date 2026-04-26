// One-shot decoder. Reads scripts/captured-template.json (the format the
// SABR replay harness uses) and pretty-prints all VideoPlaybackAbrRequest
// fields so we can compare a live captured template against
// buildSyntheticTemplateFromPlayer output.
//
// Usage:
//   1. Capture a live template per scripts/sabr-replay-harness.ts header.
//   2. bun scripts/decode-template.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { VideoPlaybackAbrRequest } from "googlevideo/protos";

interface CapturedTemplate {
  url: string;
  bodyBase64: string;
  capturedAt: number;
}

function summarize(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return `<Uint8Array len=${value.byteLength} b64Head=${Buffer.from(value).toString("base64").slice(0, 40)}>`;
  }

  if (Array.isArray(value)) {
    return value.map(summarize);
  }

  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = summarize(val);
    }

    return out;
  }

  return value;
}

const path = resolve("scripts/captured-template.json");
const captured: CapturedTemplate = JSON.parse(readFileSync(path, "utf8"));
const decoded = VideoPlaybackAbrRequest.decode(new Uint8Array(Buffer.from(captured.bodyBase64, "base64")));
console.log(JSON.stringify(summarize(decoded), null, 2));
