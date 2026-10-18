<script lang="ts">
  import { onMount } from "svelte";
  import type { WorkerMessage, WorkerRequest } from "../ffmpeg-worker";
  import { URL_TOKEN } from "@/lib/command";
  import { applyFfmpegCommand } from "@/lib/ffmpeg-command";
  import { BUILT_IN_PRESETS, loadSavedPresets, storeSavedPresets, upsertPreset } from "@/lib/presets";
  import type { Preset } from "@/lib/presets";
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
  let savedPresets = $state<Preset[]>(loadSavedPresets());
  let presetName = $state("");
  let isFfmpegEnabled = $state(false);
  let ffmpegCommand = $state("");
  let abortController = $state<AbortController>();

  const isSavedPresetSelected = $derived(savedPresets.some(saved => saved.label === presetName));

  onMount(async () => {
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    tab = { tabId: activeTab?.id, url: activeTab?.url };
    const isYouTubeTab = Boolean(activeTab?.url && URL.parse(activeTab.url)?.hostname.endsWith("youtube.com"));
    if (isYouTubeTab) {
      command = withTabUrl(command);
    }
  });

  function withTabUrl(presetCommand: string) {
    const hasPlaylist = Boolean(tab.url && parsePlaylistId(tab.url));
    const isWatchPage = Boolean(tab.url && URL.parse(tab.url)?.searchParams.has("v"));
    const playlistFlag = hasPlaylist && isWatchPage ? "--no-playlist " : "";
    return presetCommand.replace(URL_TOKEN, `${playlistFlag}"${tab.url ?? URL_TOKEN}"`);
  }

  function applyPreset(label: string) {
    const preset = [...BUILT_IN_PRESETS, ...savedPresets].find(candidate => candidate.label === label);
    if (!preset) {
      return;
    }

    command = withTabUrl(preset.command);
    ffmpegCommand = preset.ffmpegCommand ?? "";
    isFfmpegEnabled = Boolean(preset.ffmpegCommand);
    presetName = savedPresets.some(saved => saved.label === label) ? label : "";
  }

  function savePreset() {
    const label = presetName.trim();
    const commandWithoutTab = tab.url ? command.replaceAll(`"${tab.url}"`, URL_TOKEN) : command;
    savedPresets = upsertPreset(savedPresets, { label, command: commandWithoutTab, ffmpegCommand: isFfmpegEnabled ? ffmpegCommand : undefined });
    storeSavedPresets(savedPresets);
  }

  function deletePreset() {
    savedPresets = savedPresets.filter(saved => saved.label !== presetName);
    storeSavedPresets(savedPresets);
    presetName = "";
  }

  function cancel() {
    abortController?.abort();
  }

  async function saveBlob(name: string, blob: Blob) {
    await browser.downloads.download({
      url: URL.createObjectURL(blob),
      filename: name,
      conflictAction: "uniquify"
    });
    savedNames.push(name);
  }

  async function saveDirectFile({ saveAs, text, url }: DirectFile, signal: AbortSignal) {
    if (text !== undefined) {
      await saveBlob(saveAs, new Blob([text]));
      return;
    }

    const response = await fetch(url!, { signal });
    if (!response.ok) {
      throw new Error(`Couldn't fetch ${saveAs}: HTTP ${response.status}`);
    }

    await saveBlob(saveAs, await response.blob());
  }

  function runInWorker(request: WorkerRequest, signal: AbortSignal) {
    return new Promise<DoneMessage>((resolve, reject) => {
      const worker = new Worker(browser.runtime.getURL("/ffmpeg-worker.js"), { type: "module" });
      signal.addEventListener("abort", () => {
        worker.terminate();
        reject(signal.reason);
      }, { once: true });
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

  async function runJob(plannedJob: Job, signal: AbortSignal) {
    const job = isFfmpegEnabled && plannedJob.isMedia ? applyFfmpegCommand(plannedJob, ffmpegCommand) : plannedJob;
    status = `Running ${job.saveAs}`;
    downloadRatio = 0;
    const done = await runInWorker({
      wasmUrl: browser.runtime.getURL("/ffmpeg/ffmpeg-core.wasm"),
      inputs: job.inputs,
      args: job.args
    }, signal);
    const output = done.files.find(file => file.name === job.outputFile);
    if (done.code !== 0 || !output) {
      throw new Error(`FFmpeg failed on ${job.saveAs} (exit code ${done.code})`);
    }

    await saveBlob(job.saveAs, new Blob([output.data]));
  }

  function describeError(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }

  async function run() {
    isRunning = true;
    errorMessage = "";
    logText = "";
    savedNames = [];
    const controller = new AbortController();
    abortController = controller;
    try {
      await runYtDlpCommand(command, tab, {
        signal: controller.signal,
        log: text => (logText += `${text}\n`),
        status: text => (status = text),
        runJob: job => runJob(job, controller.signal),
        saveDirectFile: file => saveDirectFile(file, controller.signal)
      });
      status = "Done";
    } catch (error) {
      status = controller.signal.aborted ? "Cancelled" : status;
      errorMessage = controller.signal.aborted ? "" : describeError(error);
    }

    abortController = undefined;
    isRunning = false;
  }
</script>

<main>
  <label>
    Preset
    <select onchange={e => applyPreset(e.currentTarget.value)}>
      <option value="" selected disabled>Pick one to fill the command</option>
      <optgroup label="Built in">
        {#each BUILT_IN_PRESETS as preset (preset.label)}
          <option value={preset.label}>{preset.label}</option>
        {/each}
      </optgroup>
      {#if savedPresets.length}
        <optgroup label="Saved">
          {#each savedPresets as preset (preset.label)}
            <option value={preset.label}>{preset.label}</option>
          {/each}
        </optgroup>
      {/if}
    </select>
  </label>

  <label>
    yt-dlp command
    <textarea rows="4" bind:value={command} spellcheck="false"></textarea>
  </label>
  <p class="hint">
    Leave the URL out to use this tab. Playlist URLs download every video. Files go straight to your Downloads folder
  </p>

  <label class="check">
    <input type="checkbox" bind:checked={isFfmpegEnabled} />
    Run my own FFmpeg command on the downloaded streams
  </label>
  {#if isFfmpegEnabled}
    <textarea rows="2" bind:value={ffmpegCommand} spellcheck="false" aria-label="FFmpeg command"></textarea>
    <p class="hint">
      {"{input1}"} is the first downloaded stream, {"{input2}"} the second. End with the output file name, like snapshot.png
    </p>
  {/if}

  <div class="row">
    <input bind:value={presetName} placeholder="Preset name" aria-label="Preset name" />
    <button onclick={savePreset} disabled={!presetName.trim()}>Save preset</button>
    {#if isSavedPresetSelected}
      <button onclick={deletePreset}>Delete</button>
    {/if}
  </div>

  <div class="row">
    <button onclick={run} disabled={isRunning}>{isRunning ? "Running" : "Run"}</button>
    {#if isRunning}
      <button onclick={cancel}>Cancel</button>
    {/if}
  </div>

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
