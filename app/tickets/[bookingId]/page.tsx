"use client";
import { useState, useEffect, use } from 'react';
import { CheckCircle2, MapPin, Calendar, Clock, Mail, Smartphone, Loader2, ArrowRight, Download, ChevronLeft, ChevronRight, LogIn } from 'lucide-react';
import Link from 'next/link';
import QRCode from 'qrcode';
import { admitsLabel, isGroup } from '@/lib/payments/groups';
import { buildReceipt, buildScanUrl, formatEventDate, formatEventTime, formatIst, formatRupees } from '@/lib/payments/format';

type Pass = { categoryName: string; ticketNumber: string; unitPrice: number; status: 'ISSUED' | 'CHECKED_IN' | 'REFUNDED'; groupSize: number; admitted: number };
type View = {
  id: string; email: string | null; status: string; createdAt: string | null;
  tickets: Pass[];
  event: { title?: string; date?: string; time?: string; location?: string } | null;
  pointsApplied: number; totalPaidPaise: number | null;
  payment: { orderId: string | null; paymentId: string | null; paidAt: string | null };
};

const STATUS_STYLE: Record<Pass['status'], { label: string; cls: string }> = {
  ISSUED: { label: 'Valid for entry', cls: 'bg-green-500/10 text-green-400 border-green-500/30' },
  CHECKED_IN: { label: 'Already checked in', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  REFUNDED: { label: 'Refunded', cls: 'bg-red-500/10 text-red-400 border-red-500/30' },
};

export default function TicketSuccessPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = use(params);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<'login' | 'missing' | 'error' | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [qrs, setQrs] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [resendMessage, setResendMessage] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/tickets/booking?bid=${encodeURIComponent(bookingId)}`);
        if (res.status === 401) return setProblem('login');
        if (res.status === 404 || res.status === 400) return setProblem('missing');
        const result = await res.json();
        if (!res.ok || !result.booking) return setProblem('error');
        const v: View = result.booking;
        setView(v);
        setImage(result.image || null);
        const origin = result.baseUrl || window.location.origin;
        // QR codes are drawn in the browser (no third-party service) and carry the same link as the PDF.
        setQrs(await Promise.all(v.tickets.map((t) =>
          QRCode.toDataURL(buildScanUrl(origin, v.id, t.ticketNumber), { margin: 1, width: 360, errorCorrectionLevel: 'M' }))));
      } catch (err) {
        console.error(err);
        setProblem('error');
      } finally {
        setLoading(false);
      }
    })();
  }, [bookingId]);

  const resendPasses = async () => {
    setResendState('sending');
    try {
      const res = await fetch('/api/tickets/resend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookingId }) });
      if (res.ok) {
        setResendState('sent');
        setResendMessage(`Passes re-sent to ${view?.email}. Check your spam folder too.`);
      } else if (res.status === 429) {
        setResendState('error');
        setResendMessage('Just sent. Please wait a minute before trying again.');
      } else {
        setResendState('error');
        setResendMessage('Could not resend right now. Please contact support with your booking ID.');
      }
    } catch {
      setResendState('error');
      setResendMessage('Network error. Please try again.');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#030303] flex flex-col items-center justify-center gap-4">
        <Loader2 className="animate-spin text-brandRed" size={40} />
        <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Retrieving E-Tickets...</p>
      </div>
    );
  }

  if (!view) {
    const msg = problem === 'login'
      ? { title: 'Log in to see your tickets', body: 'Tickets are private. Log in with the account you booked with.', icon: <LogIn size={28} className="text-brandRed" /> }
      : problem === 'error'
        ? { title: 'Something went wrong', body: 'We could not load this booking. Please refresh, or try again in a minute.', icon: null }
        : { title: 'Booking not found', body: 'This booking does not exist, or it belongs to a different account.', icon: null };
    return (
      <div className="min-h-screen bg-[#030303] flex flex-col items-center justify-center text-white px-6 text-center gap-3">
        {msg.icon}
        <p className="text-xl font-black uppercase">{msg.title}</p>
        <p className="text-xs text-zinc-500 max-w-xs">{msg.body}</p>
        <Link href={problem === 'login' ? '/auth/login' : '/'} className="mt-2 text-brandRed hover:underline text-sm font-bold uppercase tracking-widest">
          {problem === 'login' ? 'Log in' : 'Return Home'}
        </Link>
      </div>
    );
  }

  const { event } = view;
  const refunded = view.status === 'REFUNDED';
  const total = view.tickets.length;
  const pass = view.tickets[active];
  const receipt = buildReceipt(view.tickets, view.pointsApplied, view.totalPaidPaise);
  const partial = isGroup(pass.groupSize) && pass.status === 'ISSUED' && pass.admitted > 0;
  const st = partial
    ? { label: `${pass.admitted} of ${pass.groupSize} admitted`, cls: STATUS_STYLE.CHECKED_IN.cls }
    : STATUS_STYLE[refunded ? 'REFUNDED' : pass.status];

  return (
    <div className="min-h-screen bg-[#030303] pt-32 pb-20 px-4 sm:px-6 selection:bg-brandRed/30 flex items-center justify-center relative overflow-hidden">
      <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[60vw] h-[60vw] bg-brandRed/10 blur-[150px] rounded-full pointer-events-none" />

      <div className="max-w-md w-full relative z-10">

        {/* Header */}
        <div className="text-center mb-8 space-y-4 animate-in slide-in-from-bottom-4 duration-700">
          <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto ${refunded ? 'bg-red-500/10' : 'bg-green-500/10 shadow-[0_0_30px_rgba(34,197,94,0.2)]'}`}>
            <CheckCircle2 size={40} className={refunded ? 'text-red-500' : 'text-green-500'} />
          </div>
          <div>
            <h1 className="text-3xl font-black uppercase italic tracking-tighter text-white">{refunded ? 'Booking Refunded' : 'Booking Confirmed!'}</h1>
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mt-2">Booking ID: {view.id.split('-')[0].toUpperCase()}</p>
          </div>
        </div>

        {/* Notification banner (WhatsApp wording intentionally unchanged) */}
        {!refunded && (
          <div className="bg-zinc-900/80 border border-white/10 rounded-2xl p-4 mb-8 flex items-center gap-4 animate-in slide-in-from-bottom-6 duration-700 delay-100">
            <div className="flex -space-x-2 shrink-0">
              <div className="w-8 h-8 rounded-full bg-brandRed flex items-center justify-center border-2 border-zinc-900 z-10"><Mail size={12} className="text-white" /></div>
              <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center border-2 border-zinc-900"><Smartphone size={12} className="text-white" /></div>
            </div>
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 leading-relaxed">
              Your official PDF passes have been dispatched to <span className="text-white break-all">{view.email}</span> and via WhatsApp.
            </p>
          </div>
        )}

        {/* Ticket card */}
        <div className="animate-in slide-in-from-bottom-8 duration-700 delay-200 shadow-2xl">
          <div className="bg-zinc-950 border border-white/10 rounded-t-[32px] overflow-hidden relative">
            {image && (
              <div className="h-40 w-full relative">
                <img src={image} alt={event?.title || 'Event'} className="w-full h-full object-cover opacity-60" />
                <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 to-transparent" />
              </div>
            )}
            <div className={`p-6 relative z-10 ${image ? '-mt-10' : ''}`}>
              <h2 className="text-2xl font-black uppercase italic tracking-tighter text-white mb-4 drop-shadow-md">{event?.title || 'Event'}</h2>
              <div className="space-y-2">
                <p className="text-xs font-bold text-zinc-400 flex items-center gap-2 uppercase tracking-widest"><Calendar size={14} className="text-brandRed shrink-0" /> {formatEventDate(event?.date)}</p>
                <p className="text-xs font-bold text-zinc-400 flex items-center gap-2 uppercase tracking-widest"><Clock size={14} className="text-brandRed shrink-0" /> {formatEventTime(event?.time)}</p>
                {event?.location && <p className="text-xs font-bold text-zinc-400 flex items-start gap-2 uppercase tracking-widest"><MapPin size={14} className="text-brandRed shrink-0 mt-0.5" /> <span>{event.location}</span></p>}
              </div>
            </div>
          </div>

          <div className="relative bg-zinc-950 border-x border-white/10 h-8 flex items-center overflow-hidden">
            <div className="absolute -left-4 w-8 h-8 bg-[#030303] rounded-full" />
            <div className="w-full border-t-2 border-dashed border-white/10 mx-6" />
            <div className="absolute -right-4 w-8 h-8 bg-[#030303] rounded-full" />
          </div>

          <div className="bg-zinc-950 border border-white/10 rounded-b-[32px] p-6 sm:p-8 flex flex-col items-center">
            {/* Pass switcher */}
            {total > 1 && (
              <div className="w-full flex items-center justify-between mb-5">
                <button aria-label="Previous pass" onClick={() => setActive((a) => Math.max(0, a - 1))} disabled={active === 0} className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white disabled:opacity-30"><ChevronLeft size={16} /></button>
                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Pass {active + 1} of {total}</p>
                <button aria-label="Next pass" onClick={() => setActive((a) => Math.min(total - 1, a + 1))} disabled={active === total - 1} className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white disabled:opacity-30"><ChevronRight size={16} /></button>
              </div>
            )}

            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-brandRed bg-brandRed/10 border border-brandRed/30 rounded-full px-3 py-1 mb-2">{pass.categoryName}</span>
            {isGroup(pass.groupSize) && <p className="text-[11px] font-black uppercase tracking-widest text-white mb-4">Group pass &middot; admits {admitsLabel(pass.groupSize)}</p>}
            {!isGroup(pass.groupSize) && <div className="mb-2" />}

            <div className={`bg-white p-3 rounded-2xl mb-4 shadow-xl ${refunded || pass.status === 'REFUNDED' ? 'opacity-30' : ''}`}>
              {qrs[active] ? <img src={qrs[active]} alt={`QR for ${pass.ticketNumber}`} className="w-44 h-44 rounded-lg" /> : <div className="w-44 h-44 flex items-center justify-center"><Loader2 className="animate-spin text-zinc-400" /></div>}
            </div>

            <p className="text-2xl font-black text-white tracking-widest mb-2">{pass.ticketNumber}</p>
            <span className={`text-[9px] font-black uppercase tracking-widest border rounded-full px-3 py-1 mb-6 ${st.cls}`}>{st.label}</span>

            <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-600 text-center leading-relaxed">
              {isGroup(pass.groupSize) ? `One scan admits all ${pass.groupSize} people. Everyone in the group should arrive together.` : 'One scan, one person.'} Show this QR code at the entry gate.<br /> A valid Government ID is required.
            </p>
          </div>
        </div>

        {/* Receipt */}
        <div className="mt-8 bg-zinc-950 border border-white/10 rounded-3xl p-6 animate-in slide-in-from-bottom-8 duration-700 delay-300">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 mb-4">Payment summary</p>
          <div className="space-y-2 text-xs">
            {receipt.lines.map((l) => (
              <div key={`${l.name}-${l.unitPrice}`} className="flex justify-between text-zinc-300">
                <span>{l.name} × {l.qty}</span><span className="font-bold text-white">{formatRupees(l.amount)}</span>
              </div>
            ))}
            {receipt.pointsApplied > 0 && <div className="flex justify-between text-green-400"><span>Loyalty points</span><span className="font-bold">- {formatRupees(receipt.pointsApplied)}</span></div>}
            {receipt.fee > 0 && <div className="flex justify-between text-zinc-400"><span>Payment gateway fee</span><span>{formatRupees(receipt.fee)}</span></div>}
            <div className="flex justify-between border-t border-white/10 pt-3 mt-3 text-sm font-black text-white"><span>Total paid</span><span>{formatRupees(receipt.total)}</span></div>
          </div>
          {(view.payment.paymentId || view.payment.paidAt) && (
            <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-600 mt-4 leading-relaxed break-all">
              {view.payment.paidAt && formatIst(view.payment.paidAt)}{view.payment.paymentId && ` · Payment ${view.payment.paymentId}`}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="mt-8 space-y-3 text-center">
          {refunded ? (
            <p className="text-[10px] font-black uppercase tracking-widest text-brandRed">This booking was refunded. These passes are no longer valid.</p>
          ) : (
            <>
              <a href={`/api/tickets/pdf?bid=${encodeURIComponent(view.id)}`} className="bg-brandRed text-white px-8 py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-red-700 transition-all flex items-center justify-center gap-2 mx-auto w-full sm:w-auto">
                <Download size={14} /> Download tickets (PDF)
              </a>
              <button onClick={resendPasses} disabled={resendState === 'sending'} className="bg-white/5 border border-white/10 text-white px-8 py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-white hover:text-black transition-all flex items-center justify-center gap-2 mx-auto w-full sm:w-auto disabled:opacity-50">
                {resendState === 'sending' ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} Email my passes again
              </button>
            </>
          )}
          {resendMessage && <p className={`text-[10px] font-bold uppercase tracking-widest ${resendState === 'sent' ? 'text-green-500' : 'text-zinc-400'}`}>{resendMessage}</p>}
        </div>

        <div className="mt-8 text-center">
          <Link href="/" className="inline-flex bg-white/5 border border-white/10 text-white px-8 py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-white hover:text-black transition-all items-center justify-center gap-2">
            Return to Homepage <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}
