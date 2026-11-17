"use client";
import { useState, useEffect } from 'react';
import { 
  Ticket, Loader2, ArrowLeft, Users, 
  PauseCircle, PlayCircle, IndianRupee, ShieldCheck, Search, Mail,
  DoorOpen, UserCheck, UserX, CircleDashed, ScanLine, Gift, BadgePercent, Boxes, Check
} from 'lucide-react';
import Link from 'next/link';
import { useAlert } from '@/context/AlertContext';
import { seatsInUse } from '@/lib/payments/seats';
import { ATTENDANCE_LABEL, AttendanceState, admittedBy, attendancePercent, bookingAttendance, eventAttendance, type ScanLogRow } from '@/lib/payments/attendance';
import { progressOf, seatRangeLabel } from '@/lib/payments/scan';
import { ALL_TYPES, ledgerTypeCounts, matchesType } from '@/lib/payments/ledger';
import CompPassIssuer from '@/components/admin/CompPassIssuer';
import SalePhaseControl from '@/components/admin/SalePhaseControl';
import BundleManager from '@/components/admin/BundleManager';
import CouponManager from '@/components/admin/CouponManager';

export default function BoxOfficeDashboard() {
  const [events, setEvents] = useState<any[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [dashboardData, setDashboardData] = useState<{ categories: any[], bookings: any[], grants?: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  /** Which ticket type the ledger is showing. ALL_TYPES means every type. */
  const [typeFilter, setTypeFilter] = useState<string>(ALL_TYPES);
  // Who has come through the door: All, or one of the attendance states.
  const [doorFilter, setDoorFilter] = useState<'ALL' | AttendanceState>('ALL');
  const { showAlert } = useAlert();

  const fetchDashboard = async (eventId: string) => {
    setRefreshing(true);
    setSelectedEventId(eventId);
    try {
      const res = await fetch(`/api/admin/boxoffice?eventId=${eventId}`);
      const data = await res.json();
      setDashboardData(data);
    } catch (err) {
      showAlert("Failed to sync ledger", "error");
    } finally {
      setRefreshing(false);
    }
  };

  // Pulled out of the effect so saving a schedule can re-read the events without a full reload;
  // otherwise the card keeps showing the go-live time that was just replaced.
  const fetchEvents = async (selectFirst = false) => {
    const data = await fetch('/api/admin/boxoffice').then((r) => r.json()).catch(() => ({}));
    setEvents(data.events || []);
    if (selectFirst && data.events?.length > 0) fetchDashboard(data.events[0]._id);
    return data.events || [];
  };

  useEffect(() => {
    fetchEvents(true).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Pause or resume a ticket type.
   *
   * The spinner matters more than it looks: this fires a request and then re-reads the whole
   * dashboard, so the card sat unchanged for a second with nothing to say it had heard — and an
   * admin pausing a type mid-rush would press it again. The group cards already showed their
   * work; this now does the same.
   */
  const [togglingCategory, setTogglingCategory] = useState<string | null>(null);
  const toggleCategoryStatus = async (categoryId: string, currentStatus: boolean) => {
    setTogglingCategory(categoryId);
    try {
      const res = await fetch('/api/admin/boxoffice', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryId, active: !currentStatus })
      });
      if (res.ok) {
        showAlert(currentStatus ? "Category Paused" : "Category Resumed", "success");
        if (selectedEventId) await fetchDashboard(selectedEventId);
      } else {
        showAlert("Status override failed", "error");
      }
    } catch (err) {
      showAlert("Status override failed", "error");
    } finally {
      setTogglingCategory(null);
    }
  };

  // Resend passes. Leave the prompt as-is to use the booking email, or type a corrected one.
  const resendPasses = async (booking: any) => {
    const input = window.prompt("Send passes to which email?", booking.email || "");
    if (input === null) return;
    const email = input.trim();
    try {
      const res = await fetch('/api/tickets/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id, email: email && email !== booking.email ? email : undefined })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showAlert(`Passes sent to ${email || booking.email}`, "success");
        if (selectedEventId) fetchDashboard(selectedEventId);
      } else {
        showAlert(data.error || `Resend failed (${data.status || res.status})`, "error");
      }
    } catch {
      showAlert("Resend failed", "error");
    }
  };

  const formatTickets = (tickets: any[]) => {
    if (!tickets) return "-";
    const counts = tickets.reduce((acc: any, t: any) => {
      acc[t.categoryName] = (acc[t.categoryName] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(counts).map(([name, qty]) => `${qty}x ${name}`).join(' | ');
  };

  /** The coupon codes that gave a pass away on this booking, each named once. */
  const couponsOn = (booking: any): string[] =>
    [...new Set<string>(
      (booking.tickets_data || [])
        .filter((t: any) => t.free && t.couponCode)
        .map((t: any) => String(t.couponCode)),
    )];

  /**
   * Replace one booking's passes in state.
   *
   * It has to go through the bookings ARRAY. The rows the table renders are shallow copies made
   * by withAttendance ({ ...b, door }), so assigning `booking.tickets_data` on one of those sets
   * a field on the copy and leaves the source untouched — the screen then re-renders from the
   * original and the change appears to have been ignored. That is what voiding a pass used to
   * do: it worked on the server and looked like it had not.
   */
  const applyTickets = (bookingId: string, tickets: unknown[]) =>
    setDashboardData((prev: any) =>
      prev
        ? { ...prev, bookings: (prev.bookings || []).map((b: any) => (b.id === bookingId ? { ...b, tickets_data: tickets } : b)) }
        : prev,
    );

  /**
   * Void a single pass: it stops scanning and its seat goes back on sale. Deliberately separate
   * from refunding — an admin may want one without the other — so the confirmation says so.
   */
  const [voiding, setVoiding] = useState<string | null>(null);
  const voidPass = async (booking: any, ticketNumber: string) => {
    const confirmed = confirm(
      `Void pass ${ticketNumber}?\n\n` +
        `It will stop working at the gate and its seat goes back on sale immediately.\n\n` +
        `This does NOT refund any money — do that in Razorpay separately if you mean to.`,
    );
    if (!confirmed) return;
    setVoiding(ticketNumber);
    try {
      const res = await fetch('/api/admin/tickets/void', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id, ticketNumber }),
      });
      const data = await res.json();
      if (!res.ok) {
        showAlert(data.error || 'Could not void that pass.', 'error');
        return;
      }
      showAlert(data.note || `${ticketNumber} voided.`, 'success');
      // Shown at once, then confirmed: the seat has gone back on sale, so the inventory cards
      // above are out of date until the dashboard is read again.
      applyTickets(booking.id, (booking.tickets_data || []).map((t: any) =>
        t.ticketNumber === ticketNumber ? { ...t, status: 'REFUNDED' } : t,
      ));
      if (selectedEventId) fetchDashboard(selectedEventId);
    } catch {
      showAlert('Could not void that pass.', 'error');
    } finally {
      setVoiding(null);
    }
  };

  /**
   * Let somebody in from here, with no QR involved.
   *
   * The case it exists for: the pass never arrived, the phone is flat, the screenshot is of
   * somebody else's ticket. The alternative an organiser is left with otherwise is waving them
   * through unrecorded — and an unrecorded entry is worse than none, because the pass still
   * reads valid afterwards and whoever turns up with it next gets in on it too.
   *
   * It is confirmed rather than instant: there is no un-admitting anyone.
   */
  const [checkingIn, setCheckingIn] = useState<string | null>(null);
  const checkIn = async (booking: any, opts: { ticket?: any; busyKey: string }) => {
    const { ticket, busyKey } = opts;
    const remaining = ticket ? progressOf(ticket).remaining : booking.door.remaining;
    if (remaining <= 0) return;

    let count: number | undefined;
    // A group pass is one QR over several people and they do not always arrive together, so
    // this asks rather than assuming. An ordinary pass is one person and is never asked about.
    if (ticket && remaining > 1) {
      const typed = window.prompt(`How many of the ${remaining} on ${ticket.ticketNumber} are coming in now?`, String(remaining));
      if (typed === null) return;
      count = Number(typed.trim());
      if (!Number.isInteger(count) || count < 1 || count > remaining) {
        showAlert(`Enter a whole number between 1 and ${remaining}.`, 'error');
        return;
      }
    }

    const who = booking.full_name || booking.email;
    const what = ticket
      ? `${count ?? remaining} on ${ticket.ticketNumber}`
      : `all ${remaining} on this booking`;
    if (!confirm(`Check in ${what} for ${who}?\n\nThis admits them as if they had been scanned, and it cannot be undone.\n\nYour name goes on the entry.`)) return;

    setCheckingIn(busyKey);
    try {
      const res = await fetch('/api/admin/tickets/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          ticket ? { bookingId: booking.id, ticketNumber: ticket.ticketNumber, count } : { bookingId: booking.id, all: true },
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showAlert(data.error || 'Could not check them in.', 'error');
        return;
      }
      showAlert(data.message || 'Checked in.', 'success');
      // Shown at once — at a gate the queue is waiting — and then confirmed from the server,
      // which also picks up anyone a scanner admitted while this was in flight.
      if (Array.isArray(data.tickets)) applyTickets(booking.id, data.tickets);
      if (selectedEventId) fetchDashboard(selectedEventId);
    } catch {
      showAlert('Could not check them in.', 'error');
    } finally {
      setCheckingIn(null);
    }
  };

  // Attendance is worked out once per booking and reused by the filter, the counts and the row.
  const withAttendance = (dashboardData?.bookings || []).map((b: any) => ({
    ...b,
    door: bookingAttendance(b.tickets_data, b.status),
  }));
  const door = eventAttendance(dashboardData?.bookings || []);
  const doorCounts = {
    ALL: withAttendance.filter((b: any) => b.door.state !== 'REFUNDED').length,
    NOT_ARRIVED: withAttendance.filter((b: any) => b.door.state === 'NOT_ARRIVED').length,
    PARTLY_IN: withAttendance.filter((b: any) => b.door.state === 'PARTLY_IN').length,
    ALL_IN: withAttendance.filter((b: any) => b.door.state === 'ALL_IN').length,
    REFUNDED: withAttendance.filter((b: any) => b.door.state === 'REFUNDED').length,
  };

  // Seeded from the event's own categories so a type with no sales still shows, reading zero,
  // rather than the chips rearranging themselves as the night goes on.
  const typeCounts = ledgerTypeCounts(dashboardData?.bookings || [], dashboardData?.categories || []);

  const q = searchQuery.trim().toLowerCase();
  const filteredBookings = withAttendance.filter((b: any) => {
    const matchesSearch = !q
      || b.full_name?.toLowerCase().includes(q)
      || b.email?.toLowerCase().includes(q)
      // Searching by pass number is how you find one person at a busy gate.
      // Any seat, not just the number the pass is filed under: somebody at the gate reading out
      // REGULAR-055 is holding a group pass numbered REGULAR-053, and searching it has to find
      // them rather than tell them they do not exist.
      || (b.tickets_data || []).some((t: any) =>
        String(t.ticketNumber).toLowerCase().includes(q)
        || (t.groupSeats || []).some((n: string) => String(n).toLowerCase().includes(q)));
    if (!matchesSearch) return false;
    // A booking can hold more than one type, so it appears under each of them.
    if (!matchesType(b, typeFilter)) return false;
    // "All" hides refunded bookings; they have their own filter.
    if (doorFilter === 'ALL') return b.door.state !== 'REFUNDED';
    return b.door.state === doorFilter;
  });

  if (loading) return <div className="min-h-screen bg-black flex items-center justify-center"><Loader2 className="animate-spin text-brandRed" size={40} /></div>;

  return (
    <div className="min-h-screen bg-black text-white pt-40 pb-20 px-6 lg:px-16 selection:bg-brandRed/30">
      <div className="max-w-7xl mx-auto space-y-12">
        
        {/* HEADER */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 border-b border-white/5 pb-10">
          <div className="space-y-4">
            <Link href="/admin" className="text-zinc-500 hover:text-white flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.3em] transition-all">
              <ArrowLeft size={14} /> Back to Hub
            </Link>
            <h1 className="text-5xl md:text-7xl font-black italic uppercase tracking-tighter leading-none flex items-center gap-4">
              Box <span className="text-brandRed">Office .</span>
            </h1>
          </div>
          
          <div className="w-full md:w-80 space-y-2">
            <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Select Event Source</label>
            <select 
              value={selectedEventId || ''} 
              onChange={(e) => fetchDashboard(e.target.value)}
              className="w-full bg-zinc-950 border border-white/10 p-4 rounded-2xl font-bold uppercase tracking-widest outline-none focus:border-brandRed text-xs"
            >
              {events.map(ev => <option key={ev._id} value={ev._id}>{ev.title}</option>)}
            </select>
          </div>
        </div>

        {/* GO LIVE & PHASES — deliberately above the per-event dashboard, because it is about
            which events the public can see at all rather than about one event's stock. */}
        <SalePhaseControl events={events} onSaved={() => fetchEvents()} />

        {refreshing && !dashboardData ? (
          <div className="py-20 flex justify-center"><Loader2 className="animate-spin text-brandRed" size={32}/></div>
        ) : dashboardData && (
          <div className="space-y-12">
            
            {/* INVENTORY CONTROL (PAUSE/RESUME) */}
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <h3 className="text-2xl font-black uppercase italic tracking-tighter flex items-center gap-3">
                  <ShieldCheck className="text-brandRed" size={24} /> Inventory Control
                </h3>
                <a
                  href="/gate/scanner"
                  className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-white bg-brandRed px-4 py-3 rounded-xl hover:bg-white hover:text-black transition-all shadow-lg"
                >
                  <ScanLine size={14} /> Open gate scanner
                </a>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {dashboardData.categories.map((cat: any) => (
                  <div key={cat.id} className={`p-6 rounded-[30px] border transition-all duration-300 ${togglingCategory === cat.id ? 'opacity-50' : ''} ${cat.active ? 'bg-zinc-950 border-white/5 hover:border-brandRed/30' : 'bg-brandRed/5 border-brandRed/30 opacity-80'}`}>
                    <div className="flex justify-between items-start mb-6">
                      <div>
                        <h4 className="font-black uppercase text-xl">{cat.name}</h4>
                        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-1">₹{cat.price} per pass</p>
                      </div>
                      <button
                        onClick={() => toggleCategoryStatus(cat.id, cat.active)}
                        disabled={togglingCategory === cat.id}
                        className={`p-3 rounded-full flex items-center justify-center transition-all disabled:cursor-wait ${cat.active ? 'bg-brandRed/10 text-brandRed hover:bg-brandRed hover:text-white' : 'bg-green-500/10 text-green-500 hover:bg-green-500 hover:text-white'}`}
                        title={cat.active ? "Pause Category" : "Resume Category"}
                      >
                        {togglingCategory === cat.id
                          ? <Loader2 size={24} className="animate-spin" />
                          : cat.active ? <PauseCircle size={24} /> : <PlayCircle size={24} />}
                      </button>
                    </div>
                    
                    <div className="flex justify-between items-end border-t border-white/5 pt-4">
                      <div>
                        {/* SOLD, not "taken". The counter behind this includes seats a checkout
                            is holding, and an organiser asked how many are sold needs the number
                            that money has been paid for — the held ones are called out below
                            rather than quietly folded in. */}
                        <p className="text-[9px] text-zinc-600 font-black uppercase tracking-widest mb-1">
                          {(cat.held || 0) > 0 ? 'Sold' : 'Seats Taken'}
                        </p>
                        <p className="text-2xl font-black text-white">
                          {seatsInUse(cat) - (cat.held || 0)} <span className="text-sm text-zinc-600">/ {cat.capacity}</span>
                        </p>
                        {(cat.held || 0) > 0 && (
                          <p className="text-[9px] font-bold uppercase tracking-widest mt-1 text-sky-400">
                            + {cat.held} held in checkout · not sold yet
                          </p>
                        )}
                        {(cat.released || 0) > 0 && <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest mt-1">{Math.min(cat.released, cat.sold)} refunded, seats freed</p>}
                      </div>
                      <div className={`text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded-full ${cat.active ? 'bg-white/5 text-zinc-400' : 'bg-brandRed text-white animate-pulse'}`}>
                        {cat.active ? 'Live' : 'Paused'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* BUNDLES AND COUPONS
                Both sit above the complimentary passes because both are things an admin sets
                up BEFORE a sale rather than during one. */}
            <div className="pt-8 border-t border-white/5">
              <BundleManager
                eventId={selectedEventId!}
                categories={dashboardData.categories}
                onChanged={() => selectedEventId && fetchDashboard(selectedEventId)}
              />
            </div>

            <div className="pt-8 border-t border-white/5">
              <CouponManager eventId={selectedEventId!} categories={dashboardData.categories} />
            </div>

            {/* COMPLIMENTARY PASSES */}
            <div className="pt-8 border-t border-white/5">
              <CompPassIssuer
                eventId={selectedEventId!}
                categories={dashboardData.categories}
                grants={dashboardData.grants || []}
                onIssued={() => selectedEventId && fetchDashboard(selectedEventId)}
              />
            </div>

            {/* AT THE DOOR */}
            <div className="space-y-6 pt-8 border-t border-white/5">
              <h3 className="text-2xl font-black uppercase italic tracking-tighter flex items-center gap-3">
                <DoorOpen className="text-brandRed" size={24} /> At The Door
              </h3>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-zinc-950 border border-white/10 rounded-[24px] p-6">
                  <p className="text-[9px] text-zinc-600 font-black uppercase tracking-widest mb-2">People inside</p>
                  <p className="text-3xl font-black text-green-500">{door.admitted}<span className="text-base text-zinc-600"> / {door.people}</span></p>
                  <div className="mt-3 h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-green-500 transition-all" style={{ width: attendancePercent(door) + '%' }} />
                  </div>
                  <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest mt-2">{attendancePercent(door)}% turned up</p>
                </div>

                <div className="bg-zinc-950 border border-white/10 rounded-[24px] p-6">
                  <p className="text-[9px] text-zinc-600 font-black uppercase tracking-widest mb-2">Still to come</p>
                  <p className="text-3xl font-black text-white">{door.remaining}</p>
                  <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest mt-2">{door.notArrived} bookings not arrived</p>
                </div>

                <div className="bg-zinc-950 border border-white/10 rounded-[24px] p-6">
                  <p className="text-[9px] text-zinc-600 font-black uppercase tracking-widest mb-2">Passes scanned</p>
                  <p className="text-3xl font-black text-white">{door.passesScanned}<span className="text-base text-zinc-600"> / {door.passes}</span></p>
                  <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest mt-2">fully used up</p>
                </div>

                <div className="bg-zinc-950 border border-white/10 rounded-[24px] p-6">
                  <p className="text-[9px] text-zinc-600 font-black uppercase tracking-widest mb-2">Voided / refunded</p>
                  <p className="text-3xl font-black text-zinc-500">{door.refunded}</p>
                  <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest mt-2">no longer admit</p>
                </div>
              </div>
            </div>

            {/* PURCHASERS LEDGER */}
            <div className="space-y-6 pt-8 border-t border-white/5">
              <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                <h3 className="text-2xl font-black uppercase italic tracking-tighter flex items-center gap-3">
                  <Users className="text-brandRed" size={24} /> Purchaser Ledger ({dashboardData.bookings.length})
                </h3>
                <div className="relative w-full md:w-80">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" size={16} />
                  <input
                    placeholder="SEARCH NAME, EMAIL OR PASS NO..."
                    value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                    className="w-full bg-zinc-950 border border-white/10 p-3 pl-12 rounded-2xl text-[10px] font-black uppercase tracking-widest outline-none focus:border-brandRed"
                  />
                </div>
              </div>

              {/* Who to look at: everyone, or just the ones still outside. */}
              <div className="flex flex-wrap gap-2">
                {([
                  ['ALL', 'All', doorCounts.ALL, 'text-white'],
                  ['NOT_ARRIVED', 'Not arrived', doorCounts.NOT_ARRIVED, 'text-amber-400'],
                  ['PARTLY_IN', 'Partly in', doorCounts.PARTLY_IN, 'text-sky-400'],
                  ['ALL_IN', 'Checked in', doorCounts.ALL_IN, 'text-green-500'],
                  ['REFUNDED', 'Refunded', doorCounts.REFUNDED, 'text-zinc-500'],
                ] as const).map(([key, label, count, tone]) => (
                  <button
                    key={key}
                    onClick={() => setDoorFilter(key as 'ALL' | AttendanceState)}
                    className={`px-4 py-2.5 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 ${
                      doorFilter === key
                        ? 'bg-brandRed border-brandRed text-white'
                        : `bg-zinc-950 border-white/10 ${tone} hover:border-white/25`
                    }`}
                  >
                    {label} <span className="opacity-60">{count}</span>
                  </button>
                ))}
              </div>

              {/* Which ticket type. Its own row rather than mixed in with the door states
                  above: they answer different questions and an admin uses them together —
                  "REGULAR, still outside" is the one you want when a queue forms. */}
              {typeCounts.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[8px] font-black uppercase tracking-[0.25em] text-zinc-600 ml-1 flex items-center gap-2">
                    <Ticket size={11} className="text-brandRed" /> Ticket type
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {[{ name: ALL_TYPES, count: (dashboardData?.bookings || []).length }, ...typeCounts].map((type) => (
                      <button
                        key={type.name}
                        onClick={() => setTypeFilter(type.name)}
                        className={`px-4 py-2.5 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 ${
                          typeFilter === type.name
                            ? 'bg-brandRed border-brandRed text-white'
                            : 'bg-zinc-950 border-white/10 text-zinc-400 hover:border-white/25'
                        }`}
                      >
                        {type.name === ALL_TYPES ? 'All types' : type.name}{' '}
                        <span className="opacity-60">{type.count}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-zinc-950 border border-white/10 rounded-[30px] overflow-hidden shadow-2xl overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[900px]">
                  <thead>
                    <tr className="bg-white/5 text-[9px] uppercase tracking-[0.2em] text-zinc-500 font-black border-b border-white/10">
                      <th className="p-6">User Identity</th>
                      <th className="p-6">Tickets Acquired</th>
                      <th className="p-6">Amount Paid</th>
                      <th className="p-6">At The Door</th>
                      <th className="p-6">Transaction Ref</th>
                      <th className="p-6">Delivery</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-sm font-bold">
                    {filteredBookings.map((booking: any) => (
                      <tr key={booking.id} className="hover:bg-white/5 transition-colors">
                        <td className="p-6">
                          <span className="text-white uppercase tracking-wider block mb-1">{booking.full_name}</span>
                          <span className="text-[10px] text-zinc-500 block">{booking.email}</span>
                          {booking.comp && (
                            <span className="mt-1.5 inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-widest text-amber-400 border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 rounded-full">
                              <Gift size={8} /> Comp · {booking.comp.reason}
                            </span>
                          )}
                          {couponsOn(booking).map((code: string) => (
                            <span key={code} className="mt-1.5 ml-1.5 inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-widest text-green-400 border border-green-500/30 bg-green-500/10 px-2 py-0.5 rounded-full">
                              <BadgePercent size={8} /> {code}
                            </span>
                          ))}
                        </td>
                        <td className="p-6">
                          <span className="bg-brandRed/10 text-brandRed border border-brandRed/20 px-3 py-1.5 rounded-lg text-[10px] uppercase tracking-widest inline-block">
                            {formatTickets(booking.tickets_data)}
                          </span>
                          {/* Each pass individually, so one can be killed without touching the rest. */}
                          {booking.status !== 'REFUNDED' && (booking.tickets_data || []).length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {(booking.tickets_data || []).map((t: any) => (
                                <span key={t.ticketNumber} className="inline-flex items-center gap-1">
                                  <span
                                    // A pass a coupon gave away is green. It is an ordinary pass in
                                    // every other way, and the only record of that fact per seat is
                                    // here — so "which REGULAR went out free?" is answerable at the
                                    // door rather than by reading order rows.
                                    title={[
                                      t.free ? `Free pass${t.couponCode ? ` - coupon ${t.couponCode}` : ''}` : '',
                                      t.group ? `${t.groupName || 'Group ticket'} — admits ${t.groupSize || 1}` : '',
                                      // The seats behind one group QR, so a dispute at the door
                                      // about how many this pass is worth has an answer here.
                                      seatRangeLabel(t.groupSeats) ? `Seats ${seatRangeLabel(t.groupSeats)}` : '',
                                    ].filter(Boolean).join(' · ') || undefined}
                                    // Read at a gate, in a hurry, on a phone: the pass number is
                                    // the thing being matched against what the guest is showing,
                                    // so it is the one piece here that has to be legible first.
                                    className={`font-mono text-[11px] font-bold tracking-widest px-2 py-1 rounded border ${
                                      t.status === 'REFUNDED'
                                        ? 'text-zinc-600 border-white/5 line-through'
                                        : t.status === 'CHECKED_IN'
                                          ? 'text-amber-400 border-amber-500/25'
                                          : t.free
                                            ? 'text-green-400 border-green-500/30 bg-green-500/10'
                                            : t.group
                                              ? 'text-sky-400 border-sky-500/30 bg-sky-500/10'
                                              : 'text-zinc-200 border-white/15'
                                    }`}
                                  >
                                    {t.free && <BadgePercent size={10} className="inline mr-1 -mt-0.5" />}
                                    {!t.free && t.group && <Boxes size={10} className="inline mr-1 -mt-0.5" />}
                                    {/* A group pass is one QR over several seats, so the chip
                                        shows the seats it took — "REGULAR-053 – 057" — rather
                                        than the single number it is filed under. Compact, so a
                                        row of them still fits: the prefix is said once. */}
                                    {seatRangeLabel(t.groupSeats, { compact: true }) || t.ticketNumber}
                                  </span>
                                  {/* Check this one pass in by hand. Next to the pass rather than
                                      in its own column: at a gate you are looking at the number
                                      the guest read out, and the action belongs where your eye
                                      already is. */}
                                  {t.status !== 'REFUNDED' && progressOf(t).remaining > 0 && (
                                    <button
                                      onClick={() => checkIn(booking, { ticket: t, busyKey: t.ticketNumber })}
                                      disabled={checkingIn === t.ticketNumber}
                                      title={`Check in ${t.ticketNumber} without a QR`}
                                      className="text-green-500/70 hover:text-green-400 disabled:opacity-40 transition-colors"
                                    >
                                      {checkingIn === t.ticketNumber
                                        ? <Loader2 size={12} className="animate-spin" />
                                        : <Check size={13} />}
                                    </button>
                                  )}
                                  {t.status !== 'REFUNDED' && (
                                    <button
                                      onClick={() => voidPass(booking, t.ticketNumber)}
                                      disabled={voiding === t.ticketNumber}
                                      title={`Void ${t.ticketNumber} (no refund)`}
                                      className="text-[11px] text-zinc-600 hover:text-brandRed disabled:opacity-40 transition-colors"
                                    >
                                      {voiding === t.ticketNumber ? '...' : '×'}
                                    </button>
                                  )}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="p-6 font-mono text-zinc-300">
                          <div className="flex items-center gap-1"><IndianRupee size={12}/>{booking.amount_paid}</div>
                        </td>
                        <td className="p-6">
                          <DoorCell door={booking.door} scans={booking.scans} />
                          {/* The whole party in one press — the common case, because the guest
                              without a pass is usually standing there with everyone on it. */}
                          {booking.door.state !== 'REFUNDED' && booking.door.remaining > 0 && (
                            <button
                              onClick={() => checkIn(booking, { busyKey: booking.id })}
                              disabled={checkingIn === booking.id}
                              title="Admit everyone still outside on this booking, without a QR"
                              className="mt-2.5 flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-green-400 border border-green-500/30 bg-green-500/10 rounded-lg px-3 py-1.5 hover:bg-green-500 hover:text-black hover:border-green-500 disabled:opacity-40 transition-all active:scale-95"
                            >
                              {checkingIn === booking.id
                                ? <Loader2 size={11} className="animate-spin" />
                                : <UserCheck size={11} />}
                              Check in {booking.door.remaining}
                            </button>
                          )}
                        </td>
                        <td className="p-6">
                          <span className="font-mono text-[10px] text-zinc-500 block">
                            {booking.comp ? `Issued by ${booking.comp.issued_by}` : booking.razorpay_payment_id}
                          </span>
                          <span className="text-[9px] text-zinc-600 block mt-1">{new Date(booking.created_at).toLocaleDateString('en-IN')}</span>
                        </td>
                        <td className="p-6">
                          <span className={`text-[9px] uppercase tracking-widest block mb-2 ${booking.status === 'REFUNDED' ? 'text-zinc-500' : booking.email_status === 'FAILED' ? 'text-brandRed' : booking.email_status === 'SENT' ? 'text-green-500' : 'text-zinc-500'}`}>
                            {booking.status === 'REFUNDED' ? 'Refunded' : booking.email_status === 'FAILED' ? 'Email failed' : booking.email_status === 'SENT' ? 'Emailed' : 'Unknown'}
                          </span>
                          {booking.status !== 'REFUNDED' && (
                            <button onClick={() => resendPasses(booking)} className="flex items-center gap-1 text-[9px] uppercase tracking-widest text-zinc-300 border border-white/10 rounded-lg px-3 py-1.5 hover:bg-white hover:text-black transition-all">
                              <Mail size={10} /> Resend
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {filteredBookings.length === 0 && (
                      <tr><td colSpan={6} className="p-10 text-center text-zinc-500 italic">No bookings found matching query.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

/**
 * How much of one booking has walked through the door.
 *
 * It shows people rather than passes, because a group pass is one pass but several people and
 * can be half admitted — "1 of 5 in" is the thing an organiser at the gate needs to see.
 */
function DoorCell({ door, scans }: { door: ReturnType<typeof bookingAttendance>; scans?: ScanLogRow[] }) {
  const workedBy = admittedBy(scans);
  const tone =
    door.state === 'ALL_IN' ? 'text-green-500 border-green-500/30 bg-green-500/10'
    : door.state === 'PARTLY_IN' ? 'text-sky-400 border-sky-400/30 bg-sky-400/10'
    : door.state === 'REFUNDED' ? 'text-zinc-500 border-white/10 bg-white/5'
    : 'text-amber-400 border-amber-500/30 bg-amber-500/10';

  const Icon = door.state === 'ALL_IN' ? UserCheck : door.state === 'REFUNDED' ? UserX : CircleDashed;

  return (
    <>
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[9px] font-black uppercase tracking-widest ${tone}`}>
        <Icon size={11} /> {ATTENDANCE_LABEL[door.state]}
      </span>
      {door.state !== 'REFUNDED' && (
        <span className="block text-[9px] text-zinc-500 font-bold uppercase tracking-widest mt-1.5">
          {door.admitted} of {door.people} in
          {door.remaining > 0 ? ` · ${door.remaining} to come` : ''}
        </span>
      )}

      {/* Who waved them in. Only scan_log knows this, so without it a disputed entry has no
          answer at all. Several names appear when a group trickled in past different staff. */}
      {workedBy.length > 0 && (
        <span className="block mt-2 space-y-1">
          {workedBy.map((w) => (
            <span key={w.by} className="flex items-center gap-1.5 text-[9px] font-bold text-zinc-400" title={w.at ? new Date(w.at).toLocaleString('en-IN') : undefined}>
              <UserCheck size={9} className={w.role === 'ADMIN' ? 'text-brandRed shrink-0' : 'text-sky-400 shrink-0'} />
              <span className="truncate max-w-[130px]">{w.by}</span>
              <span className="text-zinc-600 shrink-0">+{w.admitted}</span>
              {/* Nobody scanned this one. Worth seeing the morning after, when a count is being
                  argued about and the question is which entries anyone actually verified. */}
              {w.manual && (
                <span className="shrink-0 text-[8px] font-black uppercase tracking-widest text-amber-400/80 border border-amber-500/25 rounded px-1">
                  by hand
                </span>
              )}
            </span>
          ))}
          {workedBy[0]?.at && (
            <span className="block text-[9px] text-zinc-600 font-bold">
              {new Date(workedBy[0].at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })}
            </span>
          )}
        </span>
      )}
    </>
  );
}