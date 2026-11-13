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
  get: <KeyName extends YtcfgKey>(key: KeyName) => YtcfgValueByKey[KeyName] | undefined;
} | undefined;

export function getYtcfg<KeyName extends YtcfgKey>(key: KeyName) {
  return ytcfg?.get(key);
}
