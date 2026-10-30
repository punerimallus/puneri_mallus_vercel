// Who may scan a pass at the gate.
//
// Scanning used to require being in `authorized_admins`, which meant every volunteer on the
// door was handed the whole admin panel: pricing, payments, members, everyone's data. This adds
// a role that can do exactly one thing — admit people — and nothing else.
//
// An admin may scan any event. A volunteer is either global (event_id null) or tied to a single
// event, so someone helping at one show cannot wave people into another.

export type GateRole = 'ADMIN' | 'SCANNER';

/**
 * Members sign in with their phone, and the entry gate creates their account as
 * `<phone>@punerimallus.com`. That ghost address — not their personal one — is the email the
 * gate sees, so a volunteer added as "them@gmail.com" would never match.
 *
 * So the gate list is keyed on the same ghost address. An organiser can type either a phone
 * number or an email, and a 10-digit number is turned into the identifier the account really
 * has. Anyone who signed up with a real email address is unaffected.
 */
export function gateIdentifier(input: string): string | null {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return null;

  // A phone number, however it was typed: +91 98901 22274, 09890122274, 9890122274.
  const digits = raw.replace(/[\s()+-]/g, '');
  const tenDigits = /^(?:\+?91)?0?(\d{10})$/.exec(digits);
  if (tenDigits) return `${tenDigits[1]}@punerimallus.com`;

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return raw;
  return null;
}

/** How to show a gate-list entry back to an organiser: a ghost address reads as the phone. */
export function gateIdentifierLabel(email: string): string {
  const ghost = /^(\d{10})@punerimallus\.com$/.exec(String(email || '').toLowerCase());
  return ghost ? ghost[1] : email;
}

export interface GateActor {
  role: GateRole;
  email: string;
  userId: string | null;
  /** null for an admin or a global volunteer; otherwise the one event they may scan. */
  eventId: string | null;
}

export interface StaffRow {
  email: string;
  role: string;
  event_id: string | null;
  active: boolean;
}

export interface StaffDb {
  from(table: string): {
    select(cols: string): {
      ilike(col: string, val: string): PromiseLike<{ data: StaffRow[] | null; error: { message: string } | null }>;
    };
  };
}

/**
 * Decide what this signed-in person may scan.
 *
 * `isAdmin` comes from the existing admin check. Volunteer rows are matched on the email
 * case-insensitively, the same way admins are.
 */
export async function resolveGateActor(
  db: StaffDb,
  user: { id: string; email?: string } | null,
  isAdmin: boolean,
): Promise<GateActor | null> {
  if (!user) return null;
  if (isAdmin) return { role: 'ADMIN', email: user.email || '', userId: user.id, eventId: null };
  if (!user.email) return null;

  const { data, error } = await db.from('event_staff').select('email, role, event_id, active').ilike('email', user.email);
  if (error) {
    // Never fall open: if we cannot tell, this person is not staff.
    return null;
  }
  const rows = (data || []).filter((r) => r.active && r.role === 'SCANNER');
  if (rows.length === 0) return null;

  // A global row beats an event-scoped one.
  const global = rows.find((r) => !r.event_id);
  return {
    role: 'SCANNER',
    email: user.email,
    userId: user.id,
    eventId: global ? null : rows[0].event_id,
  };
}

/** May this actor scan a pass belonging to `eventId`? */
export function canScanEvent(actor: GateActor, eventId: string | null | undefined): boolean {
  if (actor.role === 'ADMIN') return true;
  if (!actor.eventId) return true;
  return !!eventId && actor.eventId === eventId;
}

/**
 * May this actor let part of a group in and leave the rest outside?
 *
 * Admins only. See ScanOptions.allowPartial in scan.ts for why.
 */
export function partialAdmitAllowed(actor: Pick<GateActor, 'role'>): boolean {
  return actor.role === 'ADMIN';
}

/** Which events an event-scoped volunteer is limited to, for display. */
export function scopeLabel(actor: GateActor): string {
  if (actor.role === 'ADMIN') return 'All events (admin)';
  return actor.eventId ? 'One event' : 'All events';
}
