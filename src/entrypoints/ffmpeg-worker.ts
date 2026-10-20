import { loadFFmpegCore } from "@/lib/ffmpeg-core";
import type { FFmpegCoreModule } from "@ffmpeg/types";

const CHUNK_SIZE = 10 * 1024 * 1024;
const FFMPEG_STDERR = "stderr";
const HTTP_PARTIAL_CONTENT = 206;

export type WorkerInput = {
  name: string;
  url?: string;
  text?: string;
  data?: ArrayBuffer;
  contentLength?: number;
};
export type WorkerRequest = {
  wasmUrl: string;
  inputs: WorkerInput[];
  args: string[];
};
export type WorkerMessage =
  | {
    type: "log";
    text: string;
  }
  | {
    type: "progress";
    name: string;
    ratio: number;
  }
  | {
    type: "done";
    code: number;
    files: {
      name: string;
      data: ArrayBuffer;
    }[];
  }
  | {
    type: "error";
    message: string;
  };

type PostRequest = {
  message: WorkerMessage;
  transfer?: Transferable[];
};
type RangeRequest = {
  url: string;
  start: number;
  end: number;
};
type CoreSource = {
  core: FFmpegCoreModule;
  name: string;
  url: string;
};
type ChunkedSource = CoreSource & { contentLength: number };
type CoreInput = {
  core: FFmpegCoreModule;
  input: WorkerInput;
};
type OutputCollection = {
  core: FFmpegCoreModule;
  ignoredNames: Set<string>;
};

function post({ message, transfer = [] }: PostRequest) {
  postMessage(message, { transfer });
}

async function fetchRange({ url, start, end }: RangeRequest) {
  const response = await fetch(url, {
    headers: {
      Range: `bytes=${start}-${end}`
    }
  });
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

async function probeContentLength(url: string) {
  const response = await fetch(url, {
    headers: {
      Range: "bytes=0-0"
    }
  });
  await response.body?.cancel();
  const total = Number(response.headers.get("Content-Range")?.split("/")[1]);
  return response.status === HTTP_PARTIAL_CONTENT && total ? total : undefined;
}

async function writeWholeInput({ core, name, url }: CoreSource) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download of ${name} failed: HTTP ${response.status}`);
  }

  core.FS.writeFile(name, new Uint8Array(await response.arrayBuffer()));
}

async function writeChunkedInput({ core, name, url, contentLength }: ChunkedSource) {
  const stream = core.FS.open(name, "w");
  for (let start = 0; start < contentLength; start += CHUNK_SIZE) {
    const chunk = await fetchRange({
      url,
      start,
      end: Math.min(start + CHUNK_SIZE, contentLength) - 1
    });
    core.FS.write(stream, chunk, 0, chunk.byteLength);
    post({
      message: {
        type: "progress",
        name,
        ratio: Math.min((start + chunk.byteLength) / contentLength, 1)
      }
    });
  }

  core.FS.close(stream);
}

async function writeInput({ core, input: { name, url, text, data, contentLength } }: CoreInput) {
  if (text !== undefined) {
    core.FS.writeFile(name, new TextEncoder().encode(text));
    return;
  }

  if (data) {
    core.FS.writeFile(name, new Uint8Array(data));
    return;
  }

  if (!url) {
    throw new Error(`Input ${name} has no source`);
  }

  const knownLength = contentLength ?? await probeContentLength(url);
  if (!knownLength) {
    await writeWholeInput({
      core,
      name,
      url
    });
    return;
  }

  await writeChunkedInput({
    core,
    name,
    url,
    contentLength: knownLength
  });
}

function collectOutputs({ core, ignoredNames }: OutputCollection) {
  const names = core.FS.readdir("/").filter(name => !ignoredNames.has(name) && core.FS.isFile(core.FS.stat(name).mode));
  return names.map(name => {
    const content = core.FS.readFile(name, { encoding: "binary" });
    const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return {
      name,
      data: copy.buffer
    };
  });
}

async function run({ wasmUrl, inputs, args }: WorkerRequest) {
  const core = await loadFFmpegCore(wasmUrl);
  core.setLogger(({ type, message }) => type === FFMPEG_STDERR && post({
    message: {
      type: "log",
      text: message
    }
  }));

  const ignoredNames = new Set([...core.FS.readdir("/"), ...inputs.map(input => input.name)]);
  for (const input of inputs) {
    await writeInput({
      core,
      input
    });
  }

  const code = core.exec(...args);
  const files = collectOutputs({
    core,
    ignoredNames
  });
  post({
    message: {
      type: "done",
      code,
      files
    },
    transfer: files.map(file => file.data)
  });
}

export default defineUnlistedScript(() => {
  addEventListener("message", (e: MessageEvent<WorkerRequest>) => {
    run(e.data).catch((error: unknown) => {
      post({
        message: {
          type: "error",
          message: error instanceof Error ? error.message : String(error)
        }
      });
    });
  });
});
