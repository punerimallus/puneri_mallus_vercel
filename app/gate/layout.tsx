import React from 'react';
import { redirect } from 'next/navigation';
import { checkAdminAccess } from '@/lib/admin';
import { supabaseAdmin } from '@/lib/payments/server';
import { resolveGateActor, StaffDb } from '@/lib/payments/staff';

/**
 * The gate lives outside /admin on purpose.
 *
 * Scanning used to sit at /admin/scanner, under a layout that redirects anyone who is not a
 * full admin — so letting a volunteer scan meant making them an admin, handing them pricing,
 * payments and every member's details. Here, an admin OR anyone on the gate list gets in, and
 * the gate list can do nothing else.
 */
export default async function GateLayout({ children }: { children: React.ReactNode }) {
  const { isAdmin, user } = await checkAdminAccess();

  if (!user) redirect('/auth/login?next=/gate');

  const actor = await resolveGateActor(supabaseAdmin() as unknown as StaffDb, user, isAdmin);
  if (!actor) redirect('/gate/not-authorised');

  return <section className="bg-[#030303] min-h-screen text-white">{children}</section>;
}
