import { attachPrimaryButton, PrimaryButtonState } from "@/lib/ui/panel-button-attachments.svelte";
import { ProgressType } from "@/types";

export { PrimaryButtonState };

export interface FooterParams {
  readonly primaryState: PrimaryButtonState;
  readonly displayProgress: number;
  readonly progressType: string;
  readonly getIsDownloadable: () => boolean;
  readonly getIsFilenameValid: () => boolean;
}

const percentFormatter = new Intl.NumberFormat(document.documentElement.lang || undefined, {
  style: "percent",
  maximumFractionDigits: 0
});

export function createFooterState(params: FooterParams) {
  const downloadingLabel = $derived.by(() => {
    if (params.displayProgress === 0) {
      return "Preparing";
    }

    const formattedPercentage = percentFormatter.format(params.displayProgress / 100);
    if (params.progressType === ProgressType.FFmpeg) {
      return `${formattedPercentage} - Processing`;
    }

    return `${formattedPercentage} - Downloading`;
  });

  function attachPrimaryBtn(elButton: Element) {
    attachPrimaryButton({
      elButton,
      getState: () => params.primaryState,
      getIsDownloadable: params.getIsDownloadable,
      getIsFilenameValid: params.getIsFilenameValid
    });
  }

  return {
    get downloadingLabel() {
      return downloadingLabel;
    },
    attachPrimaryBtn
  };
}
