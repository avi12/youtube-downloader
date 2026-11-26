import { z } from "@/lib/zod";
import { createGuard } from "@/lib/zod-guard";

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

const isString = createGuard(z.string());
const isNumber = createGuard(z.number());

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

const YTCFG_VALUE_GUARDS: { [KeyName in YtcfgKey]: (value: unknown) => value is YtcfgValueByKey[KeyName] } = {
  [YtcfgKey.ClientVersion]: isString,
  [YtcfgKey.ClientName]: isNumber,
  [YtcfgKey.VisitorData]: isString,
  [YtcfgKey.Sts]: isNumber,
  [YtcfgKey.BotguardExperimentId]: isString,
  [YtcfgKey.InnertubeApiKey]: isString,
  [YtcfgKey.Hl]: isString,
  [YtcfgKey.Gl]: isString
};

declare const ytcfg: {
  get: (key: YtcfgKey) => unknown;
} | undefined;

export function getYtcfg<KeyName extends YtcfgKey>(key: KeyName) {
  const value = ytcfg?.get(key);
  const isExpectedValue: (typeof YTCFG_VALUE_GUARDS)[KeyName] = YTCFG_VALUE_GUARDS[key];
  return isExpectedValue(value) ? value : undefined;
}
