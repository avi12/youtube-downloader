type PreserveAutoVariantParams<T> = {
  item: T;
  isAuto: (item: T) => boolean;
  matchesPlayer: (item: T) => boolean;
  globalIncludes: boolean;
};
export function preserveAutoVariant<T>({ item, isAuto, matchesPlayer, globalIncludes }: PreserveAutoVariantParams<T>) {
  if (!isAuto(item)) {
    return true;
  }

  if (globalIncludes) {
    return true;
  }

  return matchesPlayer(item);
}
