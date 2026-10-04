"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Ticket, Calendar, MapPin, ChevronRight, Loader2 } from 'lucide-react';
import { formatEventDate, formatRupees } from '@/lib/payments/format';

type Booking = {
  id: string; eventId: string; eventTitle: string; eventDate: string | null; eventLocation: string | null;
  status: string; passes: number; totalPaid: number; createdAt: string | null;
};

/**
 * The customer's tickets. `limit` shows only the latest few with a "view all" link (used above the
 * booking form); without it the full list is shown (used on the profile page).
 */
export default function MyTickets({ limit, highlightEventId, heading = 'My Tickets' }: { limit?: number; highlightEventId?: string; heading?: string }) {
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/tickets/mine${limit ? `?limit=${limit}` : ''}`)
      .then(async (res) => {
        if (res.status === 401) return [];
        if (!res.ok) throw new Error('failed');
        return (await res.json()).bookings as Booking[];
      })
      .then((b) => alive && setBookings(b))
      .catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [limit]);

  if (failed) return null;
  if (bookings === null) {
    return <div className="flex items-center gap-2 text-zinc-600 text-[10px] font-black uppercase tracking-widest py-4"><Loader2 size={14} className="animate-spin" /> Loading your tickets</div>;
  }
  // Compact mode stays out of the way for people with no bookings yet; the profile shows an empty state.
  if (bookings.length === 0 && limit) return null;

  return (
    <section aria-label={heading} className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-black uppercase tracking-[0.25em] text-zinc-400 flex items-center gap-2"><Ticket size={14} className="text-brandRed" /> {heading}</h3>
        {limit && <Link href="/profile#my-tickets" className="text-[10px] font-black uppercase tracking-widest text-brandRed hover:underline">View all</Link>}
      </div>

      {bookings.length === 0 ? (
        <p className="text-zinc-500 text-xs">You have no tickets yet. Book an event and your passes will show up here.</p>
      ) : (
        <ul className="space-y-3">
          {bookings.map((b) => {
            const refunded = b.status === 'REFUNDED';
            return (
              <li key={b.id}>
                <Link
                  href={`/tickets/${b.id}`}
                  className={`flex items-center gap-4 rounded-2xl border p-4 transition-all hover:border-brandRed/50 hover:bg-white/[0.03] ${highlightEventId === b.eventId ? 'border-brandRed/40 bg-brandRed/5' : 'border-white/10 bg-zinc-950'}`}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="font-black uppercase italic tracking-tight text-white truncate">{b.eventTitle}</p>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-2"><Calendar size={11} className="text-brandRed shrink-0" /> {formatEventDate(b.eventDate)}</p>
                    {b.eventLocation && <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 flex items-center gap-2 truncate"><MapPin size={11} className="shrink-0" /> <span className="truncate">{b.eventLocation}</span></p>}
                  </div>
                  <div className="text-right shrink-0 space-y-1">
                    <p className="text-sm font-black text-white">{b.passes} {b.passes === 1 ? 'pass' : 'passes'}</p>
                    <p className="text-[10px] font-bold text-zinc-500">{formatRupees(b.totalPaid)}</p>
                    <span className={`inline-block text-[9px] font-black uppercase tracking-widest rounded-full border px-2 py-0.5 ${refunded ? 'text-red-400 border-red-500/30 bg-red-500/10' : 'text-green-400 border-green-500/30 bg-green-500/10'}`}>{refunded ? 'Refunded' : 'Confirmed'}</span>
                  </div>
                  <ChevronRight size={16} className="text-zinc-600 shrink-0" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
