"use client";
import { useState, useEffect, use } from 'react';
import { CheckCircle2, MapPin, Calendar, Clock, Mail, Smartphone, Ticket, Loader2, ArrowRight } from 'lucide-react';
import Link from 'next/link';

export default function TicketSuccessPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = use(params);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [resendMessage, setResendMessage] = useState('');

  const resendPasses = async () => {
    setResendState('sending');
    try {
      const res = await fetch('/api/tickets/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId }),
      });
      if (res.ok) {
        setResendState('sent');
        setResendMessage(`Passes re-sent to ${data?.booking?.email}. Check your spam folder too.`);
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

  useEffect(() => {
    async function fetchBooking() {
      try {
        const res = await fetch(`/api/tickets/booking?bid=${bookingId}`);
        const result = await res.json();
        if (result.booking) setData(result);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchBooking();
  }, [bookingId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#030303] flex flex-col items-center justify-center gap-4">
        <Loader2 className="animate-spin text-brandRed" size={40} />
        <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Retrieving E-Tickets...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-[#030303] flex flex-col items-center justify-center text-white">
        <p className="text-xl font-black uppercase">Booking Not Found</p>
        <Link href="/" className="mt-4 text-brandRed hover:underline text-sm font-bold uppercase tracking-widest">Return Home</Link>
      </div>
    );
  }

  const { booking, event } = data;
  const totalTickets = booking.tickets_data?.length || 0;
  // Use the first ticket's number for the display QR code
  const primaryTicketNo = booking.tickets_data?.[0]?.ticketNumber || bookingId;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${primaryTicketNo}&color=000000&bgcolor=ffffff`;

  return (
    <div className="min-h-screen bg-[#030303] pt-32 pb-20 px-6 selection:bg-brandRed/30 flex items-center justify-center relative overflow-hidden">
      
      {/* Cinematic Background Glow */}
      <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[60vw] h-[60vw] bg-brandRed/10 blur-[150px] rounded-full pointer-events-none" />

      <div className="max-w-md w-full relative z-10">
        
        {/* SUCCESS HEADER */}
        <div className="text-center mb-8 space-y-4 animate-in slide-in-from-bottom-4 duration-700">
          <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto shadow-[0_0_30px_rgba(34,197,94,0.2)]">
            <CheckCircle2 size={40} className="text-green-500" />
          </div>
          <div>
            <h1 className="text-3xl font-black uppercase italic tracking-tighter text-white">Booking Confirmed!</h1>
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mt-2">ID: {booking.id.split('-')[0].toUpperCase()}</p>
          </div>
        </div>

        {/* NOTIFICATION BANNER */}
        <div className="bg-zinc-900/80 border border-white/10 rounded-2xl p-4 mb-8 flex items-center gap-4 animate-in slide-in-from-bottom-6 duration-700 delay-100">
          <div className="flex -space-x-2 shrink-0">
            <div className="w-8 h-8 rounded-full bg-brandRed flex items-center justify-center border-2 border-zinc-900 z-10"><Mail size={12} className="text-white"/></div>
            <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center border-2 border-zinc-900"><Smartphone size={12} className="text-white"/></div>
          </div>
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 leading-relaxed">
            Your official PDF passes have been dispatched to <span className="text-white">{booking.email}</span> and via WhatsApp.
          </p>
        </div>

        {/* THE TICKET CARD (BookMyShow Style) */}
        <div className="animate-in slide-in-from-bottom-8 duration-700 delay-200 shadow-2xl">
          {/* Top Half: Event Poster & Details */}
          <div className="bg-zinc-950 border border-white/10 rounded-t-[32px] overflow-hidden relative">
            {event?.image && (
              <div className="h-40 w-full relative">
                <img src={event.image} alt={event.title} className="w-full h-full object-cover opacity-60" />
                <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 to-transparent" />
              </div>
            )}
            <div className="p-6 relative z-10 -mt-10">
              <h2 className="text-2xl font-black uppercase italic tracking-tighter text-white mb-4 drop-shadow-md">{event?.title || 'Exclusive Event'}</h2>
              <div className="space-y-2">
                <p className="text-xs font-bold text-zinc-400 flex items-center gap-2 uppercase tracking-widest"><Calendar size={14} className="text-brandRed" /> {event?.date}</p>
                <p className="text-xs font-bold text-zinc-400 flex items-center gap-2 uppercase tracking-widest"><Clock size={14} className="text-brandRed" /> {event?.time}</p>
                <p className="text-xs font-bold text-zinc-400 flex items-start gap-2 uppercase tracking-widest"><MapPin size={14} className="text-brandRed shrink-0 mt-0.5" /> <span className="truncate">{event?.location}</span></p>
              </div>
            </div>
          </div>

          {/* Perforated Divider */}
          <div className="relative bg-zinc-950 border-x border-white/10 h-8 flex items-center overflow-hidden">
            <div className="absolute -left-4 w-8 h-8 bg-[#030303] rounded-full" />
            <div className="w-full border-t-2 border-dashed border-white/10 mx-6" />
            <div className="absolute -right-4 w-8 h-8 bg-[#030303] rounded-full" />
          </div>

          {/* Bottom Half: QR & Ticket Info */}
          <div className="bg-zinc-950 border border-white/10 rounded-b-[32px] p-8 flex flex-col items-center">
            <div className="bg-white p-3 rounded-2xl mb-6 shadow-xl">
              <img src={qrUrl} alt="Ticket QR" className="w-32 h-32 rounded-lg" />
            </div>
            
            <div className="w-full grid grid-cols-2 gap-4 text-center border-b border-white/5 pb-6 mb-6">
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500 mb-1">Passes</p>
                <p className="text-lg font-black text-white flex items-center justify-center gap-1"><Ticket size={16} className="text-brandRed"/> {totalTickets}</p>
              </div>
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500 mb-1">Total Paid (Without Taxes)</p>
                <p className="text-lg font-black text-white">₹{booking.amount_paid}</p>
              </div>
            </div>

            <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-600 text-center leading-relaxed">
              Show this QR code at the entry gate. <br/> A valid Government ID is required.
            </p>
          </div>
        </div>

        {/* Resend passes: for when the email never arrived or went to spam */}
        <div className="mt-8 text-center space-y-3">
          {booking.status === 'REFUNDED' ? (
            <p className="text-[10px] font-black uppercase tracking-widest text-brandRed">This booking was refunded. These passes are no longer valid.</p>
          ) : (
            <button
              onClick={resendPasses}
              disabled={resendState === 'sending'}
              className="bg-white/5 border border-white/10 text-white px-8 py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-white hover:text-black transition-all flex items-center justify-center gap-2 mx-auto disabled:opacity-50"
            >
              {resendState === 'sending' ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} Email my passes again
            </button>
          )}
          {resendMessage && (
            <p className={`text-[10px] font-bold uppercase tracking-widest ${resendState === 'sent' ? 'text-green-500' : 'text-zinc-400'}`}>{resendMessage}</p>
          )}
        </div>

        {/* Back to Home Action */}
        <div className="mt-8 text-center animate-in slide-in-from-bottom-10 duration-700 delay-300">
          <Link href="/">
            <button className="bg-white/5 border border-white/10 text-white px-8 py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-white hover:text-black transition-all flex items-center justify-center gap-2 mx-auto">
              Return to Homepage <ArrowRight size={14} />
            </button>
          </Link>
        </div>

      </div>
    </div>
  );
}