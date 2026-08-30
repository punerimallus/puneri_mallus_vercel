"use client";
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, XCircle, AlertTriangle, Loader2, ScanLine, Ticket } from 'lucide-react';

function ScannerContent() {
  const searchParams = useSearchParams();
  const bid = searchParams.get('bid');
  const tno = searchParams.get('tno');

  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'used' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [ticketDetails, setTicketDetails] = useState<any>(null);

  // Trigger haptic feedback if supported by the device
  const vibrate = (type: 'success' | 'error') => {
    if (typeof window !== 'undefined' && navigator.vibrate) {
      if (type === 'success') navigator.vibrate([100, 50, 100]); // double pulse
      if (type === 'error') navigator.vibrate([500]); // long heavy pulse
    }
  };

  const verifyTicket = async () => {
    if (!bid || !tno) {
      setStatus('error');
      setMessage('Invalid QR Code. Missing parameters.');
      return;
    }

    setStatus('loading');

    try {
      const res = await fetch('/api/admin/tickets/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: bid, ticketNumber: tno })
      });

      const data = await res.json();

      if (res.status === 200) {
        setStatus('success');
        setTicketDetails(data.ticketDetails);
        vibrate('success');
      } else if (res.status === 409) {
        setStatus('used');
        setMessage(data.error);
        vibrate('error');
      } else {
        setStatus('error');
        setMessage(data.error || 'Verification failed.');
        vibrate('error');
      }
    } catch (err) {
      setStatus('error');
      setMessage('Network error. Please try again.');
      vibrate('error');
    }
  };

  if (!bid || !tno) {
    return (
      <div className="flex flex-col items-center justify-center h-[80vh] text-center space-y-4">
        <AlertTriangle size={64} className="text-brandRed" />
        <h1 className="text-2xl font-black uppercase tracking-widest text-white">Invalid QR</h1>
        <p className="text-zinc-500">Please scan a valid Puneri Mallus ticket.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] max-w-md mx-auto space-y-8">
      
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-black uppercase italic tracking-tighter">Access <span className="text-brandRed">Control</span></h1>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">Ticket Verification Terminal</p>
      </div>

      <div className="w-full bg-zinc-950/80 backdrop-blur-xl border border-white/10 rounded-[40px] p-8 shadow-2xl flex flex-col items-center text-center relative overflow-hidden">
        
        {/* IDLE STATE */}
        {status === 'idle' && (
          <>
            <div className="w-32 h-32 bg-brandRed/10 rounded-full flex items-center justify-center mb-6 border border-brandRed/20">
              <ScanLine size={48} className="text-brandRed animate-pulse" />
            </div>
            <h2 className="text-xl font-black uppercase tracking-widest text-white mb-2">{tno}</h2>
            <p className="text-sm text-zinc-400 mb-8">Ready to verify this pass.</p>
            <button 
              onClick={verifyTicket}
              className="w-full bg-brandRed text-white py-5 rounded-2xl font-black uppercase tracking-widest text-sm active:scale-95 transition-all shadow-[0_0_30px_rgba(255,0,0,0.3)]"
            >
              Verify Entry Now
            </button>
          </>
        )}

        {/* LOADING STATE */}
        {status === 'loading' && (
          <div className="py-12 flex flex-col items-center space-y-6">
            <Loader2 size={64} className="text-brandRed animate-spin" />
            <p className="text-sm font-bold uppercase tracking-widest text-zinc-400 animate-pulse">Communicating with Server...</p>
          </div>
        )}

        {/* SUCCESS STATE */}
        {status === 'success' && (
          <>
            <div className="absolute inset-0 bg-green-500/10 blur-[50px] pointer-events-none" />
            <CheckCircle2 size={80} className="text-green-500 mb-4 drop-shadow-[0_0_15px_rgba(34,197,94,0.5)]" />
            <h2 className="text-3xl font-black uppercase tracking-widest text-green-500 mb-2">ACCESS GRANTED</h2>
            
            <div className="w-full bg-black/50 border border-green-500/20 rounded-2xl p-5 mt-6 text-left space-y-3">
              <div>
                <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Ticket Number</p>
                <p className="text-lg font-black text-white">{tno}</p>
              </div>
              <div>
                <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Category</p>
                <p className="text-lg font-black text-brandRed">{ticketDetails?.categoryName || 'GENERAL'}</p>
              </div>
            </div>

            <button onClick={() => window.location.reload()} className="mt-8 text-xs font-bold uppercase tracking-widest text-zinc-500 hover:text-white underline">
              Scan Another Pass
            </button>
          </>
        )}

        {/* ALREADY USED STATE */}
        {status === 'used' && (
          <>
            <div className="absolute inset-0 bg-orange-500/10 blur-[50px] pointer-events-none" />
            <AlertTriangle size={80} className="text-orange-500 mb-4 drop-shadow-[0_0_15px_rgba(249,115,22,0.5)]" />
            <h2 className="text-3xl font-black uppercase tracking-widest text-orange-500 mb-2">ALREADY SCANNED</h2>
            <p className="text-sm font-bold text-zinc-300 mt-2 bg-orange-500/20 border border-orange-500/30 px-4 py-3 rounded-xl">
              {message}
            </p>
            <p className="text-xs text-zinc-500 mt-4 uppercase tracking-widest">Do not allow entry.</p>
          </>
        )}

        {/* ERROR STATE */}
        {status === 'error' && (
          <>
            <div className="absolute inset-0 bg-red-600/10 blur-[50px] pointer-events-none" />
            <XCircle size={80} className="text-red-600 mb-4 drop-shadow-[0_0_15px_rgba(220,38,38,0.5)]" />
            <h2 className="text-3xl font-black uppercase tracking-widest text-red-600 mb-2">INVALID TICKET</h2>
            <p className="text-sm font-bold text-zinc-300 mt-2">{message}</p>
          </>
        )}

      </div>
    </div>
  );
}

export default function TicketScannerPage() {
  return (
    <div className="min-h-screen bg-[#030303] pt-24 pb-20 px-4 text-white">
      {/* Suspense boundary is required by Next.js when using useSearchParams */}
      <Suspense fallback={<div className="flex justify-center pt-32"><Loader2 className="animate-spin text-brandRed" size={32}/></div>}>
        <ScannerContent />
      </Suspense>
    </div>
  );
}