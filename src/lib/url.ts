export function parseUrl(text: string) {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}
