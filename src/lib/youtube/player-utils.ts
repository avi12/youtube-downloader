import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";

export async function waitForVideoElement(signal?: AbortSignal) {
  return new Promise<HTMLVideoElement>((resolve, reject) => {
    const observer = new MutationObserver(() => {
      const elVideo = document.querySelector<HTMLVideoElement>("video");
      const isVideoReady = !!elVideo && elVideo.videoHeight > 0;
      if (!isVideoReady) {
        return;
      }

      observer.disconnect();
      resolve(elVideo);
    });

    observer.observe(document.body, CHILD_LIST_SUBTREE);

    signal?.addEventListener("abort", () => {
      observer.disconnect();
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}
