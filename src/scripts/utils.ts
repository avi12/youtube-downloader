export async function setStorage(
  storageArea: "local" | "sync",
  key: string,
  value: unknown
): Promise<void> {
  return new Promise(resolve =>
    chrome.storage[storageArea].set({ [key]: value }, resolve)
  );
}

export async function getStorage(
  storageArea: "local" | "sync",
  key?: string
): Promise<unknown> {
  return new Promise(resolve =>
    chrome.storage[storageArea].get(key, result =>
      resolve(key ? result[key] : result)
    )
  );
}

export async function getElementByObserver(
  selector: string
): Promise<HTMLElement> {
  return new Promise(resolve => {
    const observerHtml = new MutationObserver((_, observer) => {
      const element = document.querySelector(selector);
      if (element) {
        observer.disconnect();
        resolve(element as HTMLElement);
      }
    });
    observerHtml.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  });
}

export function isElementVisible(element: HTMLElement): boolean {
  return element.offsetWidth > 0 && element.offsetHeight > 0;
}

function getVisibleElementInArray(elements: NodeListOf<Element>): HTMLElement {
  return [...(elements as NodeListOf<HTMLElement>)].find(isElementVisible);
}

export async function getElementEventually(selector: string): Promise<Element> {
  const elements = document.querySelectorAll(selector);
  return (
    (elements.length > 0 && getVisibleElementInArray(elements)) ||
    (await getElementByObserver(selector))
  );
}

export function getMediaId(url: string): string {
  const urlParams = new URLSearchParams(new URL(url).search);
  return urlParams.get("v") || urlParams.get("list");
}
