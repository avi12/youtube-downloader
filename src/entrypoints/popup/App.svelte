<script lang="ts">
  import { onMount } from "svelte";
  import type { WorkerMessage, WorkerRequest } from "../ffmpeg-worker";
  import { PRESETS, URL_TOKEN } from "@/lib/command";
  import { parsePlaylistId } from "@/lib/youtube";
  import type { DirectFile, Job } from "@/lib/ytdlp/plan";
  import { runYtDlpCommand } from "@/lib/ytdlp/session";
  import type { TabContext } from "@/lib/ytdlp/session";

  type DoneMessage = Extract<WorkerMessage, { type: "done" }>;

  let command = $state(`yt-dlp ${URL_TOKEN}`);
  let tab = $state<TabContext>({});
  let isRunning = $state(false);
  let status = $state("");
  let errorMessage = $state("");
  let logText = $state("");
  let downloadRatio = $state(0);
  let savedNames = $state<string[]>([]);

  onMount(async () => {
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    tab = { tabId: activeTab?.id, url: activeTab?.url };
    const isYouTubeTab = Boolean(activeTab?.url && URL.parse(activeTab.url)?.hostname.endsWith("youtube.com"));
    if (isYouTubeTab) {
      applyPreset(command);
    }
  });

  function applyPreset(presetCommand: string) {
    const hasPlaylist = Boolean(tab.url && parsePlaylistId(tab.url));
    const isWatchPage = Boolean(tab.url && URL.parse(tab.url)?.searchParams.has("v"));
    const playlistFlag = hasPlaylist && isWatchPage ? "--no-playlist " : "";
    command = presetCommand.replace(URL_TOKEN, `${playlistFlag}"${tab.url ?? URL_TOKEN}"`);
  }

  async function saveBlob(name: string, blob: Blob) {
    await browser.downloads.download({
      url: URL.createObjectURL(blob),
      filename: name,
      conflictAction: "uniquify"
    });
    savedNames.push(name);
  }

  async function saveDirectFile({ saveAs, text, url }: DirectFile) {
    if (text !== undefined) {
      await saveBlob(saveAs, new Blob([text]));
      return;
    }

    const response = await fetch(url!);
    if (!response.ok) {
      throw new Error(`Couldn't fetch ${saveAs}: HTTP ${response.status}`);
    }

    await saveBlob(saveAs, await response.blob());
  }

  function runInWorker(request: WorkerRequest) {
    return new Promise<DoneMessage>((resolve, reject) => {
      const worker = new Worker(browser.runtime.getURL("/ffmpeg-worker.js"), { type: "module" });
      worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
        const message = e.data;
        if (message.type === "log") {
          logText += `${message.text}\n`;
          return;
        }

        if (message.type === "progress") {
          downloadRatio = message.ratio;
          status = `Downloading ${message.name}`;
          return;
        }

        worker.terminate();
        if (message.type === "error") {
          reject(new Error(message.message));
          return;
        }

        resolve(message);
      };
      worker.onerror = e => {
        worker.terminate();
        reject(new Error(e.message));
      };
      worker.postMessage(request);
    });
  }

  async function runJob(job: Job) {
    status = `Running ${job.saveAs}`;
    downloadRatio = 0;
    const done = await runInWorker({
      wasmUrl: browser.runtime.getURL("/ffmpeg/ffmpeg-core.wasm"),
      inputs: job.inputs,
      args: job.args
    });
    const output = done.files.find(file => file.name === job.outputFile);
    if (done.code !== 0 || !output) {
      throw new Error(`FFmpeg failed on ${job.saveAs} (exit code ${done.code})`);
    }

    await saveBlob(job.saveAs, new Blob([output.data]));
  }

  async function run() {
    isRunning = true;
    errorMessage = "";
    logText = "";
    savedNames = [];
    try {
      await runYtDlpCommand(command, tab, {
        log: text => (logText += `${text}\n`),
        status: text => (status = text),
        runJob,
        saveDirectFile
      });
      status = "Done";
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
    Leave the URL out to use this tab. Playlist URLs download every video. Files go straight to your Downloads folder
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
      {#each savedNames as name, index (index)}
        <li>Saved {name}</li>
      {/each}
    </ul>
  {/if}
  {#if logText}
    <pre>{logText}</pre>
  {/if}
</main>
