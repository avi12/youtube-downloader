const RANGE_SEPARATOR = ":";
const DEFAULT_STEP = 1;

type IndexRequest = {
  text: string;
  count: number;
  fallback: number;
};
type PartRequest = {
  part: string;
  count: number;
};
export type PlaylistSelection = {
  count: number;
  spec: string | undefined;
  start: number | undefined;
  end: number | undefined;
};

function resolveIndex({ text, count, fallback }: IndexRequest) {
  if (text === "") {
    return fallback;
  }

  const value = Number(text);
  if (Number.isNaN(value)) {
    throw new Error(`Bad --playlist-items value: ${text}`);
  }

  return value < 0 ? count + value + 1 : value;
}

function expandPart({ part, count }: PartRequest) {
  if (!part.includes(RANGE_SEPARATOR)) {
    return [resolveIndex({
      text: part,
      count,
      fallback: 1
    })];
  }

  const [startText = "", endText = "", stepText = ""] = part.split(RANGE_SEPARATOR);
  const step = Number(stepText || DEFAULT_STEP);
  const start = resolveIndex({
    text: startText,
    count,
    fallback: 1
  });
  const end = resolveIndex({
    text: endText,
    count,
    fallback: count
  });
  const indices: number[] = [];
  for (let index = start; step > 0 ? index <= end : index >= end; index += step) {
    indices.push(index);
  }

  return indices;
}

export function selectPlaylistIndices({ count, spec, start, end }: PlaylistSelection) {
  if (spec) {
    const indices = spec.split(",").flatMap(part => expandPart({
      part: part.trim(),
      count
    }));
    return [...new Set(indices)].filter(index => index >= 1 && index <= count);
  }

  const first = Math.max(start ?? 1, 1);
  const last = Math.min(end ?? count, count);
  return Array.from({ length: Math.max(last - first + 1, 0) }, (_, offset) => first + offset);
}

export function shuffle<Item>(items: Item[]) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex]!, copy[index]!];
  }

  return copy;
}
