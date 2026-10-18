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

  const ALL_CAPTIONS_NONE = "";

  type Output = { name: string; url: string };

  let url = $state("");
  let command = $state(PRESETS[0]!.command);
  let isRunning = $state(false);
  let status = $state("");
  let errorMessage = $state("");
  let logText = $state("");
  let downloadRatio = $state(0);
  let outputs = $state<Output[]>([]);
  let resolved = $state<ResolvedVideo>();
  let videoItag = $state(0);
  let audioItag = $state(0);
  let captionLanguage = $state(ALL_CAPTIONS_NONE);
  let lookupId = 0;

  $effect(() => {
    const videoId = parseVideoId(url);
    const thisLookup = ++lookupId;
    resolved = undefined;
    if (!videoId) {
      return;
    }

    lookUp(videoId, thisLookup).catch(error => {
      if (thisLookup === lookupId) {
        errorMessage = error instanceof Error ? error.message : String(error);
      }
    });
  });

  async function lookUp(videoId: string, thisLookup: number) {
    await registerRequestHeaderRules();
    const result = await resolveVideo(videoId);
    if (thisLookup !== lookupId) {
      return;
    }

    errorMessage = "";
    resolved = result;
    videoItag = result.videos[0]?.itag ?? 0;
    audioItag = result.audios[0]?.itag ?? 0;
    captionLanguage = result.captions[0]?.languageCode ?? ALL_CAPTIONS_NONE;
  }

  onMount(async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && parseVideoId(tab.url)) {
      url = tab.url;
    }
  });

  function buildInputs(video: ResolvedVideo, placeholders: Placeholder[]): WorkerRequest["inputs"] {
    const sources: Record<Placeholder, { url?: string; contentLength?: string } | undefined> = {
      [Placeholder.Video]: video.videos.find(format => format.itag === videoItag),
      [Placeholder.Audio]: video.audios.find(format => format.itag === audioItag),
      [Placeholder.Captions]: video.captions.find(track => track.languageCode === captionLanguage)
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
    for (const output of outputs) {
      browser.downloads.download({ url: output.url, filename: output.name, conflictAction: "uniquify" });
    }
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
    if (!resolved) {
      errorMessage = "Paste a YouTube URL and wait for the video to load first";
      return;
    }

    isRunning = true;
    errorMessage = "";
    logText = "";
    outputs = [];
    downloadRatio = 0;
    status = "Starting";
    try {
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

  {#if resolved}
    <div class="choices">
      <label>
        Video quality
        <select bind:value={videoItag}>
          {#each resolved.videos as format (format.itag)}
            <option value={format.itag}>{format.height}p</option>
          {/each}
        </select>
      </label>
      <label>
        Audio language
        <select bind:value={audioItag}>
          {#each resolved.audios as format (format.itag)}
            <option value={format.itag}>{format.audioTrack?.displayName ?? "Default"}</option>
          {/each}
        </select>
      </label>
      <label>
        Captions language
        <select bind:value={captionLanguage}>
          {#each resolved.captions as track (track.languageCode)}
            <option value={track.languageCode}>{track.label}</option>
          {:else}
            <option value={ALL_CAPTIONS_NONE}>No captions</option>
          {/each}
        </select>
      </label>
    </div>
  {/if}

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
    Use {Placeholder.Video}, {Placeholder.Audio} and {Placeholder.Captions} for the streams picked above. Every file FFmpeg writes is saved straight to your Downloads folder
  </p>

  <button onclick={run} disabled={isRunning || !resolved}>{isRunning ? "Running" : "Run FFmpeg"}</button>

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
        <li>Saved {output.name}</li>
      {/each}
    </ul>
  {/if}
  {#if logText}
    <pre>{logText}</pre>
  {/if}
</main>
