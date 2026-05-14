import { CrossWorldMessage, crossWorldMessenger, dispatchButtonClick } from "@/lib/messaging/cross-world-messenger";
import { DATA_BUTTON_ID_ATTR } from "@/lib/ui/polymer-utils";

const buttonIdByElement = new WeakMap<HTMLElement, string>();

export function registerButtonDataHandler() {
  crossWorldMessenger.onMessage(CrossWorldMessage.SetButtonData, ({ data: { selector, data: buttonData, a11y } }) => {
    const elButton = document.querySelector<HTMLElement>(selector);
    if (!elButton || !("data" in elButton)) {
      return;
    }

    const buttonId = elButton.getAttribute(DATA_BUTTON_ID_ATTR);
    if (buttonId) {
      buttonIdByElement.set(elButton, buttonId);
    }

    elButton.data = buttonData;

    const cachedId = buttonIdByElement.get(elButton);
    const isButtonIdStale = cachedId && elButton.getAttribute(DATA_BUTTON_ID_ATTR) !== cachedId;
    if (isButtonIdStale) {
      elButton.setAttribute(DATA_BUTTON_ID_ATTR, cachedId);
    }

    if (a11y) {
      queueMicrotask(() => {
        const elInner = elButton.querySelector("button");
        if (!elInner) {
          return;
        }

        elInner.tabIndex = a11y.tabIndex;
        elInner.setAttribute("role", a11y.role);
        elInner.setAttribute("aria-checked", a11y.ariaChecked);
      });
    }

    if (elButton.hasAttribute("data-ytdl-click-bound")) {
      return;
    }

    elButton.setAttribute("data-ytdl-click-bound", "true");
    elButton.addEventListener("click", e => {
      const currentButtonId = buttonIdByElement.get(elButton);
      if (currentButtonId) {
        e.stopPropagation();
        dispatchButtonClick(currentButtonId);
      }
    });
  });
}
