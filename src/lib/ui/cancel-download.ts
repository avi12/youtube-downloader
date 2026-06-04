import { MessageType, sendMessage } from "@/lib/messaging/messaging";

export async function performCancelDownload(videoIds: string[]) {
  await sendMessage(MessageType.CancelDownload, { videoIds });
}
