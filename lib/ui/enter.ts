import type { KeyboardEvent } from 'react';

/**
 * onKeyDown handler that runs `action` when Enter is pressed in a text field, so a screen without a
 * <form> still submits with the keyboard. Does nothing while an input method (e.g. a phone keyboard
 * composing text) is mid-word, or when `enabled` is false (the same condition that disables the button).
 */
export const onEnter = (action: () => void, enabled = true) => (e: KeyboardEvent<HTMLElement>) => {
  if (e.key !== 'Enter' || e.shiftKey || e.defaultPrevented || e.nativeEvent.isComposing) return; // a field's own handler wins over its container's
  // Buttons, links, selects and multi-line boxes already do the right thing with Enter themselves.
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'BUTTON' || tag === 'A' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  e.preventDefault();
  if (enabled) action();
};
