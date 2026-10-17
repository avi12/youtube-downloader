<script lang="ts">
  import { onMount } from "svelte";
  import type { WorkerMessage, WorkerRequest } from "../ffmpeg-worker";
  import {
    PLACEHOLDER_FILENAMES,
    PRESETS,
    Placeholder,
    substitutePlaceholders,
    tokenize,
    usedPlaceholders
  } from "@/lib/command";
  import { parseVideoId, registerRequestHeaderRules, resolveVideo } from "@/lib/youtube";
  import type { ResolvedVideo } from "@/lib/youtube";

  type Output = { name: string; url: string };

  let url = $state("");
  let command = $state(PRESETS[0]!.command);
  let isRunning = $state(false);
  let status = $state("");
  let errorMessage = $state("");
  let logText = $state("");
  let downloadRatio = $state(0);
  let outputs = $state<Output[]>([]);

  onMount(async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && parseVideoId(tab.url)) {
      url = tab.url;
    }
  });

  function buildInputs(resolved: ResolvedVideo, placeholders: Placeholder[]): WorkerRequest["inputs"] {
    const sources: Record<Placeholder, { url?: string; contentLength?: string } | undefined> = {
      [Placeholder.Video]: resolved.video,
      [Placeholder.Audio]: resolved.audio,
      [Placeholder.Captions]: resolved.captionsUrl ? { url: resolved.captionsUrl } : undefined
    };
    return placeholders.map(placeholder => {
      const source = sources[placeholder];
      if (!source?.url) {
        throw new Error(`This video has no stream for ${placeholder}`);
      }

      return {
        name: PLACEHOLDER_FILENAMES[placeholder],
        url: source.url,
        contentLength: Number(source.contentLength) || undefined
      };
    });
  }

  function handleWorkerMessage(message: WorkerMessage) {
    if (message.type === "log") {
      logText += `${message.text}\n`;
      return;
    }

    if (message.type === "progress") {
      downloadRatio = message.ratio;
      status = `Downloading ${message.name}`;
      return;
    }

    if (message.type === "error") {
      errorMessage = message.message;
      return;
    }

    outputs = message.files.map(({ name, data }) => ({ name, url: URL.createObjectURL(new Blob([data])) }));
    status = message.code === 0 ? "Done" : `FFmpeg exited with code ${message.code}`;
  }

  function runInWorker(request: WorkerRequest) {
    return new Promise<void>((resolve, reject) => {
      const worker = new Worker(browser.runtime.getURL("/ffmpeg-worker.js"), { type: "module" });
      worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
        handleWorkerMessage(e.data);
        const isFinished = e.data.type === "done" || e.data.type === "error";
        if (!isFinished) {
          return;
        }

        worker.terminate();
        resolve();
      };
      worker.onerror = e => {
        worker.terminate();
        reject(new Error(e.message));
      };
      worker.postMessage(request);
    });
  }

  async function run() {
    const videoId = parseVideoId(url);
    if (!videoId) {
      errorMessage = "That doesn't look like a YouTube URL";
      return;
    }

    isRunning = true;
    errorMessage = "";
    logText = "";
    outputs = [];
    downloadRatio = 0;
    status = "Looking up the video";
    try {
      await registerRequestHeaderRules();
      const resolved = await resolveVideo(videoId);
      const inputs = buildInputs(resolved, usedPlaceholders(command));
      await runInWorker({
        wasmUrl: browser.runtime.getURL("/ffmpeg/ffmpeg-core.wasm"),
        inputs,
        args: substitutePlaceholders(tokenize(command))
      });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    isRunning = false;
  }
</script>

<main>
  <label>
    YouTube URL
    <input type="url" bind:value={url} placeholder="https://www.youtube.com/watch?v=...">
  </label>

  <label>
    Preset
    <select onchange={e => (command = e.currentTarget.value)}>
      <option value="" selected disabled>Pick one to fill the command</option>
      {#each PRESETS as preset (preset.label)}
        <option value={preset.command}>{preset.label}</option>
      {/each}
    </select>
  </label>

  <label>
    FFmpeg arguments
    <textarea rows="3" bind:value={command} spellcheck="false"></textarea>
  </label>
  <p class="hint">
    Use {Placeholder.Video}, {Placeholder.Audio} and {Placeholder.Captions} for the YouTube streams. Every file FFmpeg writes is offered for download
  </p>

  <button onclick={run} disabled={isRunning}>{isRunning ? "Running" : "Run FFmpeg"}</button>

  {#if status}
    <p class="hint">{status}</p>
  {/if}
  {#if isRunning && downloadRatio > 0 && downloadRatio < 1}
    <progress value={downloadRatio}></progress>
  {/if}
  {#if errorMessage}
    <p class="error">{errorMessage}</p>
  {/if}
  {#if outputs.length}
    <ul class="outputs">
      {#each outputs as output (output.name)}
        <li><a href={output.url} download={output.name}>Save {output.name}</a></li>
      {/each}
    </ul>
  {/if}
  {#if logText}
    <pre>{logText}</pre>
  {/if}
</main>
