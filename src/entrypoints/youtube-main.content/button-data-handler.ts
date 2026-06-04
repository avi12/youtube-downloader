import { CrossWorldMessage, crossWorldMessenger, dispatchButtonClick } from "@/lib/messaging/cross-world-messenger";
import { DATA_BUTTON_ID_ATTR } from "@/lib/ui/polymer-utils";
import { isYtButtonViewModelElement } from "@/lib/youtube/schemas";
import { ButtonStyle } from "@/types";

const ATTR_CTA = "data-ytdl-cta";
const ATTR_CLICK_BOUND = "data-ytdl-click-bound";
const ATTR_ROLE = "role";
const ATTR_ARIA_CHECKED = "aria-checked";
const INNER_BUTTON_TAG = "button";

const buttonIdByElement = new WeakMap<HTMLElement, string>();

export function registerButtonDataHandler() {
  crossWorldMessenger.onMessage(CrossWorldMessage.SetButtonData, ({ data: { selector, data: buttonData, a11y } }) => {
    const elButton = document.querySelector(selector);
    if (!isYtButtonViewModelElement(elButton)) {
      return;
    }

    const buttonId = elButton.getAttribute(DATA_BUTTON_ID_ATTR);
    if (buttonId) {
      buttonIdByElement.set(elButton, buttonId);
    }

    elButton.data = buttonData;
    elButton.toggleAttribute(ATTR_CTA, buttonData.style === ButtonStyle.CallToAction);

    const cachedId = buttonIdByElement.get(elButton);
    const isButtonIdStale = cachedId && elButton.getAttribute(DATA_BUTTON_ID_ATTR) !== cachedId;
    if (isButtonIdStale) {
      elButton.setAttribute(DATA_BUTTON_ID_ATTR, cachedId);
    }

    queueMicrotask(() => {
      const elInner = elButton.querySelector(INNER_BUTTON_TAG);
      if (!elInner) {
        return;
      }

      if (a11y) {
        elInner.tabIndex = a11y.tabIndex;
        elInner.setAttribute(ATTR_ROLE, a11y.role);
        elInner.setAttribute(ATTR_ARIA_CHECKED, a11y.ariaChecked);
      }

      if (!elInner.hasAttribute(ATTR_CLICK_BOUND)) {
        elInner.setAttribute(ATTR_CLICK_BOUND, "true");
        elInner.addEventListener("click", e => {
          const currentButtonId = buttonIdByElement.get(elButton);
          if (currentButtonId) {
            e.stopPropagation();
            dispatchButtonClick(currentButtonId);
          }
        });
      }
    });

    if (elButton.hasAttribute(ATTR_CLICK_BOUND)) {
      return;
    }

    elButton.setAttribute(ATTR_CLICK_BOUND, "true");
    elButton.addEventListener("click", e => {
      const currentButtonId = buttonIdByElement.get(elButton);
      if (currentButtonId) {
        e.stopPropagation();
        dispatchButtonClick(currentButtonId);
      }
    });
  });
}
