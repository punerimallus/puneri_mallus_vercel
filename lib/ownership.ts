// Who is making this request, and does a listing/circle belong to them?
// The server must decide this from the login session, never from an email, id or cookie the browser sends.

import { createClient } from '@supabase/supabase-js';
import { checkAdminAccess } from '@/lib/admin';

export interface Identity {
  id: string;
  isAdmin: boolean;
  /** Every email this person is known by (login email, verified business email), lowercase. */
  emails: string[];
  /** Last 10 digits of every phone number on their account. */
  phones: string[];
}

const last10 = (v: unknown): string => {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
};
const lower = (v: unknown): string => String(v ?? '').trim().toLowerCase();

export async function getIdentity(): Promise<Identity | null> {
  const { isAdmin, user } = await checkAdminAccess();
  if (!user) return null;

  const emails = new Set<string>();
  const phones = new Set<string>();
  if (user.email) emails.add(lower(user.email));
  if (user.phone) phones.add(last10(user.phone));

  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const [profile, owners] = await Promise.all([
      db.from('profiles').select('email, phone_number').eq('id', user.id).maybeSingle(),
      db.from('directory_owners').select('verified_email, email').eq('user_id', user.id),
    ]);
    if (profile.data?.email) emails.add(lower(profile.data.email));
    if (profile.data?.phone_number) phones.add(last10(profile.data.phone_number));
    for (const o of (owners.data || []) as { verified_email?: string; email?: string }[]) {
      if (o.verified_email) emails.add(lower(o.verified_email));
      if (o.email) emails.add(lower(o.email));
    }
  } catch {
    // Fall back to what the login session itself knows.
  }
  emails.delete('');
  phones.delete('');
  return { id: user.id, isAdmin, emails: [...emails], phones: [...phones] };
}

/** True when the doc belongs to this person: same user id, or (older cards) same phone number or email. */
export function ownsDoc(doc: Record<string, unknown> | null | undefined, who: Identity | null): boolean {
  if (!doc || !who) return false;
  if (doc.userId && String(doc.userId) === who.id) return true;
  const contact = last10(doc.contact);
  if (contact && who.phones.includes(contact)) return true;
  for (const field of [doc.submittedBy, doc.userEmail]) {
    const e = lower(field);
    if (e && who.emails.includes(e)) return true;
  }
  return false;
}

export const isLive = (doc: Record<string, unknown>): boolean => doc.isApproved === true && doc.isDraft !== true;

/** Fields only the owner or an admin should see. */
const PRIVATE_FIELDS = ['userId', 'userEmail', 'submittedBy', 'verificationDocs'];

export function publicView<T extends Record<string, unknown>>(doc: T): Partial<T> {
  const copy: Record<string, unknown> = { ...doc };
  for (const f of PRIVATE_FIELDS) delete copy[f];
  return copy as Partial<T>;
}

/**
 * What this visitor may see: admins see everything, everyone sees live listings (without private fields),
 * and a logged-in owner also sees their own drafts and pending listings in full.
 */
export function visibleDocs<T extends Record<string, unknown>>(docs: T[], who: Identity | null): Partial<T>[] {
  if (who?.isAdmin) return docs;
  const out: Partial<T>[] = [];
  for (const d of docs) {
    if (ownsDoc(d, who)) out.push(d);
    else if (isLive(d)) out.push(publicView(d));
  }
  return out;
}

/** Fields a normal user must never be able to set on their own listing; only admins change these. */
export const ADMIN_ONLY_FIELDS = ['isApproved', 'isVerified', 'isPremium', 'verificationStatus', 'order', 'approvedBy', 'isRejected', 'userId', 'createdAt', '_id'];

export function stripAdminFields<T extends Record<string, unknown>>(data: T): Partial<T> {
  const copy: Record<string, unknown> = { ...data };
  for (const f of ADMIN_ONLY_FIELDS) delete copy[f];
  return copy as Partial<T>;
}
