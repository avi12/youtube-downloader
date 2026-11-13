export function sumOf(numbers: number[]) {
  let total = 0;
  for (const value of numbers) {
    total += value;
  }

  return total;
}
