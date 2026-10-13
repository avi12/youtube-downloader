<script generics="Value extends string" lang="ts">
  import PolymerSelect from "../polymer-select/PolymerSelect.svelte";
  import OptionHint from "./OptionHint.svelte";
  import { findChoice, type Choice } from "@/lib/utils/choices";

  interface Props {
    id: string;
    label: string;
    disabled: boolean;
    choices: Choice<Value>[];
    choice: Choice<Value>;
    onchange: (value: Value) => void;
  }

  const { id, label, disabled, choices, choice, onchange }: Props = $props();
</script>

<div class="ytdl-choice-select">
  <PolymerSelect
    {id}
    {disabled}
    {label}
    onchange={value => {
      const picked = findChoice(choices, value);
      if (picked) {
        onchange(picked.value);
      }
    }}
    options={choices}
    value={choice.value}
  />
  {#if choice.description}
    <OptionHint text={choice.description} />
  {/if}
</div>

<style>
  .ytdl-choice-select {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
</style>
