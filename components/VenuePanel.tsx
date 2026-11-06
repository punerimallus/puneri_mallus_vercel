"use client";

// The venue, opened from the box office.
//
// The address used to be three lines of grey text that did nothing. People tap it anyway —
// it looks like the thing you tap to find out where you are going — so now it is a button, and
// what it opens is the plan of the room plus a way out to Google Maps.
//
// It renders the same VenueMap the pass list does. Deliberately the same component rather than
// a second "big" variant: two renderers of the same plan is how the zone a buyer taps here ends
// up differing from the zone they bought below.

import { useEffect } from 'react';
import { ExternalLink, MapPin, X } from 'lucide-react';
import VenueMap, { type MapZone } from '@/components/VenueMap';
import type { VenueLayout } from '@/lib/events/venue-layout';

interface Props {
  open: boolean;
  onClose: () => void;
  venue: string;
  mapUrl?: string | null;
  layout: VenueLayout | null;
  zones: MapZone[];
  /** Picking a zone here closes the sheet and hands the choice back to the page. */
  onPick?: (id: string) => void;
  activeId?: string | null;
}

export default function VenuePanel({ open, onClose, venue, mapUrl, layout, zones, onPick, activeId }: Props) {
  // Escape closes it, and the page behind must not scroll while it is open — on a phone the
  // backdrop otherwise scrolls away under your finger and the sheet appears to be stuck.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const hasMap = !!layout && zones.length > 0;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-6 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-label="Venue"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg max-h-[90vh] overflow-y-auto custom-scrollbar bg-zinc-950 border border-white/10 rounded-t-[32px] sm:rounded-[32px] shadow-[0_-20px_60px_rgba(0,0,0,0.8)] animate-in slide-in-from-bottom-6 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 bg-zinc-950/95 backdrop-blur-xl border-b border-white/5 p-6">
          <div className="min-w-0 space-y-1.5">
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-brandRed">Venue</p>
            <h2 className="text-lg font-black uppercase italic tracking-tight text-white leading-tight break-words">{venue}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close venue"
            className="shrink-0 w-9 h-9 rounded-full border border-white/10 bg-white/5 flex items-center justify-center text-zinc-400 hover:bg-white hover:text-black transition-all active:scale-95"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-6 pt-5 space-y-5">
          {hasMap ? (
            <VenueMap
              layout={layout!}
              zones={zones}
              activeId={activeId}
              onPick={onPick ? (id) => { onPick(id); onClose(); } : undefined}
            />
          ) : (
            <div className="rounded-2xl border border-white/10 bg-black/50 px-5 py-8 text-center">
              <MapPin className="mx-auto text-zinc-700 mb-3" size={24} />
              <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">
                No seating plan for this venue yet
              </p>
              <p className="text-[10px] text-zinc-600 mt-2 leading-relaxed">Seating is open within the hall.</p>
            </div>
          )}

          {mapUrl && (
            <a
              href={mapUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-4 rounded-2xl border border-white/15 bg-white/5 text-[10px] font-black uppercase tracking-[0.2em] text-white hover:bg-white hover:text-black transition-all active:scale-[0.98]"
            >
              Open in Google Maps <ExternalLink size={13} />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
