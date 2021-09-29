export function getProgress(progress = 0): string {
  return (progress * 100).toFixed(2) + "%";
}