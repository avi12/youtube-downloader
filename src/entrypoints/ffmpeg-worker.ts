import type { FFmpegCoreModule } from "@ffmpeg/types";
import { loadFFmpegCore } from "@/lib/ffmpeg-core";

const CHUNK_SIZE = 10 * 1024 * 1024;
const FFMPEG_STDERR = "stderr";

export type WorkerInput = { name: string; url: string; contentLength?: number };
export type WorkerRequest = { wasmUrl: string; inputs: WorkerInput[]; args: string[] };
export type WorkerMessage =
  | { type: "log"; text: string }
  | { type: "progress"; name: string; ratio: number }
  | { type: "done"; code: number; files: { name: string; data: ArrayBuffer }[] }
  | { type: "error"; message: string };

const post = (message: WorkerMessage, transfer: Transferable[] = []) => postMessage(message, { transfer });

async function fetchRange(url: string, start: number, end: number) {
  const response = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

async function writeWholeInput(core: FFmpegCoreModule, { name, url }: WorkerInput) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download of ${name} failed: HTTP ${response.status}`);
  }

  core.FS.writeFile(name, new Uint8Array(await response.arrayBuffer()));
}

async function writeChunkedInput(core: FFmpegCoreModule, { name, url }: WorkerInput, contentLength: number) {
  const stream = core.FS.open(name, "w");
  for (let start = 0; start < contentLength; start += CHUNK_SIZE) {
    const chunk = await fetchRange(url, start, Math.min(start + CHUNK_SIZE, contentLength) - 1);
    core.FS.write(stream, chunk, 0, chunk.byteLength);
    post({ type: "progress", name, ratio: Math.min((start + chunk.byteLength) / contentLength, 1) });
  }

  core.FS.close(stream);
}

async function writeInput(core: FFmpegCoreModule, input: WorkerInput) {
  if (!input.contentLength) {
    await writeWholeInput(core, input);
    return;
  }

  await writeChunkedInput(core, input, input.contentLength);
}

function collectOutputs(core: FFmpegCoreModule, ignoredNames: Set<string>) {
  const names = core.FS.readdir("/").filter(name => !ignoredNames.has(name) && core.FS.isFile(core.FS.stat(name).mode));
  return names.map(name => ({ name, data: (core.FS.readFile(name, { encoding: "binary" }) as Uint8Array<ArrayBuffer>).slice().buffer }));
}

async function run({ wasmUrl, inputs, args }: WorkerRequest) {
  const core = await loadFFmpegCore(wasmUrl);
  core.setLogger(({ type, message }) => type === FFMPEG_STDERR && post({ type: "log", text: message }));

  const ignoredNames = new Set([...core.FS.readdir("/"), ...inputs.map(input => input.name)]);
  for (const input of inputs) {
    await writeInput(core, input);
  }

  const code = core.exec(...args);
  const files = collectOutputs(core, ignoredNames);
  post({ type: "done", code, files }, files.map(file => file.data));
}

export default defineUnlistedScript(() => {
  addEventListener("message", (e: MessageEvent<WorkerRequest>) => {
    run(e.data).catch((error: unknown) => {
      post({ type: "error", message: error instanceof Error ? error.message : String(error) });
    });
  });
});
