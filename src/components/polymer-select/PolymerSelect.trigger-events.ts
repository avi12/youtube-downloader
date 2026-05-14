export function attachSelectTrigger(
  elTarget: HTMLElement,
  onTrigger: () => void,
  onOpenStart: () => void
) {
  function handleClick(e: Event) {
    e.stopPropagation();
    onTrigger();
  }

  function handleKeydown(e: Event) {
    if (!(e instanceof KeyboardEvent)) {
      return;
    }

    const isActivationKey = e.key === "ArrowDown" || e.key === "Enter" || e.key === " ";
    if (isActivationKey) {
      e.preventDefault();
      onOpenStart();
    }
  }

  elTarget.addEventListener("click", handleClick);
  elTarget.addEventListener("keydown", handleKeydown);
  return () => {
    elTarget.removeEventListener("click", handleClick);
    elTarget.removeEventListener("keydown", handleKeydown);
  };
}
