import { type AdaptiveFormatItem } from "@/types";
import { decryptSignatureCipher } from "#youtube/lib/youtube/signature-decryptor";

export async function resolveFormatUrl(format: AdaptiveFormatItem | null) {
  if (!format) {
    return null;
  }

  if (format.url) {
    return format.url;
  }

  if (format.signatureCipher) {
    return decryptSignatureCipher(format.signatureCipher);
  }

  return null;
}
