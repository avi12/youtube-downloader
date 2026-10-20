<script lang="ts">
  import { onMount } from "svelte";
  import { cubicOut } from "svelte/easing";
  import { fly } from "svelte/transition";
  import type { WorkerInput, WorkerMessage, WorkerRequest } from "../ffmpeg-worker";
  import PresetCard from "./PresetCard.svelte";
  import OptionField from "./shared/OptionField.svelte";
  import TabNav from "./shared/TabNav.svelte";
  import WavyProgress from "./shared/WavyProgress.svelte";
  import { URL_TOKEN } from "@/lib/command";
  import { applyFfmpegCommand, findJobOutputs } from "@/lib/ffmpeg-command";
  import { mimeTypeForFile } from "@/lib/mime";
  import {
    BUILT_IN_PRESETS,
    DEFAULT_SHOWN_IDS,
    createBlankPreset,
    defaultValues,
    fillVariables,
    isBuiltInPreset,
    listHiddenPresets,
    listShownPresets,
    loadLibraryState,
    mergeLibraryState,
    moveBefore,
    parseLibraryFile,
    serializeLibraryState,
    storeLibraryState
  } from "@/lib/presets";
  import type { LibraryState, Preset } from "@/lib/presets";
  import { parseUrl } from "@/lib/url";
  import { parsePlaylistId } from "@/lib/youtube";
  import { downloadSabrTrack } from "@/lib/sabr";
  import type { DirectFile, Job, JobInput } from "@/lib/ytdlp/plan";
  import { runYtDlpCommand } from "@/lib/ytdlp/session";
  import type { TabContext } from "@/lib/ytdlp/session";

  type DoneMessage = Extract<WorkerMessage, { type: "done" }>;

  const URL_TOKEN_PATTERN = new RegExp(`\\b${URL_TOKEN}\\b`);
  const EXPORT_FILE_NAME = "youtube-ffmpeg-lite-presets.json";
  const SLIDE_DURATION_MS = 200;
  const SLIDE_DISTANCE_PX = 50;
  const PERCENT = 100;
  const PANELS = [
    { id: "presets", label: "Presets" },
    { id: "library", label: "Library" }
  ];

  let activePanel = $state("presets");
  let slideDirection = $state(1);
  const flyIn = $derived({ x: slideDirection * SLIDE_DISTANCE_PX, duration: SLIDE_DURATION_MS, opacity: 0, easing: cubicOut });
  const flyOut = $derived({ x: -slideDirection * SLIDE_DISTANCE_PX, duration: SLIDE_DURATION_MS, opacity: 0, easing: cubicOut });

  function changePanel(id: string) {
    slideDirection = PANELS.findIndex(panel => panel.id === id) > PANELS.findIndex(panel => panel.id === activePanel) ? 1 : -1;
    activePanel = id;
  }

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
  let draggedId = $state<string>();
  let elImportInput = $state<HTMLInputElement>();
  let pastedUrl = $state("");
  let isUrlFieldOpen = $state(false);
  let valuesById = $state<Record<string, Record<string, string>>>({});

  const shownPresets = $derived(listShownPresets(library));
  const hiddenPresets = $derived(listHiddenPresets(library));
  const checkedPresets = $derived(shownPresets.filter(preset => library.checkedIds?.includes(preset.id)));
  const isYouTubeTab = $derived(parseUrl(tab.url ?? "")?.hostname.endsWith("youtube.com") ?? false);

  onMount(async () => {
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    tab = { tabId: activeTab?.id, url: activeTab?.url };
    isUrlFieldOpen = !isYouTubeTab;
  });

  function updateLibrary(next: LibraryState) {
    library = next;
    storeLibraryState(next);
  }

  function currentShownIds() {
    return library.shownIds ?? DEFAULT_SHOWN_IDS;
  }

  function withTabUrl(presetCommand: string) {
    const typedUrl = pastedUrl.trim();
    if (typedUrl) {
      return presetCommand.replace(URL_TOKEN_PATTERN, `"${typedUrl}"`);
    }

    const hasPlaylist = Boolean(tab.url && parsePlaylistId(tab.url));
    const isWatchPage = Boolean(tab.url && parseUrl(tab.url)?.searchParams.has("v"));
    const playlistFlag = hasPlaylist && isWatchPage ? "--no-playlist " : "";
    return isYouTubeTab ? presetCommand.replace(URL_TOKEN_PATTERN, `${playlistFlag}"${tab.url}"`) : presetCommand;
  }

  function valuesFor(preset: Preset) {
    return valuesById[preset.id] ?? defaultValues(preset.variables);
  }

  type CheckedChange = { id: string; isChecked: boolean };
  type PresetSave = { previousId: string; draft: Preset };
  type BlobSave = { name: string; parts: BlobPart[] };
  type Cancellable = { signal: AbortSignal };
  type DirectFileSave = Cancellable & { file: DirectFile };
  type InputMaterialization = Cancellable & { input: JobInput };
  type WorkerRun = Cancellable & { request: WorkerRequest };
  type JobRun = Cancellable & { plannedJob: Job; ffmpegCommand: string | undefined };
  type PresetRun = { preset: Preset; values: Record<string, string>; isFresh?: boolean };

  function setChecked({ id, isChecked }: CheckedChange) {
    const others = (library.checkedIds ?? []).filter(checkedId => checkedId !== id);
    updateLibrary({ ...library, checkedIds: isChecked ? [...others, id] : others });
  }

  async function pasteUrl() {
    pastedUrl = (await navigator.clipboard.readText()).trim();
  }

  function savePreset({ previousId, draft }: PresetSave) {
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

  function movePreset(targetId: string) {
    if (draggedId) {
      updateLibrary({ ...library, shownIds: moveBefore({ ids: currentShownIds(), movedId: draggedId, targetId }) });
    }

    draggedId = undefined;
  }

  function makeDefault(id: string) {
    updateLibrary({ ...library, defaultId: id, shownIds: moveBefore({ ids: currentShownIds(), movedId: id, targetId: currentShownIds()[0] ?? id }) });
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
      updateLibrary(mergeLibraryState({ current: library, imported: parseLibraryFile(await file.text()) }));
      status = `Imported ${file.name}`;
    } catch (error) {
      errorMessage = describeError(error);
    }
  }

  async function exportPresets() {
    await saveBlob({ name: EXPORT_FILE_NAME, parts: [serializeLibraryState(library)] });
  }

  function cancel() {
    abortController?.abort();
  }

  async function saveBlob({ name, parts }: BlobSave) {
    await browser.downloads.download({
      url: URL.createObjectURL(new Blob(parts, { type: mimeTypeForFile(name) })),
      filename: name,
      conflictAction: "uniquify"
    });
    savedNames.push(name);
  }

  async function saveDirectFile({ file: { saveAs, text, url }, signal }: DirectFileSave) {
    if (text !== undefined) {
      await saveBlob({ name: saveAs, parts: [text] });
      return;
    }

    const response = await fetch(url!, { signal });
    if (!response.ok) {
      throw new Error(`Couldn't fetch ${saveAs}: HTTP ${response.status}`);
    }

    await saveBlob({ name: saveAs, parts: [await response.arrayBuffer()] });
  }

  async function materializeInput({ input: { sabr, ...input }, signal }: InputMaterialization): Promise<WorkerInput> {
    if (!sabr) {
      return input;
    }

    status = `Downloading ${input.name}`;
    downloadRatio = 0;
    const bytes = await downloadSabrTrack({ session: sabr.session, format: sabr.format, signal, onProgress: ratio => (downloadRatio = ratio) });
    return { ...input, data: bytes.buffer };
  }

  function runInWorker({ request, signal }: WorkerRun) {
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
      worker.postMessage(request, request.inputs.flatMap(input => (input.data ? [input.data] : [])));
    });
  }

  async function runJob({ plannedJob, ffmpegCommand, signal }: JobRun) {
    const job = ffmpegCommand && plannedJob.isMedia ? applyFfmpegCommand({ job: plannedJob, command: ffmpegCommand }) : plannedJob;
    status = `Running ${job.saveAs}`;
    downloadRatio = 0;
    const done = await runInWorker({
      request: {
        wasmUrl: browser.runtime.getURL("/ffmpeg/ffmpeg-core.wasm"),
        inputs: await Promise.all(job.inputs.map(input => materializeInput({ input, signal }))),
        args: job.args
      },
      signal
    });
    const outputs = findJobOutputs({ files: done.files, job });
    if (done.code !== 0 || !outputs.length) {
      throw new Error(`FFmpeg failed on ${job.saveAs} (exit code ${done.code})`);
    }

    await Promise.all(outputs.map(output => saveBlob({ name: output.saveAs, parts: [output.data] })));
  }

  function describeError(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }

  async function runChecked() {
    savedNames = [];
    for (const preset of checkedPresets) {
      const isDone = await run({ preset, values: valuesFor(preset), isFresh: false });
      if (!isDone) {
        return;
      }
    }
  }

  async function run({ preset, values, isFresh = true }: PresetRun) {
    errorMessage = "";
    logText = "";
    status = "";
    if (isFresh) {
      savedNames = [];
    }

    const controller = new AbortController();
    try {
      const { variables } = preset;
      const command = withTabUrl(fillVariables({ text: preset.command, variables, values }));
      const ffmpegCommand = preset.ffmpegCommand ? fillVariables({ text: preset.ffmpegCommand, variables, values }) : undefined;
      runningPresetId = preset.id;
      abortController = controller;
      await runYtDlpCommand({
        command,
        tab,
        hooks: {
          signal: controller.signal,
          log: text => (logText += `${text}\n`),
          status: text => (status = text),
          runJob: plannedJob => runJob({ plannedJob, ffmpegCommand, signal: controller.signal }),
          saveDirectFile: file => saveDirectFile({ file, signal: controller.signal })
        }
      });
      status = "Done";
    } catch (error) {
      status = controller.signal.aborted ? "Cancelled" : status;
      errorMessage = controller.signal.aborted ? "" : describeError(error);
    }

    const isDone = !controller.signal.aborted && !errorMessage;
    abortController = undefined;
    runningPresetId = undefined;
    return isDone;
  }
</script>

<main class="popup-container">
  <header class="popup-header">
    <div class="popup-header-top">
      <h1 class="popup-title">FFmpeg for YouTube</h1>
      <span class="popup-credit">by <a class="text-link" href="https://avi12.com" target="_blank">Avi</a></span>
    </div>
    <TabNav activeTab={activePanel} initialActiveTab="presets" onChange={changePanel} tabs={PANELS} />
  </header>

  <div class="popup-content">
  {#if activePanel === "presets"}
  <div id="panel-presets" class="panel-wrapper" role="tabpanel" in:fly={flyIn} out:fly={flyOut}>
  {#each shownPresets as preset (preset.id)}
    {#key preset}
    <PresetCard
      {preset}
      isBuiltIn={isBuiltInPreset(preset.id)}
      isDefault={library.defaultId === preset.id}
      isBusy={runningPresetId !== undefined}
      isThisRunning={runningPresetId === preset.id}
      isChecked={library.checkedIds?.includes(preset.id) ?? false}
      values={valuesFor(preset)}
      onvalue={(name, value) => (valuesById[preset.id] = { ...valuesFor(preset), [name]: value })}
      onchecked={isChecked => setChecked({ id: preset.id, isChecked })}
      isOpenForEditing={newPresetId === preset.id}
      onrun={() => run({ preset, values: valuesFor(preset) })}
      oncancel={cancel}
      onsave={draft => savePreset({ previousId: preset.id, draft })}
      onhide={() => hidePreset(preset.id)}
      onsetdefault={() => makeDefault(preset.id)}
      ondragstart={() => (draggedId = preset.id)}
      ondragend={() => (draggedId = undefined)}
      ondropped={() => movePreset(preset.id)}
      ondelete={() => deletePreset(preset.id)}
    />
    {/key}
  {/each}

  <div class="row">
    <button class="filled" onclick={runChecked} disabled={!checkedPresets.length || runningPresetId !== undefined}>Run checked ({checkedPresets.length})</button>
    {#if abortController}
      <button class="danger" onclick={cancel}>Cancel</button>
    {/if}
  </div>

  <details bind:open={isUrlFieldOpen}>
    <summary>URL</summary>
    <div class="url-field">
      <OptionField hint="Leave it empty to use this tab. Playlist URLs download every video" label="YouTube link">
        <input type="url" placeholder="Paste a YouTube link" bind:value={pastedUrl} />
      </OptionField>
      <button onclick={pasteUrl}>Paste</button>
    </div>
  </details>

  {#if status}
    <p class="hint">{status}</p>
  {/if}
  {#if runningPresetId}
    <WavyProgress indeterminate={downloadRatio <= 0 || downloadRatio >= 1} value={downloadRatio * PERCENT} />
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
  </div>
  {:else}
  <div id="panel-library" class="panel-wrapper" role="tabpanel" in:fly={flyIn} out:fly={flyOut}>
    <p class="hint">Files go straight to your Downloads folder. Hidden presets can be added back here, and presets can be moved between browsers with Export and Import</p>
    <div class="row">
      {#if hiddenPresets.length}
        <OptionField label="Add a preset">
          <select onchange={e => { showPreset(e.currentTarget.value); e.currentTarget.value = ""; }} aria-label="Add a preset">
            <option value="" selected disabled>Choose one</option>
            {#each hiddenPresets as preset (preset.id)}
              <option value={preset.id}>{preset.label}</option>
            {/each}
          </select>
        </OptionField>
      {/if}
    </div>
    <div class="row">
      <button class="filled" onclick={createPreset}>New preset</button>
      <button onclick={() => elImportInput?.click()}>Import</button>
      <button onclick={exportPresets}>Export</button>
      <input bind:this={elImportInput} type="file" accept="application/json,.json" onchange={importPresets} hidden />
    </div>
  </div>
  {/if}
  </div>
</main>

<style>
  :global(.text-link) {
    padding: 0;
    border: none;
    background: none;
    color: var(--accent);
    font: inherit;
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .popup-container {
    display: flex;
    flex-direction: column;
    height: 600px;
  }

  .popup-header {
    padding: 16px;
    padding-bottom: 0;
    background: var(--bg);
  }

  .popup-header-top {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 12px;
  }

  .popup-title {
    color: var(--fg);
    font-weight: 600;
    font-size: 1.125rem;
  }

  .popup-credit {
    color: var(--fg-muted);
    font-size: 0.75rem;
  }

  .popup-content {
    position: relative;
    flex: 1;
    overflow: hidden;
    min-height: 120px;
  }

  .panel-wrapper {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow-y: auto;
    padding: 16px;
    scrollbar-color: var(--border) transparent;
    scrollbar-width: thin;
  }

  .url-field {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding-block-start: 8px;

    :global(.option-field) {
      flex: 1;
    }

    button {
      margin-block-start: 20px;
    }
  }
</style>
