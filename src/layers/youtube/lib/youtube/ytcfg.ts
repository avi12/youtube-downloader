export const YtcfgKey = {
  ClientVersion: "INNERTUBE_CLIENT_VERSION",
  ClientName: "INNERTUBE_CONTEXT_CLIENT_NAME",
  VisitorData: "VISITOR_DATA",
  Sts: "STS",
  BotguardExperimentId: "BOTGUARD_EXPERIMENT_ID",
  InnertubeApiKey: "INNERTUBE_API_KEY",
  Hl: "HL",
  Gl: "GL"
} as const;

export type YtcfgKey = (typeof YtcfgKey)[keyof typeof YtcfgKey];

interface YtcfgValueByKey {
  [YtcfgKey.ClientVersion]: string;
  [YtcfgKey.ClientName]: number;
  [YtcfgKey.VisitorData]: string;
  [YtcfgKey.Sts]: number;
  [YtcfgKey.BotguardExperimentId]: string;
  [YtcfgKey.InnertubeApiKey]: string;
  [YtcfgKey.Hl]: string;
  [YtcfgKey.Gl]: string;
}

declare const ytcfg: {
  get: <K extends YtcfgKey>(key: K) => YtcfgValueByKey[K] | undefined;
} | undefined;

export function getYtcfg<K extends YtcfgKey>(key: K): YtcfgValueByKey[K] | undefined {
  return ytcfg?.get(key);
}
