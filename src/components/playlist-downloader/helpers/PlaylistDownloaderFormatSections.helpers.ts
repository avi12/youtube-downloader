import { AUTO_EXTENSION, AUTO_EXTENSION_LABEL } from "@/lib/utils/containers";

export function formatExtensionLabel(extension: string) {
  return extension === AUTO_EXTENSION ? AUTO_EXTENSION_LABEL : extension.toUpperCase();
}
