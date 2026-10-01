const MENU_ITEM_BLINK_PHASE_MS = 90;

const waitForBlinkPhase = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, MENU_ITEM_BLINK_PHASE_MS));

/**
 * Blinks a chosen menu item once, highlight off and then on again, so the menu
 * confirms which item was picked before it closes, as macOS menus do. The item's
 * stylesheet renders `data-blink="off"` and `data-blink="on"`.
 *
 * Returns null while the item is already blinking, so a double click commits once.
 */
export function blinkMenuItem(item: HTMLElement): Promise<void> | null {
  if (item.dataset.blink) return null;
  item.dataset.blink = 'off';
  return waitForBlinkPhase()
    .then(() => {
      item.dataset.blink = 'on';
      return waitForBlinkPhase();
    })
    .then(() => {
      delete item.dataset.blink;
    });
}
