import type { CrossWorldMessage, PageMessengerSchema } from "@/lib/messaging/cross-world-messenger";
import type { SizeInputs } from "@/lib/youtube/output-size";
import type { Prettify } from "@/types";

type PageMessageData<Message extends keyof PageMessengerSchema> = Parameters<PageMessengerSchema[Message]>[0];

export type SizeInputsRequest = PageMessageData<typeof CrossWorldMessage.MeasureSizeInputs>;
export type PanelSelection = PageMessageData<typeof CrossWorldMessage.FilenameChanged>;
export type PanelDownloadRequest = PageMessageData<typeof CrossWorldMessage.DownloadRequest>;

// Where the panel runs: the YouTube page measures and mirrors the pick on its own player, while the popup
// only starts the download, so its size estimate stays approximate
export type PanelHost = Prettify<{
  measureSizeInputs?: (request: SizeInputsRequest) => Promise<SizeInputs | null>;
  announceSelection?: (selection: PanelSelection) => void;
  requestDownload: (request: PanelDownloadRequest) => void;
}>;
