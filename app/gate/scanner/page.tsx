"use client";

// The gate scanner, as a phone webapp.
//
// The old way round was: point the phone camera at a pass, the OS opens /gate in a browser tab,
// the page loads, you tap, you go back, you reopen the camera. That is five seconds and two app
// switches per guest, and a queue of two hundred feels it.
//
// This keeps one camera stream open and never navigates. A pass is read, checked and admitted
// in place, and the viewfinder is live again immediately. Everything it does goes through the
// same /api/gate/scan as before, so the authorisation, signature, event-window and
// no-partial-groups-for-volunteers rules are identical — this is a faster way to call them,
// not a second way in.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, Camera, CameraOff, CheckCircle2, Flashlight, Loader2, RotateCcw,
  ShieldAlert, ShieldCheck, Users, XCircle, Clock, ListChecks,
} from 'lucide-react';
import { parseScannedPass, passKey, shouldHandleScan, type ScannedPass } from '@/lib/payments/qr';
import { friendlyError } from '@/lib/user-errors';

type Details = { ticketNumber: string; categoryName: string; groupSize: number; admitted: number; remaining: number };
type Gate = { window: 'OPEN' | 'EARLY' | 'CLOSED' | 'UNKNOWN'; eventDay: string; signed: boolean };
type Actor = { role: 'ADMIN' | 'SCANNER'; email: string; canAdmitPartial?: boolean };
type Verdict = 'idle' | 'checking' | 'ready' | 'granted' | 'refused';

interface Recent {
  at: number;
  ticketNumber: string;
  category: string;
  admitted: number;
  ok: boolean;
  note: string;
}

/**
 * How long to wait for the gate before giving up on one request.
 *
 * Event wifi is the worst wifi there is. Without a deadline a hung fetch leaves the scanner
 * stuck on "checking" with no button to press and no way out but reloading the page — at the
 * door, mid-queue. Aborting surfaces it as a refusal the staff can dismiss and rescan.
 */
const GATE_TIMEOUT_MS = 12_000;

/** One call to the gate, with a deadline. Stateless, so the scan loop can capture it once. */
async function postGate(body: Record<string, unknown>): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GATE_TIMEOUT_MS);
  try {
    return await fetch('/api/gate/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

const networkMessage = (e: unknown): string =>
  (e as { name?: string })?.name === 'AbortError'
    ? 'The gate server did not answer. Check the connection, then scan again.'
    : 'Network error. Hold the pass up again.';

/** A frame grabber built on whatever the phone has: the native detector, else jsQR. */
type Decoder = (canvas: HTMLCanvasElement, w: number, h: number) => Promise<string | null>;

async function buildDecoder(): Promise<Decoder> {
  // Chrome on Android decodes in native code, which is markedly faster and cooler on the
  // battery than scanning pixels in JS.
  const Native = (globalThis as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect(s: CanvasImageSource): Promise<{ rawValue: string }[]> } }).BarcodeDetector;
  if (Native) {
    try {
      const detector = new Native({ formats: ['qr_code'] });
      return async (canvas) => {
        const found = await detector.detect(canvas).catch(() => []);
        return found[0]?.rawValue ?? null;
      };
    } catch {
      // fall through to jsQR
    }
  }
  // iOS Safari has no BarcodeDetector, so the fallback is not an edge case — it is most iPhones.
  const { default: jsQR } = await import('jsqr');
  return async (canvas, w, h) => {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    const image = ctx.getImageData(0, 0, w, h);
    const found = jsQR(image.data, w, h, { inversionAttempts: 'dontInvert' });
    return found?.data ?? null;
  };
}

export default function GateScannerPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const decoderRef = useRef<Decoder | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastKeyRef = useRef<string | null>(null);
  const lastAtRef = useRef<number | null>(null);
  // Read by the scan loop, which must not re-subscribe every time the verdict changes.
  const busyRef = useRef(false);
  /** True while a frame is being decoded, so two decodes never share one canvas. */
  const decodingRef = useRef(false);

  const [cameraState, setCameraState] = useState<'starting' | 'on' | 'denied' | 'unavailable'>('starting');
  const [cameraError, setCameraError] = useState('');
  const [torchOn, setTorchOn] = useState(false);
  const [torchable, setTorchable] = useState(false);

  const [verdict, setVerdict] = useState<Verdict>('idle');
  const [pass, setPass] = useState<ScannedPass | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [gate, setGate] = useState<Gate | null>(null);
  const [actor, setActor] = useState<Actor | null>(null);
  const [message, setMessage] = useState('');
  const [needsOverride, setNeedsOverride] = useState(false);
  const [justAdmitted, setJustAdmitted] = useState(0);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [tally, setTally] = useState({ admitted: 0, refused: 0 });
  // The "only some are here" sub-screen, admin-only. Reset wherever the pass changes rather
  // than in an effect watching it, so one scan is one render.
  const [partialMode, setPartialMode] = useState(false);
  const [partialCount, setPartialCount] = useState(1);

  const buzz = (kind: 'ok' | 'bad') => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(kind === 'ok' ? [90, 40, 90] : [420]);
  };

  /** Back to the viewfinder, ready for the next guest. */
  const resume = useCallback(() => {
    // Restart the cooldown on the pass just dealt with. Without this, dismissing a refused pass
    // that is still in front of the lens re-reads it at once — the cooldown has long since
    // expired while the staff were reading the refusal — and the same rejection reappears in a
    // loop until they physically move the phone away.
    lastAtRef.current = Date.now();
    busyRef.current = false;
    setVerdict('idle');
    setPass(null);
    setDetails(null);
    setMessage('');
    setNeedsOverride(false);
    setJustAdmitted(0);
    setPartialMode(false);
    setPartialCount(1);
  }, []);

  const remember = (entry: Recent) => setRecent((prev) => [entry, ...prev].slice(0, 8));

  // ---- Camera ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setCameraState('unavailable');
        setCameraError('This browser cannot open a camera. Use Chrome or Safari over https.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          // iOS refuses to play an inline video without these two set before play().
          video.setAttribute('playsinline', 'true');
          video.muted = true;
          await video.play().catch(() => undefined);
        }
        const track = stream.getVideoTracks()[0];
        const caps = (track?.getCapabilities?.() || {}) as { torch?: boolean };
        setTorchable(!!caps.torch);
        decoderRef.current = await buildDecoder();
        if (!cancelled) setCameraState('on');
      } catch (e) {
        if (cancelled) return;
        const name = (e as { name?: string })?.name || '';
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          setCameraState('denied');
          setCameraError('Camera access was blocked. Allow the camera for this site, then reload.');
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          setCameraState('unavailable');
          setCameraError('No usable camera was found on this device.');
        } else {
          setCameraState('unavailable');
          setCameraError(friendlyError(e, 'The camera could not be started.'));
        }
      }
    }

    start();
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      // `torch` is real on Android Chrome but is not in the DOM typings, so it has to be cast
      // through unknown. applyConstraints rejects where it is unsupported, which is handled below.
      await track.applyConstraints({ advanced: [{ torch: next }] } as unknown as MediaTrackConstraints);
      setTorchOn(next);
    } catch {
      setTorchable(false);
    }
  };

  // ---- Looking a pass up ----------------------------------------------------------------
  const inspect = useCallback(async (found: ScannedPass) => {
    busyRef.current = true;
    setPass(found);
    setVerdict('checking');
    setMessage('');
    setNeedsOverride(false);
    setPartialMode(false);
    setPartialCount(1);
    try {
      const res = await postGate({ action: 'lookup', bookingId: found.bookingId, ticketNumber: found.ticketNumber, sig: found.sig });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || 'This pass could not be verified.');
        setGate(data.gate || null);
        setVerdict('refused');
        setTally((t) => ({ ...t, refused: t.refused + 1 }));
        remember({ at: Date.now(), ticketNumber: found.ticketNumber, category: '', admitted: 0, ok: false, note: data.error || 'Refused' });
        buzz('bad');
        return;
      }
      setDetails(data.ticketDetails);
      setGate(data.gate || null);
      setActor(data.actor || null);
      if (data.ticketDetails.remaining === 0) {
        setMessage(
          data.ticketDetails.groupSize > 1
            ? `All ${data.ticketDetails.groupSize} people on this group pass are already in.`
            : 'This pass has already been used.',
        );
        setVerdict('refused');
        setTally((t) => ({ ...t, refused: t.refused + 1 }));
        remember({ at: Date.now(), ticketNumber: found.ticketNumber, category: data.ticketDetails.categoryName, admitted: 0, ok: false, note: 'Already used' });
        buzz('bad');
        return;
      }
      setVerdict('ready');
      buzz('ok');
    } catch (e) {
      setMessage(networkMessage(e));
      setVerdict('refused');
      buzz('bad');
    }
  }, []);

  // ---- Admitting ------------------------------------------------------------------------
  const admit = useCallback(async (count?: number, override = false) => {
    if (!pass || !details) return;
    setVerdict('checking');
    try {
      const res = await postGate({
        action: 'admit',
        bookingId: pass.bookingId,
        ticketNumber: pass.ticketNumber,
        sig: pass.sig,
        count,
        override,
      });
      const data = await res.json();
      if (res.ok) {
        setDetails(data.ticketDetails);
        setJustAdmitted(data.admittedNow);
        setVerdict('granted');
        setTally((t) => ({ ...t, admitted: t.admitted + data.admittedNow }));
        remember({
          at: Date.now(),
          ticketNumber: pass.ticketNumber,
          category: data.ticketDetails.categoryName,
          admitted: data.admittedNow,
          ok: true,
          note: data.ticketDetails.remaining > 0 ? `${data.ticketDetails.remaining} still to come` : 'All in',
        });
        buzz('ok');
        return;
      }
      if (data.needsOverride) {
        setMessage(data.error);
        setNeedsOverride(true);
        setVerdict('ready');
        buzz('bad');
        return;
      }
      setMessage(data.error || 'Could not admit this pass.');
      setVerdict('refused');
      setTally((t) => ({ ...t, refused: t.refused + 1 }));
      remember({ at: Date.now(), ticketNumber: pass.ticketNumber, category: details.categoryName, admitted: 0, ok: false, note: data.error || 'Refused' });
      buzz('bad');
    } catch (e) {
      // An admit that times out may still have landed on the server. Say so plainly: rescanning
      // is safe (an already-admitted pass reports "already in"), guessing is not.
      setMessage(
        (e as { name?: string })?.name === 'AbortError'
          ? 'The gate server did not answer, so this entry may or may not have gone through. Scan the pass again to check.'
          : 'Network error. Try again.',
      );
      setVerdict('refused');
      buzz('bad');
    }
  }, [pass, details]);

  // ---- The scan loop --------------------------------------------------------------------
  useEffect(() => {
    if (cameraState !== 'on') return;
    let stop = false;
    let lastFrame = 0;

    const tick = async (ts: number) => {
      if (stop) return;
      rafRef.current = requestAnimationFrame(tick);
      // ~8 reads a second is plenty for a pass held up to a lens, and leaves the phone cool.
      if (ts - lastFrame < 120) return;
      if (busyRef.current) return;
      // Only one decode at a time. The next frame is scheduled before this one finishes, and a
      // decode is not instant — jsQR on a 720p frame is 50-150ms on an older phone. Without
      // this guard a later tick calls `canvas.width = w`, which CLEARS the canvas, while the
      // earlier decode is still reading it: on Android that corrupts a live BarcodeDetector
      // read, and everywhere it burns battery decoding frames that are already stale.
      if (decodingRef.current) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const decode = decoderRef.current;
      if (!video || !canvas || !decode || video.readyState < 2) return;

      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return;

      lastFrame = ts;
      decodingRef.current = true;
      let text: string | null = null;
      try {
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, w, h);
        text = await decode(canvas, w, h).catch(() => null);
      } finally {
        decodingRef.current = false;
      }

      if (!text || stop) return;

      const found = parseScannedPass(text);
      if (!found) return; // somebody's Wi-Fi QR, a UPI code, a poster
      if (!shouldHandleScan(found, lastKeyRef.current, lastAtRef.current)) return;
      lastKeyRef.current = passKey(found);
      lastAtRef.current = Date.now();
      inspect(found);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      stop = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [cameraState, inspect]);

  // A pass that was fully admitted clears itself, so the queue keeps moving without a tap.
  useEffect(() => {
    if (verdict !== 'granted') return;
    if (details && details.remaining > 0) return; // part of a group left outside: let staff read it
    const t = setTimeout(resume, 1600);
    return () => clearTimeout(t);
  }, [verdict, details, resume]);

  const isGroup = (details?.groupSize || 1) > 1;
  const canPartial = actor?.canAdmitPartial !== false;

  return (
    <div className="min-h-screen bg-[#030303] text-white">
      <div className="mx-auto max-w-md px-4 pt-6 pb-28 space-y-4">
        <header className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-black uppercase italic tracking-tighter">
              Gate <span className="text-brandRed">Scanner</span>
            </h1>
            {actor && (
              <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mt-0.5 truncate max-w-[200px]">
                {actor.email}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {actor && (
              <span className={`px-2 py-1 rounded-md border text-[9px] font-black uppercase tracking-widest ${actor.role === 'ADMIN' ? 'text-brandRed border-brandRed/30 bg-brandRed/10' : 'text-sky-400 border-sky-400/30 bg-sky-400/10'}`}>
                {actor.role === 'ADMIN' ? 'Admin' : 'Volunteer'}
              </span>
            )}
            {torchable && (
              <button
                onClick={toggleTorch}
                aria-pressed={torchOn}
                aria-label="Torch"
                className={`w-9 h-9 rounded-xl border flex items-center justify-center transition-all ${torchOn ? 'bg-amber-400 text-black border-amber-300' : 'bg-white/5 border-white/10 text-zinc-400'}`}
              >
                <Flashlight size={15} />
              </button>
            )}
          </div>
        </header>

        {/* Viewfinder -------------------------------------------------------------------- */}
        <div className="relative aspect-square w-full overflow-hidden rounded-[32px] border border-white/10 bg-black shadow-2xl">
          <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-cover" />
          <canvas ref={canvasRef} className="hidden" />

          {cameraState === 'on' && verdict === 'idle' && (
            <>
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute inset-[18%] rounded-3xl border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
              </div>
              <p className="absolute bottom-4 inset-x-0 text-center text-[10px] font-black uppercase tracking-widest text-white/80">
                Point at the pass QR
              </p>
            </>
          )}

          {cameraState === 'starting' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black">
              <Loader2 className="animate-spin text-brandRed" size={36} />
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Starting camera</p>
            </div>
          )}

          {(cameraState === 'denied' || cameraState === 'unavailable') && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black px-6 text-center">
              <CameraOff className="text-brandRed" size={36} />
              <p className="text-xs font-bold text-zinc-300 leading-relaxed">{cameraError}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">
                You can still scan with the phone camera app instead
              </p>
            </div>
          )}

          {/* The verdict covers the viewfinder, so nobody reads a stale result. */}
          {verdict !== 'idle' && (
            <div className={`absolute inset-0 flex flex-col items-center justify-center gap-3 px-5 text-center backdrop-blur-sm ${
              verdict === 'granted' ? 'bg-green-950/90'
              : verdict === 'refused' ? 'bg-red-950/90'
              : 'bg-black/90'
            }`}>
              {verdict === 'checking' && <Loader2 className="animate-spin text-white" size={40} />}

              {verdict === 'ready' && details && (
                <>
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Ready to admit</p>
                  <p className="text-3xl font-black uppercase tracking-widest">{details.ticketNumber}</p>
                  <p className="text-sm font-black uppercase tracking-widest text-brandRed">{details.categoryName}</p>
                  {isGroup && (
                    <p className="text-[11px] font-bold uppercase tracking-widest text-amber-400 flex items-center gap-1.5">
                      <Users size={12} /> {details.remaining} of {details.groupSize} still to enter
                    </p>
                  )}
                  {gate && gate.window !== 'OPEN' && (
                    <p className="text-[10px] font-bold uppercase tracking-widest text-amber-400 flex items-center gap-1.5">
                      <Clock size={11} /> {gate.window === 'EARLY' ? 'Gate not open yet' : gate.window === 'CLOSED' ? 'Event is over' : 'Date unreadable'}
                    </p>
                  )}
                </>
              )}

              {verdict === 'granted' && (
                <>
                  <CheckCircle2 className="text-green-400 drop-shadow-[0_0_20px_rgba(34,197,94,0.6)]" size={64} />
                  <p className="text-2xl font-black uppercase tracking-widest text-green-400">Access granted</p>
                  {justAdmitted > 0 && (
                    <p className="text-4xl font-black">{justAdmitted} <span className="text-base">{justAdmitted === 1 ? 'PERSON' : 'PEOPLE'}</span></p>
                  )}
                  {details && <p className="text-sm font-black uppercase tracking-widest">{details.ticketNumber}</p>}
                  {gate?.signed && (
                    <p className="text-[9px] font-bold uppercase tracking-widest text-green-500/80 flex items-center gap-1">
                      <ShieldCheck size={11} /> Signed pass
                    </p>
                  )}
                  {details && details.remaining > 0 && (
                    <p className="text-[11px] font-bold uppercase tracking-widest text-amber-400">
                      {details.remaining} still to come on this pass
                    </p>
                  )}
                </>
              )}

              {verdict === 'refused' && (
                <>
                  {message.toLowerCase().includes('already')
                    ? <AlertTriangle className="text-orange-400" size={56} />
                    : <XCircle className="text-red-500" size={56} />}
                  <p className="text-xl font-black uppercase tracking-widest text-red-400">Do not admit</p>
                  <p className="text-xs font-bold text-zinc-200 leading-relaxed">{message}</p>
                  {pass && <p className="font-mono text-[10px] text-zinc-500">{pass.ticketNumber}</p>}
                </>
              )}
            </div>
          )}
        </div>

        {/* Actions ----------------------------------------------------------------------- */}
        {verdict === 'ready' && details && (
          <div className="space-y-3">
            {needsOverride ? (
              <>
                <p className="text-xs font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-4 py-3 rounded-xl text-center">{message}</p>
                <button onClick={() => admit(partialMode ? partialCount : details.remaining, true)}
                  className="w-full bg-amber-600 py-5 rounded-2xl font-black uppercase tracking-widest text-sm active:scale-95 transition-all">
                  Yes, admit anyway
                </button>
                <button onClick={resume} className="w-full text-[10px] font-bold uppercase tracking-widest text-zinc-500 py-2">Cancel</button>
              </>
            ) : partialMode ? (
              <>
                <p className="text-center text-[11px] font-black uppercase tracking-widest text-zinc-400">How many are here now?</p>
                <div className="flex items-center justify-center gap-6">
                  <button onClick={() => setPartialCount((c) => Math.max(1, c - 1))} disabled={partialCount <= 1}
                    className="w-14 h-14 rounded-full bg-white/5 border border-white/10 text-2xl font-black disabled:opacity-30 active:scale-95">−</button>
                  <span className="text-5xl font-black w-16 text-center">{partialCount}</span>
                  <button onClick={() => setPartialCount((c) => Math.min(details.remaining - 1, c + 1))} disabled={partialCount >= details.remaining - 1}
                    className="w-14 h-14 rounded-full bg-white/5 border border-white/10 text-2xl font-black disabled:opacity-30 active:scale-95">+</button>
                </div>
                <button onClick={() => admit(partialCount)}
                  className="w-full bg-brandRed py-5 rounded-2xl font-black uppercase tracking-widest text-sm active:scale-95 transition-all">
                  Admit {partialCount} {partialCount === 1 ? 'person' : 'people'}
                </button>
                <button onClick={() => setPartialMode(false)} className="w-full text-[10px] font-bold uppercase tracking-widest text-zinc-500 py-2">Back</button>
              </>
            ) : (
              <>
                <button onClick={() => admit(details.remaining)}
                  className="w-full bg-green-600 py-6 rounded-2xl font-black uppercase tracking-widest text-base active:scale-95 transition-all shadow-[0_0_30px_rgba(34,197,94,0.3)]">
                  {isGroup ? `Admit all ${details.remaining}` : 'Admit'}
                </button>
                {/* Splitting a group is an admin action; a volunteer is not offered it at all. */}
                {isGroup && details.remaining > 1 && (
                  canPartial ? (
                    <button onClick={() => { setPartialCount(Math.max(1, details.remaining - 1)); setPartialMode(true); }}
                      className="w-full bg-white/5 border border-white/15 py-4 rounded-2xl font-black uppercase tracking-widest text-[11px] active:scale-95">
                      Only some are here
                    </button>
                  ) : (
                    <p className="text-center text-[10px] font-bold uppercase tracking-widest text-zinc-500 leading-relaxed px-4">
                      The whole group must enter together. If some are coming later, send them to an organiser.
                    </p>
                  )
                )}
                <button onClick={resume} className="w-full text-[10px] font-bold uppercase tracking-widest text-zinc-500 py-2">Cancel</button>
              </>
            )}
          </div>
        )}

        {(verdict === 'refused' || (verdict === 'granted' && details && details.remaining > 0)) && (
          <button onClick={resume}
            className="w-full bg-white/5 border border-white/15 py-5 rounded-2xl font-black uppercase tracking-widest text-xs active:scale-95 flex items-center justify-center gap-2">
            <RotateCcw size={14} /> Scan next pass
          </button>
        )}

        {/* Session tally and history ------------------------------------------------------ */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-white/10 bg-zinc-950 p-4 text-center">
            <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Admitted</p>
            <p className="text-3xl font-black text-green-500">{tally.admitted}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-zinc-950 p-4 text-center">
            <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Refused</p>
            <p className="text-3xl font-black text-brandRed">{tally.refused}</p>
          </div>
        </div>

        {recent.length > 0 && (
          <div className="rounded-2xl border border-white/10 bg-zinc-950 p-4 space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-1.5">
              <ListChecks size={11} /> This session
            </p>
            {recent.map((r, i) => (
              <div key={`${r.at}-${i}`} className="flex items-center justify-between gap-2 text-[10px] font-bold">
                <span className={`font-mono tracking-widest ${r.ok ? 'text-zinc-300' : 'text-zinc-600 line-through'}`}>{r.ticketNumber}</span>
                <span className="text-zinc-600 truncate flex-1 text-right">{r.ok ? `+${r.admitted} · ${r.note}` : r.note}</span>
              </div>
            ))}
          </div>
        )}

        <div className="pt-2 text-center">
          <Link href="/gate" className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 hover:text-white underline">
            <Camera size={11} className="inline mr-1" /> Having trouble? Use the phone camera app instead
          </Link>
        </div>

        {cameraState === 'on' && verdict === 'idle' && !actor && (
          <p className="text-center text-[10px] font-bold uppercase tracking-widest text-zinc-700 flex items-center justify-center gap-1.5">
            <ShieldAlert size={11} /> Your gate access is checked on the first scan
          </p>
        )}
      </div>
    </div>
  );
}
