<script lang="ts">
  import OptionField from "./shared/OptionField.svelte";
  import { TIME_PATTERN, VARIABLE_TYPES } from "@/lib/presets";
  import type { Preset, Variable, VariableType } from "@/lib/presets";

  type Props = {
    preset: Preset;
    isBuiltIn: boolean;
    isDefault: boolean;
    isBusy: boolean;
    isThisRunning: boolean;
    isChecked: boolean;
    values: Record<string, string>;
    onvalue: (name: string, value: string) => void;
    onchecked: (isChecked: boolean) => void;
    isOpenForEditing: boolean;
    onrun: () => void;
    oncancel: () => void;
    onsave: (draft: Preset) => void;
    onhide: () => void;
    onsetdefault: () => void;
    ondragstart: () => void;
    ondragend: () => void;
    ondropped: () => void;
    ondelete: () => void;
  };

  const {
    preset,
    isBuiltIn,
    isDefault,
    isBusy,
    isThisRunning,
    isChecked,
    values,
    onvalue,
    onchecked,
    isOpenForEditing,
    onrun,
    oncancel,
    onsave,
    onhide,
    onsetdefault,
    ondragstart,
    ondragend,
    ondropped,
    ondelete
  }: Props = $props();

  // svelte-ignore state_referenced_locally
  let draft = $state<Preset>($state.snapshot(preset));
  // svelte-ignore state_referenced_locally
  let isFfmpegEnabled = $state(Boolean(preset.ffmpegCommand));
  // svelte-ignore state_referenced_locally
  let isEditing = $state(isOpenForEditing);

  type ListOption = {
    label: string;
    value: string;
  };

  function parseOptions(text: string): ListOption[] {
    return text
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const [label = "", ...valueParts] = line.split("=");
        const value = valueParts.join("=").trim();
        return {
          label: label.trim(),
          value: value || label.trim()
        };
      });
  }

  function formatOptions(variable: Variable): string {
    if (variable.type !== "list") {
      return "";
    }

    return variable.options.map(option => `${option.label}=${option.value}`).join("\n");
  }

  type VariableInput = {
    variable: Variable;
    raw: string;
  };
  type LimitChange = VariableInput & { key: "min" | "max" | "step" };
  type VariableBlueprint = {
    type: VariableType;
    name: string;
    label: string;
  };
  type VariableRetype = {
    index: number;
    type: VariableType;
  };
  type IndexedInput = {
    index: number;
    raw: string;
  };

  function applyOptions({ variable, raw }: VariableInput): void {
    if (variable.type !== "list") {
      return;
    }

    variable.options = parseOptions(raw);
    const isDefaultStillValid = variable.options.some(option => option.value === variable.defaultValue);
    variable.defaultValue = isDefaultStillValid ? variable.defaultValue : (variable.options[0]?.value ?? "");
  }

  function applyDefault({ variable, raw }: VariableInput): void {
    variable.defaultValue = variable.type === "number" ? Number(raw) : raw;
  }

  function buildVariable({ type, name, label }: VariableBlueprint): Variable {
    if (type === "number") {
      return {
        type,
        name,
        label,
        defaultValue: 1,
        step: 1
      };
    }

    if (type === "list") {
      return {
        type,
        name,
        label,
        defaultValue: "a",
        options: [{
          label: "A",
          value: "a"
        }, {
          label: "B",
          value: "b"
        }]
      };
    }

    return {
      type,
      name,
      label,
      defaultValue: type === "time" ? "00:00:00" : ""
    };
  }

  function retype({ index, type }: VariableRetype): void {
    const current = draft.variables[index];
    if (current) {
      draft.variables[index] = buildVariable({
        type,
        name: current.name,
        label: current.label
      });
    }
  }

  function retypeFromValue({ index, raw }: IndexedInput): void {
    const type = VARIABLE_TYPES.find(candidate => candidate === raw);
    if (type) {
      retype({
        index,
        type
      });
    }
  }

  function applyLimit({ variable, key, raw }: LimitChange): void {
    if (variable.type === "number") {
      variable[key] = raw === "" ? undefined : Number(raw);
    }
  }

  function addVariable(): void {
    const number = draft.variables.length + 1;
    draft.variables.push(
      buildVariable({
        type: "text",
        name: `value${number}`,
        label: `Value ${number}`
      })
    );
  }

  function removeVariable(index: number): void {
    draft.variables.splice(index, 1);
  }

  function save(): void {
    onsave({
      ...$state.snapshot(draft),
      ffmpegCommand: isFfmpegEnabled ? draft.ffmpegCommand : undefined
    });
  }
</script>

<section
  class="card" class:default={isDefault} ondragover={e => e.preventDefault()} ondrop={e => {
    e.preventDefault(); ondropped();
  }} role="group">
  <header>
    <div class="heading"><span
      class="handle" aria-label="Drag to reorder" draggable="true" {ondragend} ondragstart={e => {
        e.dataTransfer?.setData("text/plain", preset.id); ondragstart();
      }} role="button" tabindex="-1">⠿</span>
      <label class="title">
        <input
          aria-label="Include in Run checked"
          checked={isChecked}
          onchange={e => onchecked(e.currentTarget.checked)}
          type="checkbox"
        />
        <h2>{preset.label}{isDefault ? " (default)" : ""}</h2>
      </label></div>
    {#if isThisRunning}
      <button class="danger" onclick={oncancel}>Cancel</button>
    {:else}
      <button class="filled" disabled={isBusy} onclick={onrun}>Run</button>
    {/if}
  </header>

  {#if preset.variables.length}
    <div class="fields">
      {#each preset.variables as variable (variable.name)}
        <OptionField label={variable.label}>
          {#if variable.type === "number"}
            <input
              max={variable.max}
              min={variable.min}
              oninput={e => onvalue(variable.name, e.currentTarget.value)}
              step={variable.step}
              type="number"
              value={values[variable.name]}
            />
          {:else if variable.type === "time"}
            <input
              inputmode="numeric"
              oninput={e => onvalue(variable.name, e.currentTarget.value)}
              pattern={TIME_PATTERN.source}
              placeholder="00:00:00"
              type="text"
              value={values[variable.name]}
            />
          {:else if variable.type === "list"}
            <select onchange={e => onvalue(variable.name, e.currentTarget.value)} value={values[variable.name]}>
              {#each variable.options as option (option.value)}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          {:else}
            <input
              oninput={e => onvalue(variable.name, e.currentTarget.value)}
              type="text"
              value={values[variable.name]}
            />
          {/if}
        </OptionField>
      {/each}
    </div>
  {/if}

  <details bind:open={isEditing}>
    <summary>Edit</summary>
    <div class="editor">
      <OptionField label="Name">
        <input bind:value={draft.label} />
      </OptionField>
      <OptionField label="yt-dlp command">
        <textarea rows="3" spellcheck="false" bind:value={draft.command}></textarea>
      </OptionField>
      <label class="check">
        <input type="checkbox" bind:checked={isFfmpegEnabled} />
        Run my own FFmpeg command on the downloaded streams
      </label>
      {#if isFfmpegEnabled}
        <textarea aria-label="FFmpeg command" rows="2" spellcheck="false" bind:value={draft.ffmpegCommand}></textarea>
        <p class="hint">
          {"{input1}"} is the first downloaded stream, {"{input2}"} the second. End with the output file name, like
          snapshot.png. Put %03d in it, like frame%03d.png, to save an image sequence
        </p>
      {/if}

      <h3>Variables</h3>
      <p class="hint">Write %name% in a command to insert the field's value</p>
      {#each draft.variables as variable, index (index)}
        <div class="variable">
          <input class="small" aria-label="Variable name" placeholder="name" bind:value={variable.name} />
          <input aria-label="Field label" placeholder="Label" bind:value={variable.label} />
          <select
            aria-label="Field type" onchange={e => retypeFromValue({
              index,
              raw: e.currentTarget.value
            })} value={variable.type}>
            {#each VARIABLE_TYPES as type (type)}
              <option value={type}>{type}</option>
            {/each}
          </select>
          <button aria-label="Remove variable" onclick={() => removeVariable(index)}>x</button>
          {#if variable.type === "list"}
            <textarea
              aria-label="Options, one label=value per line" onchange={e => applyOptions({
                variable,
                raw: e.currentTarget.value
              })} rows="3" value={formatOptions(variable)}></textarea>
            <select
              aria-label="Default option" onchange={e => applyDefault({
                variable,
                raw: e.currentTarget.value
              })} value={variable.defaultValue}>
              {#each variable.options as option (option.value)}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          {:else if variable.type === "number"}
            <div class="numbers">
              <input
                class="small" aria-label="Default" oninput={e => applyDefault({
                  variable,
                  raw: e.currentTarget.value
                })} type="number" value={variable.defaultValue} />
              <input
                class="small" aria-label="Minimum" oninput={e => applyLimit({
                  variable,
                  key: "min",
                  raw: e.currentTarget.value
                })} placeholder="min" type="number" value={variable.min} />
              <input
                class="small" aria-label="Maximum" oninput={e => applyLimit({
                  variable,
                  key: "max",
                  raw: e.currentTarget.value
                })} placeholder="max" type="number" value={variable.max} />
              <input
                class="small" aria-label="Step" oninput={e => applyLimit({
                  variable,
                  key: "step",
                  raw: e.currentTarget.value
                })} placeholder="step" type="number" value={variable.step} />
            </div>
          {:else}
            <input
              aria-label="Default" oninput={e => applyDefault({
                variable,
                raw: e.currentTarget.value
              })} placeholder="Default" value={variable.defaultValue} />
          {/if}
        </div>
      {/each}
      <button onclick={addVariable}>Add variable</button>

      <div class="row">
        <button onclick={save}>{isBuiltIn ? "Save as my own" : "Save"}</button>
        <button disabled={isDefault} onclick={onsetdefault}>Make default</button>
        <button onclick={onhide}>Hide</button>
        {#if !isBuiltIn}
          <button onclick={ondelete}>Delete</button>
        {/if}
      </div>
    </div>
  </details>
</section>

<style>
  .card {
    display: flex;
    flex-shrink: 0;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border-radius: 20px;
    background: var(--surface);
  }

  .card.default {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  header {
    display: flex;
    gap: 8px;
    justify-content: space-between;
    align-items: center;
  }

  h2,
  h3 {
    font-weight: 600;
    font-size: 0.8125rem;
  }

  .fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .heading {
    display: flex;
    gap: 8px;
    align-items: center;
    min-width: 0;
  }

  .handle {
    color: var(--fg-subtle);
    cursor: grab;
    user-select: none;
  }

  .title {
    display: flex;
    gap: 8px;
    align-items: center;
    min-width: 0;
  }

  .editor {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-block-start: 10px;
  }

  .variable {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto auto;
    gap: 6px;
    padding: 8px;
    border-radius: 12px;
    background: var(--surface-high);
  }

  .variable > :nth-child(n + 5) {
    grid-column: 1 / -1;
  }

  .numbers {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
</style>
