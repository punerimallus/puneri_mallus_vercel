"use client";
import { LogIn, ScanLine } from 'lucide-react';

/**
 * Shown at the gate when nobody is signed in.
 *
 * The site-wide entry gate (GlobalEntryGate, mounted in the root layout) renders on this page
 * and opens its phone sign-in the moment anything is clicked. So the button below does not need
 * to navigate anywhere — clicking it is what brings up the sign-in everyone else uses. Sending
 * them to /auth/login instead would be a dead end: that page is admin-only and signs a volunteer
 * straight back out.
 */
export default function GateSignIn() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-sm w-full text-center space-y-7">
        <ScanLine size={56} className="text-brandRed mx-auto" />

        <div className="space-y-2">
          <h1 className="text-2xl font-black uppercase tracking-widest">Gate scanner</h1>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Sign in with the phone number the organisers added to the gate list, then scan the
            pass again.
          </p>
        </div>

        {/* Any click opens the site-wide phone sign-in. */}
        <button
          type="button"
          className="w-full bg-brandRed text-white py-5 rounded-2xl font-black uppercase tracking-widest text-xs active:scale-95 transition-all flex items-center justify-center gap-2 shadow-[0_0_30px_rgba(255,0,0,0.25)]"
        >
          <LogIn size={15} /> Sign in to scan
        </button>

        <p className="text-[11px] text-zinc-600 leading-relaxed">
          Not on the list yet? Ask an organiser to add you in Admin → Gate Volunteers.
        </p>
      </div>
    </div>
  );
}
