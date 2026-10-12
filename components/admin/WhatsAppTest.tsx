"use client";
import { useState } from 'react';
import { Loader2, MessageCircle } from 'lucide-react';
import { useAlert } from '@/context/AlertContext';
import { onEnter } from '@/lib/ui/enter';

/** Admin-only: send one WhatsApp message to a number to check the setup, before customers are involved. */
export default function WhatsAppTest() {
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState<'hello' | 'ticket' | null>(null);
  const [result, setResult] = useState<string>('');
  const { showAlert } = useAlert();

  const send = async (mode: 'hello' | 'ticket') => {
    if (busy || !to.trim()) return;
    setBusy(mode);
    setResult('');
    try {
      const res = await fetch('/api/admin/whatsapp/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to, mode }) });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        setResult('Accepted by WhatsApp. It should arrive on that phone within a few seconds.');
        showAlert('WhatsApp message sent', 'success');
      } else {
        setResult(`Not sent: ${data.error || 'unknown error'}${data.code ? ` (code ${data.code})` : ''}`);
        showAlert('WhatsApp send failed', 'error');
      }
    } catch {
      setResult('Network error. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4 bg-zinc-950 border border-white/5 rounded-[30px] p-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-black uppercase italic tracking-tighter flex items-center gap-3"><MessageCircle className="text-green-500" size={24} /> WhatsApp Check</h2>
        <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Send one test message. While the number is in Meta test mode, use a recipient you added in Meta API Setup.</p>
      </div>
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          value={to}
          onChange={(e) => setTo(e.target.value)}
          onKeyDown={onEnter(() => send('hello'), !busy && !!to.trim())}
          placeholder="+91 98765 43210"
          inputMode="tel"
          className="flex-1 bg-black border border-white/10 p-4 rounded-2xl font-bold text-sm outline-none focus:border-green-500 text-white"
        />
        <button onClick={() => send('hello')} disabled={!!busy || !to.trim()} className="px-6 py-4 bg-white text-black rounded-2xl text-[10px] font-black uppercase tracking-widest disabled:opacity-50 flex items-center justify-center gap-2">
          {busy === 'hello' && <Loader2 size={14} className="animate-spin" />} Send hello
        </button>
        <button onClick={() => send('ticket')} disabled={!!busy || !to.trim()} className="px-6 py-4 bg-green-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest disabled:opacity-50 flex items-center justify-center gap-2">
          {busy === 'ticket' && <Loader2 size={14} className="animate-spin" />} Send sample ticket
        </button>
      </div>
      {result && <p className="text-xs font-bold text-zinc-300">{result}</p>}
    </div>
  );
}
