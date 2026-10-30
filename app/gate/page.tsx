"use client";
import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, XCircle, AlertTriangle, Loader2, Minus, Plus, Users, ShieldCheck, ShieldAlert, Clock, ScanLine, Camera } from 'lucide-react';
import { formatEventDate } from '@/lib/payments/format';

type Details = { ticketNumber: string; categoryName: string; groupSize: number; admitted: number; remaining: number };
type EventInfo = { title?: string; date?: string; time?: string; location?: string } | null;
type Gate = { window: 'OPEN' | 'EARLY' | 'CLOSED' | 'UNKNOWN'; eventDay: string; signed: boolean };
type Actor = { role: 'ADMIN' | 'SCANNER'; email: string; canAdmitPartial?: boolean };
type Phase = 'loading' | 'ready' | 'admitting' | 'success' | 'used' | 'error' | 'blocked';

function GateContent() {
  const searchParams = useSearchParams();
  const bid = searchParams.get('bid');
  const tno = searchParams.get('tno');
  const sig = searchParams.get('sig');

  const [phase, setPhase] = useState<Phase>('loading');
  const [message, setMessage] = useState('');
  const [details, setDetails] = useState<Details | null>(null);
  const [event, setEvent] = useState<EventInfo>(null);
  const [gate, setGate] = useState<Gate | null>(null);
  const [actor, setActor] = useState<Actor | null>(null);
  const [count, setCount] = useState(1);
  const [justAdmitted, setJustAdmitted] = useState(0);
  // An admin can admit outside the event's gate window, but only after confirming it.
  const [needsOverride, setNeedsOverride] = useState(false);
  // For a group with several people still outside: first ask "is everyone here?", and only if not, how many are.
  const [mode, setMode] = useState<'ask' | 'partial'>('ask');
  // Blocks a double submit (Enter pressed while a button is focused fires both the key handler and the click).
  const submitting = useRef(false);

  const vibrate = (type: 'success' | 'error') => {
    if (typeof window !== 'undefined' && navigator.vibrate) navigator.vibrate(type === 'success' ? [100, 50, 100] : [500]);
  };

  const post = (payload: Record<string, unknown>) =>
    fetch('/api/gate/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId: bid, ticketNumber: tno, sig, ...payload }),
    });

  const lookup = useCallback(async () => {
    if (!bid || !tno) return;
    setPhase('loading');
    setNeedsOverride(false);
    try {
      const res = await post({ action: 'lookup' });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || 'Verification failed.');
        // A forged QR, the wrong event or a closed gate is not "try again", it is "do not admit".
        setPhase(['BAD_SIGNATURE', 'WRONG_EVENT', 'UNSIGNED'].includes(data.code) ? 'blocked' : 'error');
        if (data.gate) setGate(data.gate);
        vibrate('error');
        return;
      }
      setDetails(data.ticketDetails);
      setEvent(data.event);
      setGate(data.gate || null);
      setActor(data.actor || null);
      setCount(Math.max(1, data.ticketDetails.remaining));
      setMode('ask');
      setPhase(data.ticketDetails.remaining === 0 ? 'used' : 'ready');
      if (data.ticketDetails.remaining === 0) vibrate('error');
    } catch {
      setMessage('Network error. Please try again.');
      setPhase('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bid, tno, sig]);

  useEffect(() => { lookup(); }, [lookup]);

  const admit = useCallback(async (howMany?: number, override = false) => {
    if (!details || phase !== 'ready' || submitting.current) return;
    submitting.current = true;
    const admitCount = howMany ?? count;
    setPhase('admitting');
    try {
      const res = await post({ action: 'admit', count: admitCount, override });
      const data = await res.json();
      if (res.ok) {
        setDetails(data.ticketDetails);
        setJustAdmitted(data.admittedNow);
        setNeedsOverride(false);
        setPhase('success');
        vibrate('success');
      } else if (data.needsOverride) {
        // Admin, outside the gate window: show what is wrong and make them confirm.
        setMessage(data.error);
        setNeedsOverride(true);
        setPhase('ready');
        vibrate('error');
      } else if (data.code?.startsWith('GATE_')) {
        setMessage(data.error);
        setPhase('blocked');
        vibrate('error');
      } else if (res.status === 409) {
        setMessage(data.error);
        setPhase('used');
        vibrate('error');
        lookup();
      } else if (data.code === 'TOO_MANY') {
        // Someone else let part of the group in meanwhile; refresh the numbers and let staff retry.
        setMessage(data.error);
        await lookup();
      } else {
        setMessage(data.error || 'Verification failed.');
        setPhase('error');
        vibrate('error');
      }
    } catch {
      setMessage('Network error. Please try again.');
      setPhase('error');
      vibrate('error');
    } finally {
      submitting.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [details, phase, count, lookup]);

  // Several people still outside on a group pass: ask before letting anyone in.
  const askFirst = !!details && details.groupSize > 1 && details.remaining > 1;

  // Enter admits, so staff can work the gate from a keyboard too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || phase !== 'ready' || !details) return;
      e.preventDefault();
      if (needsOverride) return; // Enter must never silently override the gate window
      if (askFirst && mode === 'ask') admit(details.remaining); else admit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, admit, askFirst, mode, details, needsOverride]);

  // Reached /gate with no pass in the address — almost always someone opening the gate page
  // directly rather than from a scan. Send them to the scanner instead of a dead end.
  if (!bid || !tno) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] text-center space-y-5 px-6 max-w-sm mx-auto">
        <ScanLine size={56} className="text-brandRed" />
        <div className="space-y-2">
          <h1 className="text-2xl font-black uppercase tracking-widest text-white">Gate Scanner</h1>
          <p className="text-sm text-zinc-500 leading-relaxed">
            No pass in this link. Open the scanner to read pass QR codes with your phone camera.
          </p>
        </div>
        <Link
          href="/gate/scanner"
          className="w-full bg-brandRed text-white py-5 rounded-2xl font-black uppercase tracking-widest text-sm active:scale-95 transition-all shadow-[0_0_30px_rgba(255,0,0,0.3)] flex items-center justify-center gap-2"
        >
          <Camera size={16} /> Open scanner
        </Link>
        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 leading-relaxed">
          Or point your phone camera app at a pass QR to open it here.
        </p>
      </div>
    );
  }

  const isGroup = (details?.groupSize || 1) > 1;
  // Splitting a group is admin-only. A volunteer is never shown the option, and the server
  // refuses it regardless of what the page sends.
  const canPartial = actor?.canAdmitPartial !== false;

  const WhoIsScanning = () => actor ? (
    <div className="w-full flex items-center justify-between gap-3 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
      <span className="truncate">{actor.email}</span>
      <span className={`shrink-0 px-2 py-1 rounded-md border ${actor.role === 'ADMIN' ? 'text-brandRed border-brandRed/30 bg-brandRed/10' : 'text-sky-400 border-sky-400/30 bg-sky-400/10'}`}>
        {actor.role === 'ADMIN' ? 'Admin' : 'Gate volunteer'}
      </span>
    </div>
  ) : null;

  const GateBanner = () => {
    if (!gate) return null;
    if (gate.window === 'OPEN' && gate.signed) return null;
    const tone = gate.window === 'OPEN' ? 'amber' : gate.window === 'CLOSED' ? 'red' : 'amber';
    const text =
      gate.window === 'EARLY' ? 'The gate for this event is not open yet.'
      : gate.window === 'CLOSED' ? 'This event is over.'
      : gate.window === 'UNKNOWN' ? 'This event has no readable date.'
      : 'Unsigned pass (issued before signed QR codes).';
    return (
      <div className={`w-full flex items-start gap-2 text-left rounded-xl px-3 py-2.5 border text-[11px] font-bold uppercase tracking-widest ${
        tone === 'red' ? 'text-red-400 bg-red-500/10 border-red-500/30' : 'text-amber-400 bg-amber-500/10 border-amber-500/30'
      }`}>
        {gate.window === 'OPEN' ? <ShieldAlert size={14} className="mt-px shrink-0" /> : <Clock size={14} className="mt-px shrink-0" />}
        <span>{text}</span>
      </div>
    );
  };

  const EventCard = () => (
    <div className="w-full text-left bg-black/40 border border-white/10 rounded-2xl p-4 space-y-2">
      <p className="text-sm font-black uppercase tracking-widest text-white">{event?.title || 'Event'}</p>
      <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">
        {formatEventDate(event?.date)}{event?.time ? ` · ${event.time}` : ''}
      </p>
      {event?.location && <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-600">{event.location}</p>}
      <GateBanner />
    </div>
  );

  const Progress = () => details && isGroup ? (
    <div className="w-full bg-black/40 border border-white/10 rounded-2xl p-4">
      <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2 flex items-center gap-2"><Users size={12} /> Group pass of {details.groupSize}</p>
      <div className="flex gap-1.5 flex-wrap justify-center">
        {Array.from({ length: details.groupSize }).map((_, i) => (
          <span key={i} className={`w-5 h-5 rounded-full border ${i < details.admitted ? 'bg-green-500 border-green-400' : 'bg-transparent border-white/20'}`} />
        ))}
      </div>
      <p className="text-xs font-bold text-zinc-300 mt-3">{details.admitted} already in · <span className="text-white">{details.remaining} still to come</span></p>
    </div>
  ) : null;

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] max-w-md mx-auto space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-black uppercase italic tracking-tighter">Access <span className="text-brandRed">Control</span></h1>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">Ticket Verification Terminal</p>
      </div>

      <div className="w-full bg-zinc-950/80 backdrop-blur-xl border border-white/10 rounded-[40px] p-6 sm:p-8 shadow-2xl flex flex-col items-center text-center relative overflow-hidden gap-5">
        <WhoIsScanning />

        {phase === 'loading' && (
          <div className="py-12 flex flex-col items-center space-y-6">
            <Loader2 size={64} className="text-brandRed animate-spin" />
            <p className="text-sm font-bold uppercase tracking-widest text-zinc-400 animate-pulse">Checking pass...</p>
          </div>
        )}

        {(phase === 'ready' || phase === 'admitting') && details && (
          <>
            <EventCard />
            <div>
              <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Ticket</p>
              <h2 className="text-3xl font-black uppercase tracking-widest text-white">{details.ticketNumber}</h2>
              <p className="text-sm font-black text-brandRed uppercase tracking-widest mt-1">{details.categoryName}</p>
            </div>
            <Progress />

            {needsOverride ? (
              <div className="w-full space-y-3">
                <p className="text-sm font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-4 py-3 rounded-xl">{message}</p>
                <button
                  onClick={() => admit(askFirst ? details.remaining : undefined, true)}
                  disabled={phase === 'admitting'}
                  className="w-full bg-amber-600 text-white py-5 rounded-2xl font-black uppercase tracking-widest text-sm active:scale-95 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {phase === 'admitting' ? <Loader2 className="animate-spin" size={18} /> : 'Yes, admit them'}
                </button>
                <button onClick={() => { setNeedsOverride(false); setMessage(''); }} className="text-xs font-bold uppercase tracking-widest text-zinc-500 hover:text-white underline">
                  Cancel
                </button>
              </div>
            ) : message ? (
              <p className="text-xs font-bold text-amber-400">{message}</p>
            ) : null}

            {!needsOverride && (askFirst && mode === 'ask' ? (
              <div className="w-full space-y-3">
                <p className="text-lg font-black uppercase tracking-widest text-white">Is the whole group here?</p>
                <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">{details.remaining} of {details.groupSize} still to enter</p>
                <button onClick={() => admit(details.remaining)} disabled={phase === 'admitting'} className="w-full bg-green-600 text-white py-5 rounded-2xl font-black uppercase tracking-widest text-sm active:scale-95 transition-all shadow-[0_0_30px_rgba(34,197,94,0.3)] disabled:opacity-60 flex items-center justify-center gap-2">
                  {phase === 'admitting' ? <Loader2 className="animate-spin" size={18} /> : `Yes, all ${details.remaining} are here`}
                </button>
                {canPartial ? (
                  <button onClick={() => { setCount(Math.max(1, details.remaining - 1)); setMode('partial'); }} disabled={phase === 'admitting'} className="w-full bg-white/5 border border-white/15 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-xs active:scale-95 transition-all disabled:opacity-60">
                    No, some are missing
                  </button>
                ) : (
                  <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 leading-relaxed px-2">
                    The whole group must enter together. If some are arriving later, send them to an organiser.
                  </p>
                )}
              </div>
            ) : askFirst ? (
              <div className="w-full space-y-4">
                <p className="text-lg font-black uppercase tracking-widest text-white">How many are here now?</p>
                <div className="flex items-center justify-center gap-6">
                  <button type="button" aria-label="One fewer" onClick={() => setCount((c) => Math.max(1, c - 1))} disabled={count <= 1} className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center disabled:opacity-30 active:scale-95"><Minus size={18} /></button>
                  <span className="text-5xl font-black w-16 text-center">{count}</span>
                  <button type="button" aria-label="One more" onClick={() => setCount((c) => Math.min(details.remaining - 1, c + 1))} disabled={count >= details.remaining - 1} className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center disabled:opacity-30 active:scale-95"><Plus size={18} /></button>
                </div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">{details.remaining - count} will still be to come</p>
                <button onClick={() => admit(count)} disabled={phase === 'admitting'} className="w-full bg-brandRed text-white py-5 rounded-2xl font-black uppercase tracking-widest text-sm active:scale-95 transition-all shadow-[0_0_30px_rgba(255,0,0,0.3)] disabled:opacity-60 flex items-center justify-center gap-2">
                  {phase === 'admitting' ? <Loader2 className="animate-spin" size={18} /> : `Admit ${count} ${count === 1 ? 'person' : 'people'}`}
                </button>
                <button onClick={() => setMode('ask')} className="text-xs font-bold uppercase tracking-widest text-zinc-500 hover:text-white underline">Back</button>
              </div>
            ) : (
              <button onClick={() => admit()} disabled={phase === 'admitting'} className="w-full bg-brandRed text-white py-5 rounded-2xl font-black uppercase tracking-widest text-sm active:scale-95 transition-all shadow-[0_0_30px_rgba(255,0,0,0.3)] disabled:opacity-60 flex items-center justify-center gap-2">
                {phase === 'admitting' ? <Loader2 className="animate-spin" size={18} /> : isGroup ? `Admit last ${details.remaining === 1 ? 'person' : details.remaining + ' people'}` : 'Verify Entry Now'}
              </button>
            ))}
          </>
        )}

        {phase === 'success' && details && (
          <>
            <div className="absolute inset-0 bg-green-500/10 blur-[50px] pointer-events-none" />
            <CheckCircle2 size={80} className="text-green-500 drop-shadow-[0_0_15px_rgba(34,197,94,0.5)]" />
            <h2 className="text-3xl font-black uppercase tracking-widest text-green-500">ACCESS GRANTED</h2>
            {gate?.signed && (
              <p className="text-[10px] font-bold uppercase tracking-widest text-green-500/70 flex items-center gap-1.5">
                <ShieldCheck size={12} /> Signed pass verified
              </p>
            )}
            <div className="w-full bg-black/50 border border-green-500/20 rounded-2xl p-5 text-left space-y-3">
              {isGroup && (
                <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 text-center">
                  <p className="text-[10px] text-green-400 uppercase font-bold tracking-widest">Let in</p>
                  <p className="text-4xl font-black text-white">{justAdmitted} <span className="text-lg">{justAdmitted === 1 ? 'PERSON' : 'PEOPLE'}</span></p>
                </div>
              )}
              <div>
                <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Ticket Number</p>
                <p className="text-lg font-black text-white">{details.ticketNumber}</p>
              </div>
              <div>
                <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Category</p>
                <p className="text-lg font-black text-brandRed">{details.categoryName}</p>
              </div>
            </div>
            <Progress />
            {details.remaining > 0 ? (
              <>
                <p className="text-sm font-black uppercase tracking-widest text-amber-400">{details.remaining} {details.remaining === 1 ? 'person is' : 'people are'} still to come</p>
                <p className="text-[11px] text-zinc-500 uppercase tracking-widest">When the next person arrives, scan this same QR again.</p>
                <button onClick={() => { setMessage(''); setCount(Math.max(1, details.remaining)); setMode('ask'); setPhase('ready'); }} className="w-full bg-white/5 border border-white/10 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-xs active:scale-95">
                  Some have arrived now
                </button>
              </>
            ) : (
              <p className="text-xs text-zinc-500 uppercase tracking-widest">Done. Scan the next pass with your phone camera.</p>
            )}
          </>
        )}

        {phase === 'used' && (
          <>
            <div className="absolute inset-0 bg-orange-500/10 blur-[50px] pointer-events-none" />
            <AlertTriangle size={80} className="text-orange-500 drop-shadow-[0_0_15px_rgba(249,115,22,0.5)]" />
            <h2 className="text-3xl font-black uppercase tracking-widest text-orange-500">ALREADY SCANNED</h2>
            {event && <EventCard />}
            <p className="text-sm font-bold text-zinc-300 bg-orange-500/20 border border-orange-500/30 px-4 py-3 rounded-xl">
              {message || (details && isGroup ? `All ${details.groupSize} people on this group pass have already entered.` : 'This ticket has already been used.')}
            </p>
            <p className="text-xs text-zinc-500 uppercase tracking-widest">Do not allow entry.</p>
          </>
        )}

        {phase === 'blocked' && (
          <>
            <div className="absolute inset-0 bg-red-600/10 blur-[50px] pointer-events-none" />
            <ShieldAlert size={80} className="text-red-600 drop-shadow-[0_0_15px_rgba(220,38,38,0.5)]" />
            <h2 className="text-2xl font-black uppercase tracking-widest text-red-600">Do not admit</h2>
            <p className="text-sm font-bold text-zinc-300 bg-red-600/15 border border-red-600/30 px-4 py-3 rounded-xl">{message}</p>
            <p className="text-xs text-zinc-500 uppercase tracking-widest">Send them to the organisers&apos; desk.</p>
          </>
        )}

        {phase === 'error' && (
          <>
            <div className="absolute inset-0 bg-red-600/10 blur-[50px] pointer-events-none" />
            <XCircle size={80} className="text-red-600 drop-shadow-[0_0_15px_rgba(220,38,38,0.5)]" />
            <h2 className="text-3xl font-black uppercase tracking-widest text-red-600">INVALID TICKET</h2>
            <p className="text-sm font-bold text-zinc-300">{message}</p>
            <button onClick={lookup} className="text-xs font-bold uppercase tracking-widest text-zinc-400 hover:text-white underline">Try again</button>
          </>
        )}
      </div>
    </div>
  );
}

export default function GatePage() {
  return (
    <div className="min-h-screen bg-[#030303] pt-16 pb-24 px-4 text-white">
      {/* Suspense boundary is required by Next.js when using useSearchParams */}
      <Suspense fallback={<div className="flex justify-center pt-32"><Loader2 className="animate-spin text-brandRed" size={32} /></div>}>
        <GateContent />
      </Suspense>
    </div>
  );
}
