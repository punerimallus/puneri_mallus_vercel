import React from 'react';
import { checkAdminAccess } from '@/lib/admin';
import { supabaseAdmin } from '@/lib/payments/server';
import { resolveGateActor, StaffDb } from '@/lib/payments/staff';
import GateSignIn from './GateSignIn';
import NotOnGateList from './NotOnGateList';

/**
 * The gate lives outside /admin on purpose.
 *
 * Scanning used to sit at /admin/scanner, under a layout that redirects anyone who is not a full
 * admin — so letting a volunteer scan meant making them an admin, handing them pricing, payments
 * and every member's details. Here, an admin OR anyone on the gate list gets in, and the gate
 * list can do nothing else.
 *
 * Note it does NOT redirect a signed-out visitor to /auth/login. That page is the admin login: it
 * signs you in, checks `authorized_admins`, and signs you straight back out if you are not one —
 * so sending a volunteer there guaranteed they could never reach the gate. Members sign in with
 * their phone through the site-wide entry gate, which renders on this page, so a signed-out
 * volunteer is shown a prompt here instead and signs in where everyone else does.
 */
export default async function GateLayout({ children }: { children: React.ReactNode }) {
  const { isAdmin, user } = await checkAdminAccess();

  if (!user) {
    return (
      <section className="bg-[#030303] min-h-screen text-white">
        <GateSignIn />
      </section>
    );
  }

  const actor = await resolveGateActor(supabaseAdmin() as unknown as StaffDb, user, isAdmin);
  if (!actor) {
    return (
      <section className="bg-[#030303] min-h-screen text-white">
        <NotOnGateList email={user.email ?? ''} />
      </section>
    );
  }

  return <section className="bg-[#030303] min-h-screen text-white">{children}</section>;
}
