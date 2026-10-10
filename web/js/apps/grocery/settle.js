// Shared by the grocery app and widget: a tick shows straight away, waits a
// moment (so a second tap can undo it), then is sent.
import { haptic, toast } from '../../ui.js';

const SETTLE_MS = 420;

// Taps waiting to be sent: id -> { timer, done }. Bounded by the items on the list.
const settling = new Map();

export function shownDone(item) {
  return settling.has(item.id) ? settling.get(item.id).done : item.done;
}

export function toggleItem(list, itemId, render) {
  const item = list.getItems().find((i) => i.id === itemId);
  if (!item) return;
  const waiting = settling.get(itemId);
  if (waiting) {
    // Second tap before it settled: treat it as "never mind".
    clearTimeout(waiting.timer);
    settling.delete(itemId);
    render(item.done);
    return;
  }
  const done = !item.done;
  haptic();
  render(done);
  const timer = setTimeout(() => {
    settling.delete(itemId);
    list.setDone(itemId, done).catch((err) => {
      toast(err.message);
      const latest = list.getItems().find((i) => i.id === itemId);
      if (latest) render(latest.done);
    });
  }, SETTLE_MS);
  settling.set(itemId, { timer, done });
}

export function toBuyOf(items) {
  return items.filter((i) => !i.done || settling.has(i.id));
}

export function boughtOf(items) {
  return items
    .filter((i) => i.done && !settling.has(i.id))
    .sort((a, b) => String(b.checked).localeCompare(String(a.checked)));
}
