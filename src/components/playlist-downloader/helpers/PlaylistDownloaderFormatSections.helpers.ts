import { AUTO_EXTENSION, AUTO_EXTENSION_LABEL, getFormatDescription } from "@/lib/utils/containers";

export function formatExtensionLabel(extension: string) {
  if (extension === AUTO_EXTENSION) {
    return AUTO_EXTENSION_LABEL;
  }

  const description = getFormatDescription(extension);
  return description ? `${extension.toUpperCase()} - ${description}` : extension.toUpperCase();
}
