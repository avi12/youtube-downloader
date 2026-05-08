// Typed wrapper around YouTube's window-level `ytcfg` config object.
// `ytcfg` is injected by the YouTube page itself; only available inside
// MAIN-world content scripts running on a YouTube document.

interface YtcfgValueByKey {
  INNERTUBE_CLIENT_VERSION: string;
  INNERTUBE_CONTEXT_CLIENT_NAME: number;
  VISITOR_DATA: string;
  STS: number;
  BOTGUARD_EXPERIMENT_ID: string;
}

type YtcfgKey = keyof YtcfgValueByKey;

declare const ytcfg: {
  get: <K extends YtcfgKey>(key: K) => YtcfgValueByKey[K] | undefined;
} | undefined;

export function getYtcfg<K extends YtcfgKey>(key: K): YtcfgValueByKey[K] | undefined {
  return ytcfg?.get(key);
}
