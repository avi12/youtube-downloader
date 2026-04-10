import { decryptSignatureCipher } from "@/lib/signature-decryptor";
import { type AdaptiveFormatItem } from "@/types";

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
