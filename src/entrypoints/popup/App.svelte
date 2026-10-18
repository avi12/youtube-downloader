<script lang="ts">
  import { onMount } from "svelte";
  import type { WorkerMessage, WorkerRequest } from "../ffmpeg-worker";
  import { PRESETS, URL_TOKEN } from "@/lib/command";
  import { parseVideoId, registerRequestHeaderRules, resolveVideo } from "@/lib/youtube";
  import { parseYtDlpCommand } from "@/lib/ytdlp/options";
  import { planJobs } from "@/lib/ytdlp/plan";
  import type { Job } from "@/lib/ytdlp/plan";

  let command = $state(`yt-dlp ${URL_TOKEN}`);
  let currentUrl = $state("");
  let isRunning = $state(false);
  let status = $state("");
  let errorMessage = $state("");
  let logText = $state("");
  let downloadRatio = $state(0);
  let savedNames = $state<string[]>([]);

  onMount(async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && parseVideoId(tab.url)) {
      currentUrl = tab.url;
      command = command.replace(URL_TOKEN, `"${tab.url}"`);
    }
  });

  function applyPreset(presetCommand: string) {
    command = presetCommand.replace(URL_TOKEN, currentUrl ? `"${currentUrl}"` : URL_TOKEN);
  }

  function saveOutputs(files: { name: string; data: ArrayBuffer }[]) {
    for (const { name, data } of files) {
      browser.downloads.download({
        url: URL.createObjectURL(new Blob([data])),
        filename: name,
        conflictAction: "uniquify"
      });
      savedNames.push(name);
    }
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

    saveOutputs(message.files);
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

  async function runJob(job: Job) {
    status = `Running ${job.label}`;
    downloadRatio = 0;
    await runInWorker({
      wasmUrl: browser.runtime.getURL("/ffmpeg/ffmpeg-core.wasm"),
      inputs: job.inputs,
      args: job.args
    });
  }

  async function run() {
    isRunning = true;
    errorMessage = "";
    logText = "";
    savedNames = [];
    status = "Looking up the video";
    try {
      const options = parseYtDlpCommand(command);
      const videoId = parseVideoId(options.url ?? "");
      if (!videoId) {
        throw new Error("Put a YouTube URL in the command");
      }

      await registerRequestHeaderRules();
      const { jobs, notes } = planJobs(options, await resolveVideo(videoId));
      logText = notes.join("\n");
      for (const job of jobs) {
        await runJob(job);
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    isRunning = false;
  }
</script>

<main>
  <label>
    Preset
    <select onchange={e => applyPreset(e.currentTarget.value)}>
      <option value="" selected disabled>Pick one to fill the command</option>
      {#each PRESETS as preset (preset.label)}
        <option value={preset.command}>{preset.label}</option>
      {/each}
    </select>
  </label>

  <label>
    yt-dlp command
    <textarea rows="4" bind:value={command} spellcheck="false"></textarea>
  </label>
  <p class="hint">
    Same flags as yt-dlp: -f, -S, -x, --audio-format, --merge-output-format, --write-subs, --sub-langs, --convert-subs, --skip-download, --download-sections, -o, -F. Files go straight to your Downloads folder
  </p>

  <button onclick={run} disabled={isRunning}>{isRunning ? "Running" : "Run"}</button>

  {#if status}
    <p class="hint">{status}</p>
  {/if}
  {#if isRunning && downloadRatio > 0 && downloadRatio < 1}
    <progress value={downloadRatio}></progress>
  {/if}
  {#if errorMessage}
    <p class="error">{errorMessage}</p>
  {/if}
  {#if savedNames.length}
    <ul class="outputs">
      {#each savedNames as name (name)}
        <li>Saved {name}</li>
      {/each}
    </ul>
  {/if}
  {#if logText}
    <pre>{logText}</pre>
  {/if}
</main>
