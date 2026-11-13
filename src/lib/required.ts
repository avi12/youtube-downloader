export function required<T>(value: T | null | undefined) {
  if (value == null) {
    throw new Error("Expected a value, got nothing");
  }

  return value;
}
