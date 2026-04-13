"use client";
import { CheckCircle2, ArrowRight } from 'lucide-react';
import Link from 'next/link';

export default function VerifiedPage() {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-6 text-center">
      <div className="max-w-md w-full space-y-8 bg-zinc-950/50 border border-white/10 p-10 rounded-[40px] backdrop-blur-3xl">
        <div className="flex justify-center">
          <CheckCircle2 size={80} className="text-green-500 drop-shadow-[0_0_20px_rgba(34,197,94,0.3)]" />
        </div>
        
        <div className="space-y-2">
          <h1 className="text-4xl font-black italic uppercase tracking-tighter text-white">
            Identity <span className="text-green-500">Verified.</span>
          </h1>
          <p className="text-zinc-500 text-[10px] font-black uppercase tracking-[0.3em]">
            Your Tribe Account is Active
          </p>
        </div>

        <p className="text-zinc-400 text-sm font-medium leading-relaxed italic">
          Verification complete. You can now close this window and continue on your main device to log in.
        </p>

        <Link href="/auth/login" className="block pt-4">
          <button className="w-full py-4 bg-white text-black rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-green-500 hover:text-white transition-all shadow-2xl">
            Proceed to Login <ArrowRight size={14} className="inline ml-2" />
          </button>
        </Link>
      </div>
    </div>
  );
}