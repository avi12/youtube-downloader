<script generics="Value extends string" lang="ts">
  import PolymerSelect from "../polymer-select/PolymerSelect.svelte";
  import OptionHint from "./OptionHint.svelte";
  import { describeChoice, findChoice, type Choice } from "@/lib/utils/choices";

  interface Props {
    id: string;
    label: string;
    disabled: boolean;
    choices: Choice<Value>[];
    value: string;
    onchange: (value: Value) => void;
  }

  const { id, label, disabled, choices, value, onchange }: Props = $props();

  const description = $derived(describeChoice(findChoice(choices, value)));
</script>

<div class="ytdl-choice-select">
  <PolymerSelect
    {id}
    {disabled}
    {label}
    onchange={selected => {
      const choice = findChoice(choices, selected);
      if (choice) {
        onchange(choice.value);
      }
    }}
    options={choices}
    {value}
  />
  {#if description}
    <OptionHint text={description} />
  {/if}
</div>

<style>
  .ytdl-choice-select {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
</style>
