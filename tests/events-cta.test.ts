import { describe, expect, it, vi } from 'vitest';
import { CTA_MAX_LENGTH, DEFAULT_CTA, ctaLabel, eventTarget, isInternalTicketing } from '@/lib/events/cta';
import { onEnter } from '@/lib/ui/enter';

describe('event button text', () => {
  it('uses what the admin typed, tidied up', () => {
    expect(ctaLabel('Book Now')).toBe('Book Now');
    expect(ctaLabel('  Reserve   my  seat ')).toBe('Reserve my seat');
  });
  it('falls back to "Register Now" for old events and blank values', () => {
    for (const v of [undefined, null, '', '   ']) expect(ctaLabel(v)).toBe(DEFAULT_CTA);
  });
  it('caps the length so a long label cannot break the card', () => {
    expect(ctaLabel('x'.repeat(100))).toHaveLength(CTA_MAX_LENGTH);
  });
});

describe('where an event card sends people', () => {
  it('opens our box office for internal ticketing, whatever the casing or spacing', () => {
    expect(isInternalTicketing(' internal ')).toBe(true);
    expect(eventTarget({ _id: 'e1', ticketUrl: 'INTERNAL' })).toEqual({ href: '/events/e1/book', external: false });
  });
  it('opens an external link in a new tab', () => {
    expect(eventTarget({ _id: 'e1', ticketUrl: 'https://in.bookmyshow.com/x' })).toEqual({ href: 'https://in.bookmyshow.com/x', external: true });
  });
  it('has nowhere to go when no ticketing is set up', () => {
    expect(eventTarget({ _id: 'e1', ticketUrl: '' })).toBeNull();
    expect(eventTarget({ _id: 'e1' })).toBeNull();
  });
});

describe('Enter key helper', () => {
  const key = (over: Record<string, unknown> = {}) => ({ key: 'Enter', shiftKey: false, defaultPrevented: false, nativeEvent: { isComposing: false }, target: { tagName: 'INPUT' }, preventDefault: vi.fn(), ...over }) as any;

  it('runs the action on Enter in a text field', () => {
    const run = vi.fn(); const e = key();
    onEnter(run)(e);
    expect(run).toHaveBeenCalledOnce();
    expect(e.preventDefault).toHaveBeenCalled();
  });
  it('does nothing while the button would be disabled, but still stops a stray form submit', () => {
    const run = vi.fn(); const e = key();
    onEnter(run, false)(e);
    expect(run).not.toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalled();
  });
  it('ignores other keys, buttons, text areas, and mid-word typing', () => {
    const run = vi.fn();
    onEnter(run)(key({ key: 'a' }));
    onEnter(run)(key({ target: { tagName: 'BUTTON' } }));
    onEnter(run)(key({ target: { tagName: 'TEXTAREA' } }));
    onEnter(run)(key({ nativeEvent: { isComposing: true } }));
    onEnter(run)(key({ shiftKey: true }));
    expect(run).not.toHaveBeenCalled();
  });
  it('does not fire twice when a field and its container both handle Enter', () => {
    const inner = vi.fn(); const outer = vi.fn(); const e = key();
    onEnter(inner)(e);
    e.defaultPrevented = true; // what the browser reports after the field's handler ran
    onEnter(outer)(e);
    expect(inner).toHaveBeenCalledOnce();
    expect(outer).not.toHaveBeenCalled();
  });
});
