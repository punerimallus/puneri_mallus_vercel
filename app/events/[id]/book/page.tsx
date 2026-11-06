"use client";
import { useState, useEffect, useMemo, useRef, use } from 'react';
import { Mail, ArrowRight, Minus, Plus, Loader2, Ticket, Calendar, Clock, MapPin, Sparkles, Star, ShieldCheck, TrendingUp, ChevronRight, Hourglass, Phone, MessageSquare, Crown, AlarmClock, Info } from 'lucide-react';
import { useAlert } from '@/context/AlertContext';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import { waitForOrder, orderRef } from '@/lib/payments/client';
import { seatsLeft } from '@/lib/payments/seats';
import MyTickets from '@/components/MyTickets';
import { maskNumber, normalizeWhatsAppNumber } from '@/lib/whatsapp';
import { groupSizeOf, isGroup, pricePerPerson } from '@/lib/payments/groups';
import { salesStatus } from '@/lib/events/sales';
import { grossUpToPaise, MAX_GROUP_TICKETS_PER_ACCOUNT, MAX_TICKETS_PER_ACCOUNT } from '@/lib/payments/pricing';
import { formatAmount, formatRupees } from '@/lib/payments/format';
import { friendlyError } from '@/lib/user-errors';
import VenueMap, { type MapZone } from '@/components/VenueMap';
import VenuePanel from '@/components/VenuePanel';
import { emptyLayout, normalizeLayout, normalizeZone, zoneColor, type VenueLayout } from '@/lib/events/venue-layout';
import { TERMS, termsNumber } from '@/lib/events/terms';
import { PHASE_NOTICE, phaseAlert, saleHeadline } from '@/lib/events/sale-phase';
import { HELP_NOTE, SUPPORT_PHONE, SUPPORT_TEL_HREF, SUPPORT_WHATSAPP_HREF, VIP_ENQUIRY } from '@/lib/events/support';
import { onSale, sortForSale } from '@/lib/events/catalogue';
import { descriptionBullets } from '@/lib/events/description';
import { publiclyListed } from '@/lib/payments/comp';

/** Roughly the height of the fixed navbar, so a step heading is not scrolled under it. */
const NAVBAR_CLEARANCE = 116;

/** 0 = terms, 1 = where to send them, 2 = which passes. */
const STEP_TERMS = 0;
const STEP_EMAIL = 1;
const STEP_PASSES = 2;

export default function EventBookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = use(params);

  // 🔥 Tribe Loyalty States
  const [loyaltyBalance, setLoyaltyBalance] = useState(0);
  // Points tied up in another unfinished checkout of theirs; shown so the number makes sense.
  const [loyaltyHeld, setLoyaltyHeld] = useState(0);
  const [applyPoints, setApplyPoints] = useState(false);
  const MIN_REDEEM_THRESHOLD = 50;

  const [email, setEmail] = useState('');
  const [step, setStep] = useState(STEP_TERMS);
  // Ticked the box on the terms screen. Kept in state rather than storage on purpose: the
  // terms are the first thing anyone sees, every time, which is the point of putting them there.
  const [termsAgreed, setTermsAgreed] = useState(false);
  const [categories, setCategories] = useState<any[]>([]);
  const [eventData, setEventData] = useState<any>(null);
  // The event exists but is not on sale yet (scheduled), or has been taken down. Distinct from
  // "still loading", so the page can say which rather than showing an empty box office.
  const [eventMissing, setEventMissing] = useState(false);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  // When the seats this checkout reserved are given back, if the payment never completes.
  const [holdExpiresAt, setHoldExpiresAt] = useState<number | null>(null);
  const [holdSecondsLeft, setHoldSecondsLeft] = useState<number | null>(null);
  const [isMember, setIsMember] = useState(false);
  // Send the passes on WhatsApp too: only offered when the feature is on and the profile has a valid mobile.
  const [whatsappNumber, setWhatsappNumber] = useState<string | null>(null);
  const [whatsappOptIn, setWhatsappOptIn] = useState(true);
  // The server says whether WhatsApp is set up, so this never depends on a build-time flag matching exactly.
  const [whatsappServerOn, setWhatsappServerOn] = useState(false);
  const whatsappAvailable = whatsappServerOn && !!whatsappNumber;
  const [discountPercent, setDiscountPercent] = useState(0);
  // The venue map. Null until it loads, and it stays null for an event nobody has drawn one
  // for — then the page looks exactly as it did before, with no gap where a map would be.
  const [venueLayout, setVenueLayout] = useState<VenueLayout | null>(null);
  // Which category the buyer last touched, so the map and its card point at each other.
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [venueOpen, setVenueOpen] = useState(false);
  // Collapsed on a phone by default - see the block that renders it for why.
  const [detailsOpen, setDetailsOpen] = useState(false);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // The box office column, and the pane that scrolls inside it on a desktop. Both have to be
  // put back to the top when the step changes; see the effect below.
  const boxOfficeRef = useRef<HTMLDivElement | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const steppedOnce = useRef(false);

  const { showAlert } = useAlert();
  const router = useRouter();

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    fetch('/api/whatsapp/status').then((r) => r.json()).then((d) => setWhatsappServerOn(d?.enabled === true)).catch(() => undefined);
  }, []);

  useEffect(() => {
    async function init() {
      // Paused categories are fetched too. They are never buyable — the reservation refuses an
      // inactive category outright — but a room that lists GENERAL and silently omits VIP reads
      // as "there is no VIP", and people stop looking. Listed as "Coming soon" instead.
      const { data: catData } = await supabase.from('event_ticket_categories').select('*').eq('event_id', eventId);

      // comp_only categories (the ACCESS PASS) are dropped here rather than in the query: on a
      // database that has not had the access-pass migration, the column does not exist and a
      // .eq() on it would fail the whole fetch — this just keeps everything, which is right.
      if (catData) setCategories(sortForSale(catData.filter(publiclyListed)));

      // The room around the zones (stage, doors). A missing row or a database without the table
      // yet is not an error: there is simply no map, and the category list alone still sells.
      const { data: layoutRow } = await supabase
        .from('event_venue_layouts')
        .select('cols, rows, features, plan_url, plan_opacity')
        .eq('event_id', eventId)
        .maybeSingle();
      if (layoutRow) setVenueLayout(normalizeLayout(layoutRow));
      else if (catData?.some((c) => c.zone)) setVenueLayout(emptyLayout());

      try {
        const res = await fetch('/api/events');
        const events = await res.json();
        const currentEvent = Array.isArray(events) ? events.find((e: any) => e._id === eventId) : null;

        if (currentEvent) {
          setEventData(currentEvent);
          setDiscountPercent(currentEvent.memberDiscount || 0);
        } else if (Array.isArray(events)) {
          // The list came back fine and this event is not in it, which means it is scheduled for
          // later or has been pulled. Saying so beats an empty box office that looks broken.
          setEventMissing(true);
        }

        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('is_member, loyalty_points, loyalty_points_held, phone_number')
            .eq('id', user.id)
            .single();

          if (profile) {
            setIsMember(profile.is_member);
            // Points promised to another checkout of theirs cannot be spent here, and the server
            // enforces exactly this. Showing the raw balance would offer a discount that is then
            // refused at Proceed to Pay, which reads as a bug rather than as "finish your other tab".
            const held = profile.loyalty_points_held || 0;
            setLoyaltyBalance(Math.max(0, (profile.loyalty_points || 0) - held));
            setLoyaltyHeld(held);
            setWhatsappNumber(normalizeWhatsAppNumber(profile.phone_number));
          }
        }
      } catch (e) {}

      setLoading(false);
    }
    init();
  }, [eventId]);

  // A category an admin has paused is visible but not buyable (lib/events/catalogue.ts).
  const liveCategories = useMemo(() => categories.filter(onSale), [categories]);

  const totalTickets = Object.values(cart).reduce((a, b) => a + b, 0);

  // Calculate base price with tier discounts
  const baseDiscountedPrice = categories.reduce((sum, cat) => {
    let catPrice = cat.price;
    if (isMember && discountPercent > 0) {
      catPrice = cat.price - ((cat.price * discountPercent) / 100);
    }
    return sum + (catPrice * (cart[cat.id] || 0));
  }, 0);

  // 🔥 Calculate actual redemption automatically based on toggle
  // Whole rupees, exactly as the server applies them, always leaving at least Rs 1 to pay.
  const maxRedeemable = Math.max(0, Math.min(loyaltyBalance, Math.floor(baseDiscountedPrice - 1)));
  const pointsToRedeem = applyPoints && loyaltyBalance >= MIN_REDEEM_THRESHOLD && maxRedeemable >= 1 ? maxRedeemable : 0;
  const totalPrice = baseDiscountedPrice - pointsToRedeem;
  const salesClosed = salesStatus(eventData?.date, eventData?.time) === 'CLOSED';
  // Same formula the server charges with, so the amount shown is the amount debited, to the paisa.
  const chargePaise = grossUpToPaise(totalPrice);
  const feeAmount = chargePaise / 100 - totalPrice;
  const headline = saleHeadline(eventData?.salesHeadline);
  const nextPhase = phaseAlert(eventData?.phaseAlert);
  const venueName = eventData?.location || 'Venue TBA';
  const details = descriptionBullets(eventData?.description);

  // Group tickets and single tickets have their own per-account limits (the server enforces them too).
  const groupTicketsInCart = categories.reduce((n, c) => n + (isGroup(c.group_size) ? cart[c.id] || 0 : 0), 0);
  const singleTicketsInCart = totalTickets - groupTicketsInCart;
  const hasGroupCategory = liveCategories.some((c) => isGroup(c.group_size));

  // The zones to draw. Only categories an admin has actually placed appear here; anything
  // unplaced still sells from the list below, it is just not on the plan.
  const mapZones: MapZone[] = useMemo(() => {
    if (!venueLayout) return [];
    const out: MapZone[] = [];
    // Index by price so a zone's colour is stable: dearest keeps its colour as stock changes.
    categories.forEach((cat, i) => {
      const zone = normalizeZone(cat.zone, venueLayout.cols, venueLayout.rows);
      if (!zone) return;
      const price = isMember && discountPercent > 0 ? cat.price - (cat.price * discountPercent) / 100 : cat.price;
      out.push({
        id: cat.id,
        name: cat.name,
        price,
        cells: zone.cells,
        color: zone.color || zoneColor(i),
        left: seatsLeft(cat),
        qty: cart[cat.id] || 0,
        admits: groupSizeOf(cat.group_size),
        comingSoon: !onSale(cat),
      });
    });
    return out;
  }, [categories, venueLayout, cart, isMember, discountPercent]);

  const updateCart = (id: string, delta: number, remaining: number) => {
    if (salesClosed && delta > 0) { showAlert('Ticket sales for this event have closed.', 'error'); return; }
    const cat = categories.find((c) => c.id === id);
    // The reservation refuses a paused category anyway; refusing it here means the buyer finds
    // out now rather than at Proceed to Pay.
    if (delta > 0 && cat && !onSale(cat)) { showAlert(`"${cat.name}" is not on sale yet.`, 'info'); return; }
    const currentQty = cart[id] || 0;
    const newQty = currentQty + delta;
    if (newQty < 0) return;
    if (newQty > remaining) {
      showAlert(`Only ${remaining} passes left in this category!`, "error");
      return;
    }
    if (delta > 0) {
      if (isGroup(cat?.group_size)) {
        if (groupTicketsInCart >= MAX_GROUP_TICKETS_PER_ACCOUNT) {
          showAlert(`Maximum ${MAX_GROUP_TICKETS_PER_ACCOUNT} group tickets per account`, "error");
          return;
        }
      } else if (singleTicketsInCart >= MAX_TICKETS_PER_ACCOUNT) {
        showAlert(`Maximum ${MAX_TICKETS_PER_ACCOUNT} passes per account`, "error");
        return;
      }
    }
    setCart({ ...cart, [id]: newQty });
  };

  /**
   * Tapping a zone on the map. The first tap adds one pass, so the map is a real way to buy
   * rather than a picture; after that it only scrolls to the card, where the +/- control lives.
   * Either way the card is brought into view, so the buyer sees the price they just committed to.
   */
  const pickZone = (id: string) => {
    const cat = categories.find((c) => c.id === id);
    if (!cat) return;
    setActiveCategory(id);
    if (onSale(cat)) {
      const remaining = seatsLeft(cat) ?? Number.MAX_SAFE_INTEGER;
      if (!(cart[id] || 0)) updateCart(id, 1, remaining);
    }
    cardRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // Decide what to show once the server knows the order's fate. Called after the
  // handler (success or failure) and when the modal is closed without one, because
  // a UPI/app payment can complete even though the checkout tab never reports it.
  /** Returns true if any money was taken, so the caller knows whether the seats are still ours to release. */
  const settleOrder = async (orderId: string, { fromDismiss = false } = {}): Promise<boolean> => {
    if (!fromDismiss) showAlert("Payment received. Confirming your passes...", "success");
    const result = await waitForOrder(orderId, { stopIfUnpaid: fromDismiss, timeoutMs: fromDismiss ? 12_000 : 45_000 });

    if (result.status === 'FULFILLED' && result.bookingId) {
      showAlert("Passes Secured Successfully!", "success");
      router.push(`/tickets/${result.bookingId}`);
      return true;
    }
    setProcessing(false);
    if (result.status === 'REFUND_INITIATED') {
      showAlert(`We took your payment but could not issue the passes, so we have already refunded it in full (5-7 working days). Ref: ${orderRef(orderId)}`, "error");
      return true;
    }
    if (result.status === 'NEEDS_ATTENTION') {
      showAlert(`We received your payment but could not issue passes (${result.reason || 'please contact support'}). Our team has been alerted and will refund it. Ref: ${orderRef(orderId)}`, "error");
      return true;
    }
    if (result.status === 'CREATED' || result.status === 'FAILED') {
      if (!fromDismiss) showAlert(`Payment not confirmed. If money was debited it will be auto-refunded or your passes emailed. Ref: ${orderRef(orderId)}`, "error");
      return false;
    }
    if (!fromDismiss || result.status !== 'UNKNOWN') {
      showAlert(`Payment received. Your passes will be emailed to ${email} shortly. Ref: ${orderRef(orderId)}`, "success");
      return true;
    }
    // Dismissed and we genuinely cannot tell: assume nothing was paid, but do not release the
    // seats on a guess — the hold lapses on its own.
    return true;
  };

  /**
   * Every step starts at the top of itself.
   *
   * The terms are a long read, so by the time somebody presses Accept they are scrolled most of
   * a screen down. React swaps in the next step but the scroll position is not part of that, so
   * they landed in the middle of the email field — or below it — and had to scroll back up to
   * find what they were being asked for. Two scrollers can be out of position: the pane inside
   * the card (desktop) and the page itself (phone), so both are reset.
   *
   * Skipped on first render: arriving at the page should not yank it anywhere.
   */
  useEffect(() => {
    if (!steppedOnce.current) { steppedOnce.current = true; return; }
    if (paneRef.current) paneRef.current.scrollTop = 0;

    // The column, not the whole page: on a phone the poster and venue sit above the box office,
    // and going to the very top would mean scrolling back past them to reach the form.
    //
    // Done by hand rather than with scrollIntoView + scroll-margin, because the navbar is fixed
    // and would otherwise sit on top of the heading we just scrolled to. Instant, not smooth: a
    // step change is a navigation, and nobody wants to watch a screenful of terms slide past.
    const column = boxOfficeRef.current;
    if (!column) return;
    const top = column.getBoundingClientRect().top + window.scrollY - NAVBAR_CLEARANCE;
    window.scrollTo({ top: Math.max(0, top), behavior: 'instant' as ScrollBehavior });
  }, [step]);

  // Counts the hold down once per second while a checkout is open.
  useEffect(() => {
    if (holdExpiresAt === null) {
      setHoldSecondsLeft(null);
      return;
    }
    const tick = () => setHoldSecondsLeft(Math.max(0, Math.round((holdExpiresAt - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [holdExpiresAt]);

  /**
   * The buyer closed the Razorpay window without paying. Their seats were reserved before
   * checkout opened, so tell the server at once and put them back on sale rather than letting
   * the 15-minute hold run down — during a busy drop that stock matters.
   */
  const releaseHeldSeats = (orderId: string) => {
    fetch('/api/razorpay/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId }),
      keepalive: true,
    }).catch(() => undefined);
  };

  const processPayment = async () => {
    if (processing) return;
    setProcessing(true);
    try {
      const orderRes = await fetch('/api/razorpay/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentType: 'EVENT_TICKET', cart, eventId, pointsToRedeem, email, whatsappOptIn: whatsappAvailable && whatsappOptIn })
      });
      const orderData = await orderRes.json();
      if (!orderRes.ok) throw new Error(orderData.error);

      // The server has already taken these seats, the ticket numbers and any points. Nothing
      // can be sold out from under this buyer now; they just have to pay within the hold.
      if (orderData.holdExpiresAt) setHoldExpiresAt(new Date(orderData.holdExpiresAt).getTime());

      let handled = false;
      const options = {
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        amount: orderData.amount,
        currency: "INR",
        name: "PUNERI MALLUS",
        description: eventData?.title || `Event Passes`,
        order_id: orderData.id,
        theme: { color: "#FF0000" },
        prefill: { email },
        handler: async function (response: any) {
          handled = true;
          try {
            // Only the payment proof is sent. What was bought is already stored on the server.
            const verifyRes = await fetch('/api/tickets/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              })
            });

            const verifyData = await verifyRes.json();
            if (verifyData.success && verifyData.bookingId) {
              showAlert("Passes Secured Successfully!", "success");
              router.push(`/tickets/${verifyData.bookingId}`);
              return;
            }
          } catch {
            // Fall through to polling: the payment may well have gone through.
          }
          await settleOrder(orderData.id);
        },
        modal: {
          ondismiss: () => {
            setProcessing(false);
            // Quietly check in the background in case the payment completed in a UPI app.
            // Only once that comes back unpaid do we hand the seats back, so a payment that
            // landed late is never mistaken for an abandoned checkout.
            if (!handled) {
              settleOrder(orderData.id, { fromDismiss: true }).then((paid) => {
                if (!paid) releaseHeldSeats(orderData.id);
              });
            }
          }
        }
      };

      const rzp = new (window as any).Razorpay(options);
      rzp.on('payment.failed', (resp: any) => {
        showAlert(resp?.error?.description || "Payment failed. You can retry.", "error");
      });
      rzp.open();
    } catch (err: any) {
      showAlert(friendlyError(err, "Checkout could not start. Please try again."), "error");
      setProcessing(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-[#030303] flex flex-col items-center justify-center gap-4">
      <Loader2 className="animate-spin text-brandRed" size={32} />
      <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Accessing Box Office...</p>
    </div>
  );

  return (
    /* items-start + my-auto on the card, not items-center: centring a flex item TALLER than its
       container overflows it in both directions, which slid the top of the card up under the
       fixed navbar on a short window. An auto margin centres short content and refuses to push
       tall content past the top edge. */
    <div className="min-h-screen relative flex items-start justify-center pt-28 sm:pt-32 pb-14 sm:pb-20 px-3 sm:px-4 md:px-8 selection:bg-brandRed/30">

      {/* 🌟 ENHANCED CINEMATIC BACKGROUND */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden bg-[#030303]">
        {/* The event artwork. Built by scripts/make-boxoffice-bg.mjs, which only resizes and
            compresses it — it is meant to be seen as a picture, not as a wash of colour.

            Bump the ?v= whenever the file is regenerated: the path does not change, so browsers
            and the CDN will otherwise keep serving the old one from cache. */}
        {/* Two crops, one job. The background is fixed to the viewport, so a phone gets a tall
            narrow box and object-cover would scale the landscape file up until only its middle
            quarter showed — which on this poster is the title and the date. The portrait file is
            cropped from the side instead. One <picture> so the browser fetches only one. */}
        <picture>
          <source media="(max-width: 767px)" srcSet="/events/boxoffice-bg-portrait.jpg?v=4" />
          <img
            src="/events/boxoffice-bg.jpg?v=4"
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover"
          />
        </picture>
        <div className="absolute top-[-20%] left-[-10%] w-[50vw] h-[50vw] bg-brandRed/10 blur-[120px] rounded-full mix-blend-screen" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[40vw] h-[40vw] bg-brandRed/15 blur-[150px] rounded-full mix-blend-screen" />

        {eventData?.image && (
          <img
            src={eventData.image}
            alt="bg"
            className="absolute inset-0 w-full h-full object-cover blur-[100px] opacity-25 scale-110 saturate-200"
          />
        )}
        {/* Kept light. transparent-at-centre to black-at-edges darkens the EDGES hardest, and the
            edges are the only part the card does not already cover — at 80%, then 60%, this was
            blacking out the one strip of artwork anybody could actually see. */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_transparent_30%,_#030303_120%)] opacity-40" />
      </div>

      {/* Tickets are not on sale yet (or the event was pulled). Everything below needs an event,
          so this is the whole page rather than a banner on top of an empty box office. */}
      {eventMissing ? (
        <div className="relative z-10 my-auto w-full max-w-md bg-zinc-950/80 backdrop-blur-2xl border border-white/10 rounded-[40px] p-10 text-center shadow-[0_30px_100px_rgba(0,0,0,0.8)]">
          <Hourglass className="mx-auto text-brandRed mb-5" size={32} />
          <h1 className="text-2xl font-black uppercase italic tracking-tighter text-white">Not on sale yet</h1>
          <p className="text-xs text-zinc-400 font-semibold leading-relaxed mt-4">
            This event has not opened for booking. Keep an eye on our events page — passes go live soon.
          </p>
          <a href="/events" className="mt-8 inline-flex items-center justify-center gap-2 w-full py-4 bg-brandRed text-white rounded-2xl font-black uppercase tracking-[0.2em] text-[10px] hover:bg-white hover:text-black transition-all active:scale-95">
            See all events <ArrowRight size={14} />
          </a>
        </div>
      ) : (

      /* MAIN CARD. Translucent over the photograph rather than opaque, and a shade less so on a
         phone, where the card is the whole screen and an opaque one would hide the background
         completely. backdrop-blur keeps the type off the texture. */
      <div className="relative z-10 my-auto w-full max-w-[1100px] bg-zinc-950/80 md:bg-zinc-950/70 backdrop-blur-3xl border border-white/10 rounded-[28px] sm:rounded-[40px] shadow-[0_30px_100px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col md:flex-row md:min-h-[650px] ring-1 ring-white/5">

        {/* LEFT COLUMN: WHAT YOU ARE BUYING
            Two different shapes, on purpose. On a desktop the poster leads: there is room for
            it and it is the reason anyone came. On a phone it shrinks to a thumbnail beside the
            title, because as a full-width 4:5 block it pushed the date, the venue and the whole
            box office below the fold — on a 390px screen that is most of a scroll before the
            first thing you can act on, and most people are on a phone. The date, time and venue
            now land in the first screenful either way. */}
        <div className="w-full md:w-5/12 bg-black/40 md:bg-black/50 p-5 sm:p-7 md:p-8 border-b md:border-b-0 md:border-r border-white/5 flex flex-col relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-40 bg-brandRed/15 blur-[60px] pointer-events-none" />

          {/* In the flow rather than pinned to the corner: absolutely positioned, it sat on top
              of the thumbnail as soon as the layout went horizontal. */}
          <div className="relative z-20 self-start mb-4 md:mb-5 flex items-center gap-2 bg-black/60 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-full shadow-xl">
            <span className="w-2 h-2 rounded-full bg-brandRed animate-pulse" />
            <span className="text-[9px] font-black uppercase tracking-widest text-white">Live Event</span>
          </div>

          <div className="relative z-10 flex md:block items-start gap-4 sm:gap-5">
            <div className="w-[88px] sm:w-28 md:w-full shrink-0 aspect-[4/5] relative rounded-2xl md:rounded-3xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.6)] md:mb-8 border border-white/10 group">
              {eventData?.image ? (
                <img src={eventData.image} className="w-full h-full object-cover md:group-hover:scale-105 transition-transform duration-1000 ease-out" alt={eventData.title} />
              ) : (
                <div className="w-full h-full bg-zinc-900 flex items-center justify-center">
                  <Ticket className="text-zinc-700 w-7 h-7 md:w-12 md:h-12" />
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1 space-y-3 md:space-y-4">
              <h1 className="text-xl sm:text-2xl md:text-4xl font-black uppercase italic tracking-tighter text-white leading-[0.95] drop-shadow-lg break-words">
                {eventData?.title || 'Exclusive Event'}
              </h1>

              {/* Side by side on a phone, so the pair costs one line instead of two. */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 md:block md:space-y-3 md:pt-5 md:border-t md:border-white/10">
                <div className="flex items-center gap-2 md:gap-3 text-zinc-300 text-[11px] md:text-xs font-bold uppercase tracking-widest">
                  <Calendar className="text-brandRed shrink-0 w-3.5 h-3.5 md:w-4 md:h-4" />
                  <span className="truncate">{eventData?.date || 'TBA'}</span>
                </div>
                <div className="flex items-center gap-2 md:gap-3 text-zinc-300 text-[11px] md:text-xs font-bold uppercase tracking-widest">
                  <Clock className="text-brandRed shrink-0 w-3.5 h-3.5 md:w-4 md:h-4" />
                  <span className="truncate">{eventData?.time || 'TBA'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* The venue spans the full width under both, at every size. It is the one detail here
              that is also a control — it opens the plan of the room — so it has to read as a
              button rather than as the third line of a list. */}
          <button
            type="button"
            onClick={() => setVenueOpen(true)}
            className="group relative z-10 mt-4 md:mt-3 w-full flex items-center gap-3 text-left rounded-2xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/25 px-4 py-3.5 transition-all active:scale-[0.98]"
          >
            <MapPin size={16} className="text-brandRed shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block text-[8px] font-black uppercase tracking-[0.25em] text-zinc-500 mb-1">Venue</span>
              <span className="block text-xs font-bold uppercase tracking-widest text-zinc-100 leading-relaxed line-clamp-2">{venueName}</span>
            </span>
            <span className="shrink-0 flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-brandRed">
              <span className="hidden sm:inline">{mapZones.length > 0 ? 'Seating plan' : 'View venue'}</span>
              <ChevronRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
            </span>
          </button>

          {/* What the event actually is: the same points the events page lists, from the same
              field, so there is one place to edit them and the two screens cannot disagree.

              Under the venue rather than above it because the venue is a control, not a line of
              text, and pushing it down the column makes it read as part of this list.

              Open on a desktop, folded on a phone. The comment at the top of this column
              explains the shape it is in: the poster was shrunk to a thumbnail precisely so the
              date, the venue and the box office all land in the first screenful at 390px. A
              six-point list expanded here costs about 250px and undoes that, putting the first
              thing a buyer can act on back below the fold. Folded, the heading still says the
              details are there, and one tap opens them. */}
          {details.length > 0 && (
            <div className="relative z-10 mt-4 md:mt-6 md:pt-6 md:border-t md:border-white/10">
              <button
                type="button"
                onClick={() => setDetailsOpen((v) => !v)}
                aria-expanded={detailsOpen}
                className="md:hidden w-full flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] px-4 py-3 transition-all active:scale-[0.98]"
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <Info size={14} className="text-brandRed shrink-0" />
                  <span className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-200">Event details</span>
                </span>
                <ChevronRight
                  size={14}
                  className={`shrink-0 text-brandRed transition-transform ${detailsOpen ? 'rotate-90' : ''}`}
                />
              </button>

              <p className="hidden md:flex items-center gap-2 text-[8px] font-black uppercase tracking-[0.25em] text-zinc-500 mb-4">
                <Info size={11} className="text-brandRed" /> Event details
              </p>

              <ul className={`${detailsOpen ? 'block' : 'hidden'} md:block space-y-2.5 md:space-y-3 mt-3 md:mt-0`}>
                {details.map((point, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="mt-[7px] shrink-0 w-1.5 h-1.5 rounded-full bg-brandRed shadow-[0_0_8px_#FF0000]" />
                    <span className="min-w-0 text-[11px] md:text-xs text-zinc-300 font-medium italic leading-relaxed break-words">
                      {point}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: BOX OFFICE FLOW */}
        <div ref={boxOfficeRef} className="w-full md:w-7/12 flex flex-col relative bg-zinc-950/30">

          <div className="p-6 sm:p-8 pb-5 sm:pb-6 border-b border-white/5 flex flex-col items-center justify-center text-center">
            <Ticket className="text-brandRed mb-2.5 sm:mb-3 drop-shadow-[0_0_15px_rgba(255,0,0,0.5)] w-7 h-7 sm:w-8 sm:h-8" />
            <h2 className="text-2xl md:text-3xl font-black uppercase italic tracking-tighter drop-shadow-md">Box <span className="text-brandRed">Office</span></h2>
            {/* Two lines rather than one: "Puneri Mallus Official Ticketing Portal" set as a
                single tracked-out string wraps badly at 390px and reads as a sentence fragment. */}
            <p className="text-[10px] text-zinc-400 font-black uppercase tracking-[0.3em] mt-2">Puneri Mallus</p>
            <p className="text-[9px] text-zinc-600 font-black uppercase tracking-[0.25em] sm:tracking-[0.3em] mt-1">Official Ticketing Portal</p>
          </div>

          {/* Which phase is on. Set from the box office, so it can change without a deploy. */}
          {headline && (
            <div className="shrink-0 bg-gradient-to-r from-brandRed/20 via-brandRed/10 to-transparent border-b border-brandRed/25 px-6 py-3.5 flex items-center justify-center gap-2.5">
              <span className="w-1.5 h-1.5 rounded-full bg-brandRed animate-pulse shrink-0" />
              <p className="text-[10px] sm:text-[11px] font-black uppercase tracking-[0.2em] text-white text-center leading-relaxed">{headline}</p>
            </div>
          )}

          {/* The next phase, when the box office has set one.
              Deliberately outside the scrolling pane below, so it holds its place through all
              three steps - terms, email, cart - rather than scrolling away on the longest one.
              Loud on purpose: it is the only thing on this screen that costs the buyer money
              if they put the decision off, so it is sized and coloured to be read first. */}
          {nextPhase && (
            <div className="shrink-0 border-b border-brandRed/30 bg-black/50 px-4 sm:px-6 py-3 sm:py-4">
              <div className="flex items-center justify-center gap-2 sm:gap-2.5">
                <AlarmClock className="phase-alert-icon shrink-0 w-4 h-4 sm:w-5 sm:h-5" strokeWidth={2.5} />
                <p className="phase-alert-text text-center font-black uppercase italic tracking-tight leading-tight text-base sm:text-lg md:text-xl">
                  {nextPhase}
                </p>
              </div>
            </div>
          )}

          <div ref={paneRef} className="flex-1 min-h-0 p-5 sm:p-7 md:p-8 pb-6 overflow-y-auto custom-scrollbar">
            {salesClosed && (
              <div className="max-w-md mx-auto mb-6 p-4 rounded-2xl border border-red-500/30 bg-red-500/10 text-center">
                <p className="text-xs font-black uppercase tracking-widest text-red-400">Ticket sales have closed</p>
                <p className="text-[11px] text-zinc-400 mt-1">This event has already started.</p>
              </div>
            )}

            {/* Recent tickets, so a returning customer can find their passes without leaving.
                Hidden behind the terms so that first screen is only the thing being agreed to. */}
            {/* empty:hidden because MyTickets renders null for anyone with no bookings - which is
                most first-time buyers - and the wrapper's own margin would otherwise leave 32px
                of dead space under the phase banner on every step but the first. */}
            {step !== STEP_TERMS && (
              <div className="max-w-md mx-auto mb-8 empty:hidden">
                <MyTickets limit={3} highlightEventId={eventId} heading="Your recent tickets" />
              </div>
            )}

            {step === STEP_TERMS ? (
              <form
                className="space-y-7 max-w-md mx-auto"
                onSubmit={(e) => { e.preventDefault(); if (termsAgreed) setStep(STEP_EMAIL); }}
              >
                <div className="text-center space-y-3">
                  <ShieldCheck className="mx-auto text-brandRed" size={26} />
                  <h2 className="text-xl font-black uppercase tracking-widest text-white">Terms &amp; Conditions</h2>
                  <p className="text-[11px] text-zinc-500 font-semibold leading-relaxed px-2">
                    Please read these before you book. They are printed on your pass too.
                  </p>
                </div>

                {/* A contained, scrolling box on a desktop, where the whole list is one glance.
                    On a phone it flows instead and the page scrolls: a scroll area inside a
                    scroll area is miserable to use with a thumb, and for a legal gate making
                    someone pass the clauses on the way to the button is the right shape anyway. */}
                <ol className="sm:max-h-[52vh] sm:overflow-y-auto custom-scrollbar space-y-3.5 rounded-2xl border border-white/10 bg-black/50 p-4 sm:p-5 shadow-inner">
                  {TERMS.map((term, i) => (
                    <li key={i} className="flex gap-3 text-[11.5px] leading-relaxed text-zinc-300 font-medium">
                      <span className="shrink-0 font-black text-brandRed tabular-nums">{termsNumber(i)}</span>
                      <span>{term}</span>
                    </li>
                  ))}
                </ol>

                <label className="flex items-start gap-3 cursor-pointer rounded-2xl border border-white/10 bg-white/[0.03] p-4 hover:border-white/25 transition-all">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-brandRed w-4 h-4 shrink-0"
                    checked={termsAgreed}
                    onChange={(e) => setTermsAgreed(e.target.checked)}
                  />
                  <span className="text-[11px] font-bold tracking-wide text-zinc-300 leading-snug">
                    I have read and accept the terms and conditions above.
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={!termsAgreed}
                  className={`w-full py-5 font-black uppercase tracking-[0.2em] rounded-2xl flex justify-center items-center gap-3 transition-all duration-300 text-xs ${termsAgreed ? 'bg-brandRed text-white shadow-[0_0_30px_rgba(255,0,0,0.3)] hover:shadow-[0_0_50px_rgba(255,0,0,0.5)] active:scale-95' : 'bg-white/5 text-zinc-600 border border-white/5 cursor-not-allowed'}`}
                >
                  Accept &amp; Continue <ArrowRight size={16} />
                </button>

                {/* On the first screen, because this is where someone who is about to get stuck
                    still is. Links out rather than printing the number: the contact page takes a
                    written query, which is what a problem actually needs. */}
                <div className="rounded-2xl border border-white/10 bg-black/40 p-4 text-center">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-300">{HELP_NOTE.title}</p>
                  <p className="text-[11px] text-zinc-500 font-medium leading-relaxed mt-1.5">{HELP_NOTE.body}</p>
                  <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                    <a
                      href="/contact"
                      className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-white border border-white/15 bg-white/5 rounded-xl px-3.5 py-2.5 hover:bg-white hover:text-black transition-all"
                    >
                      <MessageSquare size={12} /> Contact page
                    </a>
                    <a
                      href={SUPPORT_TEL_HREF}
                      className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-brandRed border border-brandRed/30 bg-brandRed/10 rounded-xl px-3.5 py-2.5 hover:bg-brandRed hover:text-white transition-all"
                    >
                      <Phone size={12} /> {SUPPORT_PHONE}
                    </a>
                  </div>
                </div>
              </form>
            ) : step === STEP_EMAIL ? (
              <form
                className="space-y-10 mt-8 max-w-md mx-auto"
                onSubmit={(e) => { e.preventDefault(); if (email.includes('@')) setStep(STEP_PASSES); }}
              >
                <div className="text-center space-y-3">
                  <h2 className="text-xl font-black uppercase tracking-widest text-white">Digital Delivery</h2>
                  <p className="text-xs text-zinc-500 font-semibold leading-relaxed px-4">Your digital PDF passes and payment receipt will be securely dispatched to this address.</p>
                </div>

                <div className="relative group">
                  <Mail className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-brandRed transition-colors" size={18} />
                  <input
                    type="email" placeholder="ENTER YOUR EMAIL"
                    value={email} onChange={e => setEmail(e.target.value)}
                    className="w-full bg-black/60 border border-white/10 p-5 pl-14 rounded-2xl text-sm font-bold outline-none focus:border-brandRed focus:ring-1 focus:ring-brandRed/50 transition-all text-white uppercase tracking-widest shadow-inner placeholder:text-zinc-700"
                  />
                </div>

                <button
                  type="submit" disabled={!email.includes('@')}
                  className={`w-full py-5 font-black uppercase tracking-[0.2em] rounded-2xl flex justify-center items-center gap-3 transition-all duration-300 text-xs ${email.includes('@') ? 'bg-brandRed text-white shadow-[0_0_30px_rgba(255,0,0,0.3)] hover:shadow-[0_0_50px_rgba(255,0,0,0.5)] active:scale-95' : 'bg-white/5 text-zinc-600 border border-white/5 cursor-not-allowed'}`}
                >
                  Choose Your Category <ArrowRight size={16} />
                </button>
              </form>
            ) : (
              <div className="space-y-4">
                {/* Why buying today is cheaper than buying next week. Placed before the prices,
                    so it is read as context for them rather than as an excuse afterwards. */}
                <div className="mb-6 rounded-2xl border border-amber-500/25 bg-gradient-to-br from-amber-500/[0.12] to-transparent p-4 flex gap-3.5">
                  <TrendingUp size={18} className="text-amber-400 shrink-0 mt-0.5" />
                  <div className="min-w-0 space-y-1.5">
                    <p className="text-[11px] font-black uppercase tracking-widest text-amber-400">{PHASE_NOTICE.title}</p>
                    <p className="text-[11px] text-zinc-300 font-medium leading-relaxed">{PHASE_NOTICE.body}</p>
                  </div>
                </div>

                {/* Stacks on a phone: side by side, the heading wrapped to two lines and the
                    limits pill crowded into it. */}
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-3 mb-6 border-b border-white/5 pb-4">
                  <h2 className="text-lg font-black uppercase tracking-widest text-zinc-200 flex items-center gap-2 shrink-0">
                    <Sparkles size={16} className="text-brandRed shrink-0" /> Select Passes
                  </h2>
                  <p className="self-start sm:self-auto text-[9px] sm:text-[10px] text-brandRed font-black uppercase tracking-widest bg-brandRed/10 border border-brandRed/20 px-3 py-1.5 rounded-full shadow-inner leading-relaxed">
                    Max {MAX_TICKETS_PER_ACCOUNT} per account{hasGroupCategory ? ` · ${MAX_GROUP_TICKETS_PER_ACCOUNT} group tickets` : ''}
                  </p>
                </div>

                {venueLayout && mapZones.length > 0 && (
                  <VenueMap layout={venueLayout} zones={mapZones} onPick={pickZone} activeId={activeCategory} />
                )}

                <div className="space-y-3">
                  {categories.map(cat => {
                    const live = onSale(cat);
                    const qty = cart[cat.id] || 0;
                    const remaining = seatsLeft(cat) ?? Number.MAX_SAFE_INTEGER;
                    const isSoldOut = live && remaining <= 0;
                    const isFastFilling = live && remaining <= 10 && remaining > 0;

                    const hasActiveDiscount = isMember && discountPercent > 0;
                    const displayPrice = hasActiveDiscount
                      ? cat.price - ((cat.price * discountPercent) / 100)
                      : cat.price;

                    return (
                      <div
                        key={cat.id}
                        ref={(el) => { cardRefs.current[cat.id] = el; }}
                        onPointerEnter={() => setActiveCategory(cat.id)}
                        className={`bg-black/60 backdrop-blur-md border p-4 sm:p-5 rounded-2xl flex items-center justify-between gap-3 sm:gap-4 transition-all duration-300 ${!live ? 'border-white/5 bg-black/30' : isSoldOut ? 'border-zinc-900 opacity-50 grayscale' : activeCategory === cat.id ? 'border-white/40 bg-white/[0.04] shadow-lg' : 'border-white/10 hover:border-white/30 hover:bg-white/[0.02] shadow-lg'}`}
                      >
                        {/* min-w-0 lets a long category name wrap instead of shoving the button
                            off the card, and both rows wrap rather than overflowing on a phone. */}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                            <h3 className={`text-[13px] sm:text-sm font-black uppercase tracking-widest break-words ${live ? 'text-white' : 'text-zinc-400'}`}>{cat.name}</h3>
                            {isGroup(cat.group_size) && (
                               <span className="shrink-0 text-[8px] bg-white/10 border border-white/20 text-white px-2 py-0.5 rounded-full font-black uppercase tracking-widest">
                                 Group of {groupSizeOf(cat.group_size)}
                               </span>
                            )}
                            {live && hasActiveDiscount && (
                               <span className="shrink-0 text-[8px] bg-brandRed text-white px-2 py-0.5 rounded-full font-black uppercase tracking-widest flex items-center gap-1 shadow-[0_0_10px_rgba(255,0,0,0.4)]">
                                 <Star size={8} className="fill-white" /> Tribe Rate
                               </span>
                            )}
                          </div>

                          {/* A paused category shows its name and nothing else. The price is not
                              withheld to tease: the next phase has not been priced yet, and
                              printing today's number would be a promise we cannot keep. */}
                          {!live ? (
                            <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                              Opens in a later phase
                            </p>
                          ) : (
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2">
                            {hasActiveDiscount ? (
                               <div className="flex items-center gap-2">
                                 <p className="text-[10px] font-bold text-zinc-500 tracking-widest line-through">₹{formatAmount(cat.price)}</p>
                                 <p className="text-xs font-bold text-brandRed tracking-widest">₹{formatAmount(displayPrice)}</p>
                               </div>
                            ) : (
                               <p className="text-xs font-bold text-brandRed tracking-widest">₹{formatAmount(displayPrice)}</p>
                            )}
                            {isGroup(cat.group_size) && <p className="text-[10px] font-bold text-zinc-400 tracking-widest">admits {groupSizeOf(cat.group_size)} &middot; ₹{formatAmount(pricePerPerson(displayPrice, cat.group_size))} each</p>}
                            {isFastFilling && <span className="shrink-0 text-[9px] font-black uppercase text-orange-500 bg-orange-500/10 px-2 py-0.5 rounded-full animate-pulse border border-orange-500/20 shadow-[0_0_10px_rgba(249,115,22,0.2)]">Fast Filling</span>}
                            {isSoldOut && <span className="shrink-0 text-[9px] font-black uppercase text-zinc-500 bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded-full">Sold Out</span>}
                          </div>
                          )}
                        </div>

                        {!live ? (
                          <span className="shrink-0 bg-white/5 text-zinc-400 font-black text-[9px] uppercase tracking-widest px-4 sm:px-5 py-2.5 rounded-xl border border-white/10">Coming Soon</span>
                        ) : isSoldOut ? (
                          <button disabled className="shrink-0 bg-zinc-950 text-zinc-600 font-bold text-[10px] uppercase tracking-widest px-5 sm:px-6 py-2.5 rounded-xl border border-zinc-800">Sold Out</button>
                        ) : qty === 0 ? (
                          <button onClick={() => updateCart(cat.id, 1, remaining)} className="shrink-0 border border-white/20 bg-white/5 text-white font-bold text-[10px] uppercase tracking-widest px-5 sm:px-6 py-3 rounded-xl hover:bg-white hover:text-black transition-all active:scale-95 shadow-md">
                            Add
                          </button>
                        ) : (
                          <div className="shrink-0 flex items-center gap-3 sm:gap-4 bg-white text-black rounded-xl px-2 py-1.5 shadow-[0_0_15px_rgba(255,255,255,0.2)] ring-2 ring-white/50">
                            <button onClick={() => updateCart(cat.id, -1, remaining)} className="p-1.5 hover:text-brandRed transition-colors"><Minus size={14} /></button>
                            <span className="font-black text-sm w-4 text-center">{qty}</span>
                            <button onClick={() => updateCart(cat.id, 1, remaining)} className="p-1.5 hover:text-brandRed transition-colors"><Plus size={14} /></button>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {liveCategories.length === 0 && (
                    <p className="py-8 text-center text-[11px] font-bold uppercase tracking-widest text-zinc-500">
                      Nothing on sale right now. Check back shortly.
                    </p>
                  )}
                </div>

                {/* VIP and bulk are arranged by hand, so they are not in the list above. Said
                    here, under the passes, because that is where someone looking for VIP has
                    just finished not finding it. */}
                <div className="mt-6 rounded-2xl border border-white/12 bg-gradient-to-br from-white/[0.06] to-transparent p-4 flex flex-col sm:flex-row sm:items-center gap-3.5">
                  <Crown size={18} className="text-amber-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-black uppercase tracking-widest text-white">{VIP_ENQUIRY.title}</p>
                    <p className="text-[11px] text-zinc-400 font-medium leading-relaxed mt-1">{VIP_ENQUIRY.body}</p>
                  </div>
                  <div className="shrink-0 flex gap-2">
                    <a
                      href={SUPPORT_TEL_HREF}
                      className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-white border border-white/15 bg-white/5 rounded-xl px-3.5 py-2.5 hover:bg-white hover:text-black transition-all"
                    >
                      <Phone size={12} /> Call
                    </a>
                    <a
                      href={SUPPORT_WHATSAPP_HREF}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-white border border-green-500/40 bg-green-500/15 rounded-xl px-3.5 py-2.5 hover:bg-green-500 transition-all"
                    >
                      <MessageSquare size={12} /> WhatsApp
                    </a>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Checkout bar: sits below the pass list instead of floating over it, so it can grow (points, WhatsApp, price breakdown) without hiding anything */}
          {step === STEP_PASSES && totalTickets > 0 && (
            <div className="shrink-0 bg-zinc-950/95 backdrop-blur-2xl border-t border-white/10 p-5 sm:p-6 md:rounded-br-[40px] shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">

              {/* 🔥 THRESHOLD-LOCKED REDEMPTION TOGGLE */}
              {loyaltyBalance > 0 && (
                /* Wraps rather than squeezing: the balance line and the redeem toggle both have
                   real text in them and will not sit side by side at 390px. */
                <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl animate-in slide-in-from-bottom-4 flex flex-wrap justify-between items-center gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-black uppercase tracking-widest text-amber-500 flex items-center gap-2">
                      <Star size={12} className="fill-amber-500" /> Tribe Points
                    </span>
                    <span className="text-[9px] text-zinc-400 font-bold uppercase tracking-widest">
                      Balance: {loyaltyBalance} PTS
                      {loyaltyHeld > 0 && (
                        <span className="block text-[8px] text-zinc-500 normal-case tracking-normal font-bold mt-0.5">
                          {loyaltyHeld} held by another checkout
                        </span>
                      )}
                    </span>
                  </div>

                  {loyaltyBalance >= MIN_REDEEM_THRESHOLD && maxRedeemable < 1 ? (
                    <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 text-right max-w-[140px] leading-snug">Points can be used on larger orders</span>
                  ) : loyaltyBalance >= MIN_REDEEM_THRESHOLD ? (
                    <label className="flex items-center gap-3 cursor-pointer bg-black/40 px-3 py-2 rounded-xl border border-amber-500/30 hover:bg-black/60 transition-all">
                      <span className="text-xs font-bold text-amber-400">- ₹{maxRedeemable}</span>
                      <div className={`w-10 h-5 rounded-full p-1 transition-colors ${applyPoints ? 'bg-amber-500' : 'bg-zinc-700'}`}>
                        <div className={`w-3 h-3 bg-white rounded-full transition-transform ${applyPoints ? 'translate-x-5' : 'translate-x-0'}`} />
                      </div>
                      <input type="checkbox" className="hidden" checked={applyPoints} onChange={(e) => setApplyPoints(e.target.checked)} />
                    </label>
                  ) : (
                    <div className="text-right">
                      <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 block">Locked</span>
                      <span className="text-[8px] font-bold uppercase tracking-widest text-brandRed">
                        {MIN_REDEEM_THRESHOLD - loyaltyBalance} PTS more to unlock
                      </span>
                    </div>
                  )}
                </div>
              )}

              {whatsappAvailable && (
                <label className="mb-4 flex items-start gap-3 cursor-pointer rounded-2xl border border-white/10 bg-black/40 p-3">
                  <input type="checkbox" className="mt-0.5 accent-green-500 w-4 h-4" checked={whatsappOptIn} onChange={(e) => setWhatsappOptIn(e.target.checked)} />
                  <span className="text-[11px] font-bold tracking-wide text-zinc-300 leading-snug">
                    Also send my tickets on WhatsApp to <span className="text-white">{maskNumber(whatsappNumber)}</span>
                    <span className="block text-[10px] font-medium text-zinc-500">If this number isn't on WhatsApp, your email still has everything.</span>
                  </span>
                </label>
              )}
              <div className="mb-4 space-y-1.5 text-[11px] font-bold tracking-widest text-zinc-400">
                <div className="flex justify-between"><span>Tickets</span><span className="text-white">{formatRupees(baseDiscountedPrice).replace('Rs. ', '₹')}</span></div>
                {pointsToRedeem > 0 && <div className="flex justify-between text-amber-400"><span>Tribe points</span><span>- {formatRupees(pointsToRedeem).replace('Rs. ', '₹')}</span></div>}
                <div className="flex justify-between"><span>Payment gateway fee</span><span className="text-white">{formatRupees(feeAmount).replace('Rs. ', '₹')}</span></div>
              </div>
              {/* Seats are reserved the moment checkout opens, so say so and show the clock. */}
              {holdSecondsLeft !== null && (
                <div className="mb-4 flex items-center justify-center gap-2 rounded-2xl border border-green-500/25 bg-green-500/10 px-4 py-3">
                  <Clock size={13} className="text-green-400 shrink-0" />
                  <span className="text-[11px] font-black uppercase tracking-widest text-green-400">
                    {holdSecondsLeft > 0
                      ? `Your ${totalTickets === 1 ? 'seat is' : 'seats are'} held — ${Math.floor(holdSecondsLeft / 60)}:${String(holdSecondsLeft % 60).padStart(2, '0')} left to pay`
                      : 'Your hold has expired — please start again'}
                  </span>
                </div>
              )}

              {/* The amount and the call to action share one row, which only just fits at 390px:
                  "Proceed to Pay" at this weight and tracking needs ~195px and the price needs
                  ~110px, against ~262px of usable width. So the label drops to "Pay" on the
                  narrowest screens rather than wrapping the button into two lines. */}
              <button onClick={processPayment} disabled={processing || salesClosed} className="w-full bg-brandRed text-white py-4 sm:py-5 rounded-2xl font-black uppercase tracking-widest flex justify-between items-center gap-3 px-4 sm:px-6 disabled:opacity-50 text-xs shadow-[0_0_40px_rgba(255,0,0,0.3)] hover:shadow-[0_0_60px_rgba(255,0,0,0.5)] transition-all active:scale-[0.98]">
                {processing ? <Loader2 className="animate-spin mx-auto" /> : (
                  <>
                    <div className="min-w-0 flex flex-col items-start text-left">
                      <span className="text-[10px] text-white/80 tracking-widest">{totalTickets} Ticket{totalTickets > 1 ? 's' : ''}</span>
                      <span className="text-sm truncate">{formatRupees(chargePaise / 100).replace('Rs. ', '₹')} <span className="text-[9px] lowercase font-normal opacity-80">(inc. fee)</span></span>
                    </div>
                    <span className="shrink-0 flex items-center gap-2 text-[11px] sm:text-sm bg-black/20 px-3 sm:px-4 py-2 rounded-xl backdrop-blur-sm border border-white/10">
                      <span className="sm:hidden">Pay</span>
                      <span className="hidden sm:inline">Proceed to Pay</span>
                      <ArrowRight size={15} />
                    </span>
                  </>
                )}
              </button>
            </div>
          )}

        </div>
      </div>
      )}

      <VenuePanel
        open={venueOpen}
        onClose={() => setVenueOpen(false)}
        venue={venueName}
        mapUrl={eventData?.mapUrl}
        layout={venueLayout}
        zones={mapZones}
        activeId={activeCategory}
        // Picking from the plan only works once the pass list is on screen to scroll to.
        onPick={step === STEP_PASSES ? pickZone : undefined}
      />
    </div>
  );
}
