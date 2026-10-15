<script generics="Value extends string" lang="ts">
  import OptionField from "./OptionField.svelte";
  import { describeChoice, findChoice, type Choice } from "@/lib/utils/choices";

  type OptionChoice = Choice<Value> & {
    disabled?: boolean;
  };

  interface Props {
    label: string;
    value: string;
    choices: readonly OptionChoice[];
    isDisabled?: boolean;
    onchange: (value: Value) => void;
  }

  const { label, value, choices, isDisabled = false, onchange }: Props = $props();

  // Consecutive choices sharing a group render under one <optgroup>, the way the page's picker lists them
  const sections = $derived(
    choices.reduce<{
      group?: Choice["group"];
      choices: OptionChoice[];
    }[]>((sectionList, choice) => {
      const lastSection = sectionList.at(-1);
      const isSameGroup = lastSection && lastSection.group?.label === choice.group?.label;
      if (isSameGroup) {
        lastSection.choices.push(choice);
        return sectionList;
      }

      sectionList.push({
        group: choice.group,
        choices: [choice]
      });
      return sectionList;
    }, [])
  );
  const description = $derived(describeChoice(findChoice([...choices], value)));
</script>

{#snippet optionList(sectionChoices: OptionChoice[])}
  {#each sectionChoices as choice (choice.value)}
    <option disabled={choice.disabled} value={choice.value}>{choice.label}</option>
  {/each}
{/snippet}

<OptionField hint={description} {label}>
  <select
    class="option-select"
    disabled={isDisabled}
    onchange={e => {
      const choice = findChoice([...choices], e.currentTarget.value);
      if (choice) {
        onchange(choice.value);
      }
    }}
    {value}
  >
    {#each sections as section, iSection (iSection)}
      {#if section.group}
        <optgroup label={section.group.label}>
          {@render optionList(section.choices)}
        </optgroup>
      {:else}
        {@render optionList(section.choices)}
      {/if}
    {/each}
  </select>
</OptionField>

<style>
  .option-select {
    cursor: pointer;
  }
</style>
