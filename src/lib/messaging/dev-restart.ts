declare global {
  // The dev server's content script restart removes these; undefined in a production build
  var ytdlDevRunDisposers: (() => void)[] | undefined;
}

/** Lets the dev server drop the handlers a content script run registered before it runs again. */
export function disposeOnRestart<TMessenger extends { onMessage: (...args: never[]) => () => void }>(messenger: TMessenger) {
  const onMessage = messenger.onMessage;
  messenger.onMessage = (...args: never[]) => {
    const remove = onMessage(...args);
    globalThis.ytdlDevRunDisposers?.push(remove);
    return remove;
  };
  return messenger;
}
