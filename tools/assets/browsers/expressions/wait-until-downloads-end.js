async (isDownloading, waitMilliseconds) => {
  if (!await isDownloading()) {
    return true;
  }

  const { onChanged } = (globalThis.browser ?? globalThis.chrome).storage.local;
  return new Promise(resolve => {
    let timeout;
    const settle = hasEnded => {
      onChanged.removeListener(check);
      clearTimeout(timeout);
      resolve(hasEnded);
    };
    const check = async () => {
      if (!await isDownloading()) {
        settle(true);
      }
    };
    timeout = setTimeout(() => settle(false), waitMilliseconds);
    onChanged.addListener(check);
    // A download may have ended before the listener was added
    check();
  });
}
