"use client";
import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';

type NetworkInformation = { saveData?: boolean; effectiveType?: string };

/** True when this visitor would pay for a big decorative video: Data Saver on, or a slow connection. */
function connectionIsTight(): boolean {
  const c = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  return !!c && (c.saveData === true || /(^|-)2g$|3g/.test(c.effectiveType || ''));
}

const isPhone = () => window.matchMedia('(max-width: 768px)').matches;

interface LazyVideoProps {
  src: string;
  className?: string;
  /** Show a still (the parent's own background) instead of the video on phones. These clips are 10-20 MB each. */
  skipOnPhones?: boolean;
  /** A still shown underneath, so the card is never an empty dark box while the video is absent or still loading. */
  poster?: string;
  /** Called with true once the video is really playing, so a parent that cross-fades from a still never fades to nothing. */
  onPlaying?: () => void;
}

/**
 * Decorative looping video that costs nothing until it matters: it is not fetched until it scrolls near the
 * screen, it pauses when it scrolls away, and it stays out entirely on Data Saver / slow connections
 * (and, if asked, on phones).
 */
export default function LazyVideo({ src, className, skipOnPhones = false, poster, onPlaying }: LazyVideoProps) {
  const holder = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [allowed, setAllowed] = useState(false);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    setAllowed(!connectionIsTight() && !(skipOnPhones && isPhone()));
  }, [skipOnPhones]);

  useEffect(() => {
    const el = holder.current;
    if (!el || !allowed) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setStarted(true);
      const v = video.current;
      if (!v) return;
      if (entry.isIntersecting) v.play().catch(() => { /* autoplay refused: the poster/background stays */ });
      else v.pause();
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [allowed]);

  return (
    <div ref={holder} className="absolute inset-0">
      {poster && <Image src={poster} alt="" fill sizes="(max-width: 768px) 100vw, 50vw" className="object-cover" />}
      {allowed && started && (
        <video ref={video} src={src} className={className} autoPlay loop muted playsInline preload="metadata" onPlaying={onPlaying} />
      )}
    </div>
  );
}
