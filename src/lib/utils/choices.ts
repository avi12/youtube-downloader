import type { Prettify } from "@/types";

export type Choice<Value extends string = string> = {
  value: Value;
  label: string;
  description?: string;
};

type ChoiceText = Prettify<{
  label: string;
  description?: string;
}>;

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

// For pickers with no room for a second line (YouTube's Polymer selects)
export function toInlineLabeledOption({ value, label, description }: Choice) {
  return {
    value,
    label: description ? `${label} - ${description}` : label
  };
}
