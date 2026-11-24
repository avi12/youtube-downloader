(name) =>
  new Promise((resolve) => {
    chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true }, (infos) =>
      resolve(infos.find((info) => info.name === name)?.id ?? null),
    )
  })
