import { z } from "@/lib/zod";
import { createLazyGuard } from "@/lib/zod-guard";

/** Type guards for the DOM classes the extension tells apart, in the same zod form as the page-object guards */
export const isElement = createLazyGuard(() => z.instanceof(Element));
export const isHtmlElement = createLazyGuard(() => z.instanceof(HTMLElement));
export const isInputElement = createLazyGuard(() => z.instanceof(HTMLInputElement));
export const isNode = createLazyGuard(() => z.instanceof(Node));
export const isSelectElement = createLazyGuard(() => z.instanceof(HTMLSelectElement));
export const isButtonElement = createLazyGuard(() => z.instanceof(HTMLButtonElement));
export const isAnchorElement = createLazyGuard(() => z.instanceof(HTMLAnchorElement));
export const isKeyboardEvent = createLazyGuard(() => z.instanceof(KeyboardEvent));
export const isToggleEvent = createLazyGuard(() => z.instanceof(ToggleEvent));
export const isCustomEvent = createLazyGuard(() => z.instanceof(CustomEvent));
export const isVttCue = createLazyGuard(() => z.instanceof(VTTCue));
export const isRequest = createLazyGuard(() => z.instanceof(Request));
export const isHeaders = createLazyGuard(() => z.instanceof(Headers));
export const isDomException = createLazyGuard(() => z.instanceof(DOMException));
export const isVideoElement = createLazyGuard(() => z.instanceof(HTMLVideoElement));
export const isBlob = createLazyGuard(() => z.instanceof(Blob));
export const isIframeElement = createLazyGuard(() => z.instanceof(HTMLIFrameElement));
export const isScriptElement = createLazyGuard(() => z.instanceof(HTMLScriptElement));
