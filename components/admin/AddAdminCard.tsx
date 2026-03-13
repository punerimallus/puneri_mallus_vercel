"use client";

import { useState } from "react";
import { UserPlus, Loader2, ShieldCheck } from "lucide-react";
import { addAdminEmail } from "@/app/admin/action";

export default function AddAdminCard() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success', text: string } | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    const formData = new FormData(e.currentTarget);
    const result = await addAdminEmail(formData);

    setLoading(false);
    if (result?.error) {
      setMessage({ type: 'error', text: result.error });
    } else {
      setMessage({ type: 'success', text: "Access granted successfully." });
      (e.target as HTMLFormElement).reset();
    }
  }

  return (
    <div className="bg-zinc-950 border border-white/5 p-10 rounded-[40px] hover:border-brandRed/40 transition-all duration-700 h-full flex flex-col justify-between overflow-hidden group relative">
      <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-br from-brandRed/20 to-transparent blur-[50px] opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
      
      <div>
        <div className="flex justify-between items-start mb-12">
          <div className="p-6 bg-black border border-white/5 rounded-[32px] group-hover:scale-110 group-hover:border-brandRed/30 transition-all duration-700">
            <UserPlus className="text-brandRed" size={32} />
          </div>
          <span className="text-[8px] font-black uppercase tracking-widest px-4 py-1.5 rounded-full border text-brandRed border-brandRed/20 bg-brandRed/5">
            Security
          </span>
        </div>

        <div className="space-y-4 mb-8">
          <h3 className="text-3xl font-black uppercase italic tracking-tighter leading-none">Gatekeeper</h3>
          <p className="text-zinc-500 font-bold italic text-sm leading-relaxed uppercase tracking-wider">
            Add new identities to the authorized admin whitelist.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input 
            name="email"
            type="email"
            placeholder="ADMIN EMAIL"
            required
            
  suppressHydrationWarning // Add this line
            className="w-full bg-black border border-white/10 rounded-2xl px-5 py-4 text-xs font-bold uppercase tracking-widest text-white focus:border-brandRed outline-none transition-all placeholder:text-zinc-800"
          />
          <button 
            disabled={loading}
            className="w-full bg-white text-black font-black py-4 rounded-2xl hover:bg-brandRed hover:text-white transition-all uppercase text-[10px] tracking-[0.3em] flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? <Loader2 className="animate-spin" size={16} /> : <ShieldCheck size={16} />}
            {loading ? "Authorizing..." : "Grant Access"}
          </button>
        </form>
      </div>

      {message && (
        <div className={`mt-8 pt-6 border-t border-white/5 text-[9px] font-black uppercase tracking-widest animate-pulse ${message.type === 'error' ? 'text-red-500' : 'text-brandRed'}`}>
          // {message.text}
        </div>
      )}
    </div>
  );
}