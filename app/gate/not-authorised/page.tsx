import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';

/** Shown when someone signed in reaches the gate but is not on the list for it. */
export default function NotAuthorisedPage() {
  return (
    <div className="min-h-screen bg-[#030303] text-white flex items-center justify-center px-6">
      <div className="max-w-sm w-full text-center space-y-6">
        <ShieldAlert size={64} className="text-brandRed mx-auto" />
        <div className="space-y-2">
          <h1 className="text-2xl font-black uppercase tracking-widest">Not on the gate list</h1>
          <p className="text-sm text-zinc-400 leading-relaxed">
            You are signed in, but this account has not been added as a gate scanner. Ask an
            organiser to add your email in Admin → Gate Volunteers.
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
