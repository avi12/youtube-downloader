<script lang="ts">
  import { onMount } from "svelte";
  import type { WorkerMessage, WorkerRequest } from "../ffmpeg-worker";
  import PresetCard from "./PresetCard.svelte";
  import { URL_TOKEN } from "@/lib/command";
  import { applyFfmpegCommand } from "@/lib/ffmpeg-command";
  import { mimeTypeForFile } from "@/lib/mime";
  import {
    BUILT_IN_PRESETS,
    DEFAULT_SHOWN_IDS,
    createBlankPreset,
    fillVariables,
    isBuiltInPreset,
    listHiddenPresets,
    listShownPresets,
    loadLibraryState,
    mergeLibraryState,
    parseLibraryFile,
    serializeLibraryState,
    storeLibraryState
  } from "@/lib/presets";
  import type { LibraryState, Preset } from "@/lib/presets";
  import { parsePlaylistId } from "@/lib/youtube";
  import type { DirectFile, Job } from "@/lib/ytdlp/plan";
  import { runYtDlpCommand } from "@/lib/ytdlp/session";
  import type { TabContext } from "@/lib/ytdlp/session";

  type DoneMessage = Extract<WorkerMessage, { type: "done" }>;

  const URL_TOKEN_PATTERN = new RegExp(`\\b${URL_TOKEN}\\b`);
  const EXPORT_FILE_NAME = "youtube-ffmpeg-lite-presets.json";

  let library = $state<LibraryState>(loadLibraryState());
  let tab = $state<TabContext>({});
  let runningPresetId = $state<string>();
  let abortController = $state<AbortController>();
  let status = $state("");
  let errorMessage = $state("");
  let logText = $state("");
  let downloadRatio = $state(0);
  let savedNames = $state<string[]>([]);
  let newPresetId = $state<string>();
  let elImportInput = $state<HTMLInputElement>();

  const shownPresets = $derived(listShownPresets(library));
  const hiddenPresets = $derived(listHiddenPresets(library));

  onMount(async () => {
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    tab = { tabId: activeTab?.id, url: activeTab?.url };
  });

  function updateLibrary(next: LibraryState) {
    library = next;
    storeLibraryState(next);
  }

  function currentShownIds() {
    return library.shownIds ?? DEFAULT_SHOWN_IDS;
  }

  function withTabUrl(presetCommand: string) {
    const hasPlaylist = Boolean(tab.url && parsePlaylistId(tab.url));
    const isWatchPage = Boolean(tab.url && URL.parse(tab.url)?.searchParams.has("v"));
    const playlistFlag = hasPlaylist && isWatchPage ? "--no-playlist " : "";
    const isYouTubeTab = Boolean(tab.url && URL.parse(tab.url)?.hostname.endsWith("youtube.com"));
    return isYouTubeTab ? presetCommand.replace(URL_TOKEN_PATTERN, `${playlistFlag}"${tab.url}"`) : presetCommand;
  }

  function savePreset(previousId: string, draft: Preset) {
    if (isBuiltInPreset(previousId)) {
      const copy = { ...draft, id: crypto.randomUUID() };
      updateLibrary({
        custom: [...library.custom, copy],
        shownIds: currentShownIds().map(id => (id === previousId ? copy.id : id)),
        defaultId: library.defaultId === previousId ? copy.id : library.defaultId
      });
      return;
    }

    updateLibrary({ ...library, custom: library.custom.map(preset => (preset.id === previousId ? draft : preset)) });
  }

  function hidePreset(id: string) {
    updateLibrary({ ...library, shownIds: currentShownIds().filter(shownId => shownId !== id), defaultId: library.defaultId === id ? undefined : library.defaultId });
  }

  function showPreset(id: string) {
    updateLibrary({ ...library, shownIds: [...currentShownIds(), id] });
  }

  function createPreset() {
    const preset = createBlankPreset();
    newPresetId = preset.id;
    updateLibrary({ ...library, custom: [...library.custom, preset], shownIds: [...currentShownIds(), preset.id] });
  }

  function deletePreset(id: string) {
    updateLibrary({
      custom: library.custom.filter(preset => preset.id !== id),
      shownIds: currentShownIds().filter(shownId => shownId !== id),
      defaultId: library.defaultId === id ? undefined : library.defaultId
    });
  }

  async function importPresets(e: Event & { currentTarget: HTMLInputElement }) {
    const [file] = e.currentTarget.files ?? [];
    e.currentTarget.value = "";
    if (!file) {
      return;
    }

    errorMessage = "";
    try {
      updateLibrary(mergeLibraryState(library, parseLibraryFile(await file.text())));
      status = `Imported ${file.name}`;
    } catch (error) {
      errorMessage = describeError(error);
    }
  }

  async function exportPresets() {
    await saveBlob(EXPORT_FILE_NAME, [serializeLibraryState(library)]);
  }

  function cancel() {
    abortController?.abort();
  }

  async function saveBlob(name: string, parts: BlobPart[]) {
    await browser.downloads.download({
      url: URL.createObjectURL(new Blob(parts, { type: mimeTypeForFile(name) })),
      filename: name,
      conflictAction: "uniquify"
    });
    savedNames.push(name);
  }

  async function saveDirectFile({ saveAs, text, url }: DirectFile, signal: AbortSignal) {
    if (text !== undefined) {
      await saveBlob(saveAs, [text]);
      return;
    }

    const response = await fetch(url!, { signal });
    if (!response.ok) {
      throw new Error(`Couldn't fetch ${saveAs}: HTTP ${response.status}`);
    }

    await saveBlob(saveAs, [await response.arrayBuffer()]);
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

  async function runJob(plannedJob: Job, ffmpegCommand: string | undefined, signal: AbortSignal) {
    const job = ffmpegCommand && plannedJob.isMedia ? applyFfmpegCommand(plannedJob, ffmpegCommand) : plannedJob;
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

    await saveBlob(job.saveAs, [output.data]);
  }

  function describeError(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }

  async function run(preset: Preset, values: Record<string, string>) {
    errorMessage = "";
    logText = "";
    savedNames = [];
    status = "";
    const controller = new AbortController();
    try {
      const command = withTabUrl(fillVariables(preset.command, preset.variables, values));
      const ffmpegCommand = preset.ffmpegCommand ? fillVariables(preset.ffmpegCommand, preset.variables, values) : undefined;
      runningPresetId = preset.id;
      abortController = controller;
      await runYtDlpCommand(command, tab, {
        signal: controller.signal,
        log: text => (logText += `${text}\n`),
        status: text => (status = text),
        runJob: job => runJob(job, ffmpegCommand, controller.signal),
        saveDirectFile: file => saveDirectFile(file, controller.signal)
      });
      status = "Done";
    } catch (error) {
      status = controller.signal.aborted ? "Cancelled" : status;
      errorMessage = controller.signal.aborted ? "" : describeError(error);
    }

    abortController = undefined;
    runningPresetId = undefined;
  }
</script>

<main>
  {#each shownPresets as preset (preset.id)}
    {#key preset}
    <PresetCard
      {preset}
      isBuiltIn={isBuiltInPreset(preset.id)}
      isDefault={library.defaultId === preset.id}
      isBusy={runningPresetId !== undefined}
      isThisRunning={runningPresetId === preset.id}
      isOpenForEditing={newPresetId === preset.id}
      onrun={values => run(preset, values)}
      oncancel={cancel}
      onsave={draft => savePreset(preset.id, draft)}
      onhide={() => hidePreset(preset.id)}
      onsetdefault={() => updateLibrary({ ...library, defaultId: preset.id })}
      ondelete={() => deletePreset(preset.id)}
    />
    {/key}
  {/each}

  <p class="hint">
    Leave the URL out to use this tab. Playlist URLs download every video. Files go straight to your Downloads folder
  </p>

  <div class="row">
    {#if hiddenPresets.length}
      <select onchange={e => { showPreset(e.currentTarget.value); e.currentTarget.value = ""; }} aria-label="Add a preset">
        <option value="" selected disabled>Add a preset</option>
        {#each hiddenPresets as preset (preset.id)}
          <option value={preset.id}>{preset.label}</option>
        {/each}
      </select>
    {/if}
    <button onclick={createPreset}>New preset</button>
    <button onclick={() => elImportInput?.click()}>Import</button>
    <button onclick={exportPresets}>Export</button>
    <input bind:this={elImportInput} type="file" accept="application/json,.json" onchange={importPresets} hidden />
  </div>

  {#if status}
    <p class="hint">{status}</p>
  {/if}
  {#if runningPresetId && downloadRatio > 0 && downloadRatio < 1}
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
