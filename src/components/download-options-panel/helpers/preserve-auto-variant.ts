export function preserveAutoVariant<T>({ item, isAuto, matchesPlayer, globalIncludes }: {
  item: T;
  isAuto: (item: T) => boolean;
  matchesPlayer: (item: T) => boolean;
  globalIncludes: boolean;
}) {
  if (!isAuto(item)) {
    return true;
  }

  if (globalIncludes) {
    return true;
  }

  return matchesPlayer(item);
}
