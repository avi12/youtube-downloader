import {
  attachPrimaryButton as attachPrimaryButtonElement,
  PrimaryButtonState
} from "@/lib/ui/panel-button-attachments.svelte";
import { ProgressType } from "@/types";

export { PrimaryButtonState };

export interface FooterParams {
  readonly primaryState: PrimaryButtonState;
  readonly displayProgress: number;
  readonly progressType: string;
  readonly getIsDownloadable: () => boolean;
  readonly getIsFilenameValid: () => boolean;
  readonly estimatedSizeLabel: string;
}

const PERCENT_FORMATTER = new Intl.NumberFormat(document.documentElement.lang || undefined, {
  style: "percent",
  maximumFractionDigits: 0
});

export function createFooterState(params: FooterParams) {
  const downloadingLabel = $derived.by(() => {
    const isProgressZero = params.displayProgress === 0;
    if (isProgressZero) {
      return "Preparing";
    }

    const formattedPercentage = PERCENT_FORMATTER.format(params.displayProgress / 100);
    const isFfmpegProgress = params.progressType === ProgressType.FFmpeg;
    if (isFfmpegProgress) {
      return `${formattedPercentage} - Processing`;
    }

    return `${formattedPercentage} - Downloading`;
  });

  function attachPrimaryButton(elButton: Element) {
    attachPrimaryButtonElement({
      elButton,
      getState: () => params.primaryState,
      getIsDownloadable: params.getIsDownloadable,
      getIsFilenameValid: params.getIsFilenameValid,
      getEstimatedSizeLabel: () => params.estimatedSizeLabel
    });
  }

  return {
    get downloadingLabel() {
      return downloadingLabel;
    },
    attachPrimaryButton
  };
}
