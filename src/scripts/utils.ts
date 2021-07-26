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

function getVisibleElement(elements: NodeListOf<Element>) {
  return [...(elements as NodeListOf<HTMLElement>)].find(
    element => element.offsetWidth > 0 && element.offsetHeight > 0
  );
}

export async function getElementEventually(selector: string): Promise<Element> {
  const elements = document.querySelectorAll(selector);
  return (
    (elements.length > 0 && getVisibleElement(elements)) ||
    (await getElementByObserver(selector))
  );
}

export function getVideoId(url: string): string {
  if (url.includes("/embed/")) {
    return url.split("/").pop();
  }
  const urlParams = new URLSearchParams(new URL(url).search);
  return urlParams.get("v");
}

export function parseText(query: string | number | Record<string, unknown>) {
  try {
    return JSON.parse(query as string);
  } catch {
    if (!isNaN(query as number)) {
      return Number(query);
    }

    if (typeof query !== "string") {
      const obj = {};
      for (const queryKey in query as Record<string, unknown>) {
        if (Object.prototype.hasOwnProperty.call(query, queryKey)) {
          obj[queryKey] = parseText(query[queryKey]);
        }
      }

      return obj;
    }
    if (!query) {
      return "";
    }

    if (query.toLowerCase().match(/^(true|false)$/)) {
      return query.toLowerCase() === "true";
    }

    const object = Object.fromEntries(new URLSearchParams(query));
    const values = Object.values(object);
    if (values.length === 1 && values[0] === "") {
      return query;
    }
    return parseText(object);
  }
}
