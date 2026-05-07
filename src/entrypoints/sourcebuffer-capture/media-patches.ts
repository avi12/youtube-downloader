function patchVolumeAlwaysZero(mediaProto: typeof HTMLMediaElement.prototype) {
  const volumeDesc = Object.getOwnPropertyDescriptor(mediaProto, "volume");
  if (volumeDesc?.set) {
    const originalVolumeSet = volumeDesc.set;
    Object.defineProperty(mediaProto, "volume", {
      ...volumeDesc,
      set(this: HTMLMediaElement) {
        originalVolumeSet.call(this, 0);
      }
    });
  }
}

export function patchVisibilityForScrubFrame() {
  Object.defineProperty(document, "hidden", {
    get: () => false,
    configurable: true
  });
  Object.defineProperty(document, "visibilityState", {
    get: () => "visible",
    configurable: true
  });
}

export function patchMediaElementForIframe() {
  const mediaProto = HTMLMediaElement.prototype;

  const mutedDesc = Object.getOwnPropertyDescriptor(mediaProto, "muted");
  if (mutedDesc?.set) {
    const originalMutedSet = mutedDesc.set;
    Object.defineProperty(mediaProto, "muted", {
      ...mutedDesc,
      set(this: HTMLMediaElement) {
        originalMutedSet.call(this, true);
      }
    });
  }

  patchVolumeAlwaysZero(mediaProto);
}
