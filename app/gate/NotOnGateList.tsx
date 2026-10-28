"use client";
import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';

/**
 * Shown when someone is signed in but is not on the gate list.
 *
 * It prints the identifier their account actually has, because that is the thing an organiser
 * has to add. Members who signed up by phone have an account email of
 * `<phone>@punerimallus.com`, not their personal address, and guessing wrong is the single most
 * likely reason a volunteer is turned away here.
 */
export default function NotOnGateList({ email }: { email: string }) {
  const phone = /^(\d{10})@punerimallus\.com$/.exec(email || '');

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-sm w-full text-center space-y-6">
        <ShieldAlert size={56} className="text-brandRed mx-auto" />

        <div className="space-y-2">
          <h1 className="text-2xl font-black uppercase tracking-widest">Not on the gate list</h1>
          <p className="text-sm text-zinc-400 leading-relaxed">
            You are signed in, but this account has not been added as a gate scanner.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/40 p-4 space-y-1.5 text-left">
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
            Give an organiser {phone ? 'this number' : 'this address'}
          </p>
          <p className="text-sm font-bold text-white break-all">{phone ? phone[1] : email || 'unknown'}</p>
          <p className="text-[11px] text-zinc-500 leading-relaxed">
            They add it in Admin → Gate Volunteers. It has to be exactly this, not another address
            you use.
          </p>
        </div>

        <Link
          href="/"
          className="inline-block w-full bg-white/5 border border-white/15 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-xs active:scale-95 transition-all"
        >
          Back to site
        </Link>
      </div>
    </div>
  );
}
