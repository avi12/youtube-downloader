import type { LabeledOption } from "@/types";

export type ChoiceText = {
  label: string;
  description?: string;
};

// A grouped choice reads as "row · group" once picked; its group carries the shared description
export type Choice<Value extends string = string> = LabeledOption<Value> & Pick<ChoiceText, "description"> & {
  group?: ChoiceText;
};

// Every setting picker reads its options from one { value: { label, description } } table,
// so adding a codec or container is one table entry
export function listChoices<Value extends string>({ values, texts }: {
  values: readonly Value[];
  texts: Record<Value, ChoiceText>;
}): Choice<Value>[] {
  return values.map(value => ({
    value,
    label: texts[value].label,
    description: texts[value].description
  }));
}

export function findChoice<Value extends string>(choices: Choice<Value>[], value: string) {
  return choices.find(choice => choice.value === value);
}

export function formatChoiceLabel({ label, group }: Choice) {
  return group ? `${label} · ${group.label}` : label;
}

export function describeChoice(choice: Choice | undefined) {
  return choice?.description ?? choice?.group?.description;
}

// Keeps each group's rows together, groups in order of their first row
export function groupChoices<Item extends Choice>(choices: Item[]) {
  return [...Map.groupBy(choices, choice => choice.group?.label).values()].flat();
}

// For pickers with no room for a second line (YouTube's Polymer selects)
export function toInlineLabeledOption({ value, label, description }: Choice) {
  return {
    value,
    label: description ? `${label} - ${description}` : label
  };
}
