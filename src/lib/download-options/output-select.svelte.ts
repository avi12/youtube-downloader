import { buildFormatItems, getFilenameError } from "./download-options-helpers";
import { getFormatDescription } from "@/lib/utils/containers";
import { DownloadType } from "@/types";

export type OutputSelectProps = {
  filename: string;
  extension: string;
  actualExtension: string;
  downloadType: DownloadType;
  isMultiTrack: boolean;
};

export function createOutputSelectState(props: () => OutputSelectProps) {
  const extensionType = $derived(props().downloadType === DownloadType.Audio ? DownloadType.Audio : DownloadType.Video);
  const filenameError = $derived(
    getFilenameError({
      value: `${props().filename}.${props().extension}`,
      type: extensionType,
      isMultiTrack: props().isMultiTrack
    })
  );
  const formatOptions = $derived(
    buildFormatItems(extensionType, props().isMultiTrack).map(item => ({
      value: item.ext,
      label: `.${item.ext}`,
      disabled: item.isExcluded
    }))
  );

  return {
    get filenameError() {
      return filenameError;
    },
    get isFilenameValid() {
      return !filenameError;
    },
    get formatOptions() {
      return formatOptions;
    },
    get formatDescription() {
      return getFormatDescription(props().extension);
    },
    get isConstraintHintShown() {
      return props().extension !== props().actualExtension && !!filenameError;
    }
  };
}
