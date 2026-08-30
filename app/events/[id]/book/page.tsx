"use client";
import { useState, useEffect, use } from 'react'; 
import { Mail, ArrowRight, Minus, Plus, Loader2, Ticket, Calendar, Clock, MapPin, Sparkles } from 'lucide-react';
import { useAlert } from '@/context/AlertContext';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';

export default function EventBookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = use(params);

  const [email, setEmail] = useState('');
  const [step, setStep] = useState(1);
  const [categories, setCategories] = useState<any[]>([]);
  const [eventData, setEventData] = useState<any>(null); 
  const [cart, setCart] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  
  const { showAlert } = useAlert();
  const router = useRouter();
  
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    async function init() {
      const { data: catData } = await supabase.from('event_ticket_categories').select('*').eq('event_id', eventId).eq('active', true);
      
      if (catData) {
        // 🔥 SORT CATEGORIES BY PRICE (Lowest to Highest)
        const sortedCategories = catData.sort((a, b) => a.price - b.price);
        setCategories(sortedCategories);
      }
      
      try {
        const res = await fetch('/api/events');
        const events = await res.json();
        const currentEvent = events.find((e: any) => e._id === eventId);
        if (currentEvent) setEventData(currentEvent);
      } catch (e) {}

      setLoading(false);
    }
    init();
  }, [eventId]);

  const totalTickets = Object.values(cart).reduce((a, b) => a + b, 0);
  const totalPrice = categories.reduce((sum, cat) => sum + (cat.price * (cart[cat.id] || 0)), 0);

  const updateCart = (id: string, delta: number, remaining: number) => {
    const currentQty = cart[id] || 0;
    const newQty = currentQty + delta;
    if (newQty < 0) return;
    if (newQty > remaining) {
      showAlert(`Only ${remaining} passes left in this category!`, "error");
      return;
    }
    if (delta > 0 && totalTickets >= 10) {
      showAlert("Maximum 10 passes per transaction", "error");
      return;
    }
    setCart({ ...cart, [id]: newQty });
  };

  const processPayment = async () => {
    setProcessing(true);
    try {
      const orderRes = await fetch('/api/razorpay/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentType: 'EVENT_TICKET', cart, eventId }) 
      });
      const orderData = await orderRes.json();
      if (!orderRes.ok) throw new Error(orderData.error);

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
          try {
            const verifyRes = await fetch('/api/tickets/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                cart, email, eventId, totalAmount: totalPrice,
                eventData 
              })
            });

            const verifyData = await verifyRes.json();
            if (verifyData.success) {
              showAlert("Passes Secured Successfully!", "success");
              router.push('/'); 
            } else throw new Error("Verification failed.");
          } catch (err) {
            showAlert("Verification Failed", "error");
          }
        },
        modal: { ondismiss: () => setProcessing(false) }
      };

      const rzp = new (window as any).Razorpay(options);
      rzp.open();
    } catch (err: any) {
      showAlert(err.message || "Failed to initiate gateway", "error");
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
    <div className="min-h-screen relative flex items-center justify-center pt-32 pb-20 px-4 md:px-8 selection:bg-brandRed/30">
      
      {/* 🌟 ENHANCED CINEMATIC BACKGROUND */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden bg-[#030303]">
        {/* Ambient Concert Lighting Orbs */}
        <div className="absolute top-[-20%] left-[-10%] w-[50vw] h-[50vw] bg-brandRed/10 blur-[120px] rounded-full mix-blend-screen" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[40vw] h-[40vw] bg-brandRed/15 blur-[150px] rounded-full mix-blend-screen" />
        
        {eventData?.image && (
          <img 
            src={eventData.image} 
            alt="bg" 
            className="absolute inset-0 w-full h-full object-cover blur-[100px] opacity-25 scale-110 saturate-200" 
          />
        )}
        {/* Deep Vignette */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_transparent_0%,_#030303_100%)] opacity-80" />
      </div>

      {/* MAIN PREMIUM SPLIT CARD */}
      <div className="relative z-10 w-full max-w-[1100px] bg-zinc-950/70 backdrop-blur-3xl border border-white/10 rounded-[40px] shadow-[0_30px_100px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col md:flex-row min-h-[650px] ring-1 ring-white/5">
        
        {/* LEFT COLUMN: EVENT POSTER & DETAILS */}
        <div className="w-full md:w-5/12 bg-black/50 p-8 border-b md:border-b-0 md:border-r border-white/5 flex flex-col relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-40 bg-brandRed/15 blur-[60px] pointer-events-none" />
          
          {/* Live Indicator */}
          <div className="absolute top-10 left-10 z-20 flex items-center gap-2 bg-black/60 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-full shadow-xl">
            <span className="w-2 h-2 rounded-full bg-brandRed animate-pulse" />
            <span className="text-[9px] font-black uppercase tracking-widest text-white">Live Event</span>
          </div>

          <div className="relative w-full aspect-[4/5] rounded-3xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.6)] mb-8 border border-white/10 group">
            {eventData?.image ? (
              <img src={eventData.image} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-1000 ease-out" alt={eventData.title} />
            ) : (
              <div className="w-full h-full bg-zinc-900 flex items-center justify-center">
                <Ticket className="text-zinc-700" size={48} />
              </div>
            )}
          </div>

          <div className="space-y-4 relative z-10">
            <h1 className="text-3xl md:text-4xl font-black uppercase italic tracking-tighter text-white leading-none drop-shadow-lg">
              {eventData?.title || 'Exclusive Event'}
            </h1>
            
            <div className="space-y-3 pt-5 border-t border-white/10">
              <div className="flex items-center gap-3 text-zinc-300 text-xs font-bold uppercase tracking-widest">
                <Calendar size={16} className="text-brandRed shrink-0" /> 
                <span className="truncate">{eventData?.date || 'TBA'}</span>
              </div>
              <div className="flex items-center gap-3 text-zinc-300 text-xs font-bold uppercase tracking-widest">
                <Clock size={16} className="text-brandRed shrink-0" /> 
                <span className="truncate">{eventData?.time || 'TBA'}</span>
              </div>
              <div className="flex items-start gap-3 text-zinc-300 text-xs font-bold uppercase tracking-widest">
                <MapPin size={16} className="text-brandRed shrink-0 mt-0.5" /> 
                <span className="line-clamp-2 leading-relaxed">{eventData?.location || 'Venue TBA'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: BOX OFFICE FLOW */}
        <div className="w-full md:w-7/12 flex flex-col relative bg-zinc-950/30">
          
          <div className="p-8 pb-6 border-b border-white/5 flex flex-col items-center justify-center text-center">
            <Ticket className="text-brandRed mb-3 drop-shadow-[0_0_15px_rgba(255,0,0,0.5)]" size={32} />
            <h2 className="text-2xl md:text-3xl font-black uppercase italic tracking-tighter drop-shadow-md">Box <span className="text-brandRed">Office</span></h2>
            <p className="text-[10px] text-zinc-400 font-black uppercase tracking-[0.3em] mt-2">Official Ticketing Portal</p>
          </div>

          <div className="flex-1 p-8 overflow-y-auto pb-32 custom-scrollbar">
            {step === 1 ? (
              <div className="space-y-10 mt-8 max-w-md mx-auto">
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
                  disabled={!email.includes('@')} onClick={() => setStep(2)}
                  className={`w-full py-5 font-black uppercase tracking-[0.2em] rounded-2xl flex justify-center items-center gap-3 transition-all duration-300 text-xs ${email.includes('@') ? 'bg-brandRed text-white shadow-[0_0_30px_rgba(255,0,0,0.3)] hover:shadow-[0_0_50px_rgba(255,0,0,0.5)] active:scale-95' : 'bg-white/5 text-zinc-600 border border-white/5 cursor-not-allowed'}`}
                >
                  Choose Your Category <ArrowRight size={16} />
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex justify-between items-end mb-6 border-b border-white/5 pb-4">
                  <h2 className="text-lg font-black uppercase tracking-widest text-zinc-200 flex items-center gap-2">
                    <Sparkles size={16} className="text-brandRed" /> Select Passes
                  </h2>
                  <p className="text-[10px] text-brandRed font-black uppercase tracking-widest bg-brandRed/10 border border-brandRed/20 px-3 py-1.5 rounded-full shadow-inner">Max 10 per order</p>
                </div>

                <div className="space-y-3">
                  {categories.map(cat => {
                    const qty = cart[cat.id] || 0;
                    const remaining = cat.capacity - cat.sold;
                    const isSoldOut = remaining <= 0;
                    const isFastFilling = remaining <= 10 && remaining > 0;

                    return (
                      <div key={cat.id} className={`bg-black/60 backdrop-blur-md border p-5 rounded-2xl flex justify-between items-center transition-all duration-300 ${isSoldOut ? 'border-zinc-900 opacity-50 grayscale' : 'border-white/10 hover:border-white/30 hover:bg-white/[0.02] shadow-lg'}`}>
                        <div>
                          <h3 className="text-sm font-black text-white uppercase tracking-widest">{cat.name}</h3>
                          <div className="flex items-center gap-3 mt-1.5">
                            <p className="text-xs font-bold text-brandRed tracking-widest">₹{cat.price.toLocaleString('en-IN')}</p>
                            {isFastFilling && <span className="text-[9px] font-black uppercase text-orange-500 bg-orange-500/10 px-2 py-0.5 rounded-full animate-pulse border border-orange-500/20 shadow-[0_0_10px_rgba(249,115,22,0.2)]">Fast Filling</span>}
                            {isSoldOut && <span className="text-[9px] font-black uppercase text-zinc-500 bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded-full">Sold Out</span>}
                          </div>
                        </div>
                        
                        {isSoldOut ? (
                          <button disabled className="bg-zinc-950 text-zinc-600 font-bold text-[10px] uppercase tracking-widest px-6 py-2.5 rounded-xl border border-zinc-800">Sold Out</button>
                        ) : qty === 0 ? (
                          <button onClick={() => updateCart(cat.id, 1, remaining)} className="border border-white/20 bg-white/5 text-white font-bold text-[10px] uppercase tracking-widest px-6 py-2.5 rounded-xl hover:bg-white hover:text-black transition-all active:scale-95 shadow-md">
                            Add
                          </button>
                        ) : (
                          <div className="flex items-center gap-4 bg-white text-black rounded-xl px-2 py-1.5 shadow-[0_0_15px_rgba(255,255,255,0.2)] ring-2 ring-white/50">
                            <button onClick={() => updateCart(cat.id, -1, remaining)} className="p-1.5 hover:text-brandRed transition-colors"><Minus size={14} /></button>
                            <span className="font-black text-sm w-4 text-center">{qty}</span>
                            <button onClick={() => updateCart(cat.id, 1, remaining)} className="p-1.5 hover:text-brandRed transition-colors"><Plus size={14} /></button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Absolute Checkout Bar */}
          {step === 2 && totalTickets > 0 && (
            <div className="absolute bottom-0 left-0 right-0 bg-zinc-950/95 backdrop-blur-2xl border-t border-white/10 p-6 md:rounded-br-[40px] shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
              <button onClick={processPayment} disabled={processing} className="w-full bg-brandRed text-white py-5 rounded-2xl font-black uppercase tracking-widest flex justify-between items-center px-6 disabled:opacity-50 text-xs shadow-[0_0_40px_rgba(255,0,0,0.3)] hover:shadow-[0_0_60px_rgba(255,0,0,0.5)] transition-all active:scale-[0.98]">
                {processing ? <Loader2 className="animate-spin mx-auto" /> : (
                  <>
                    <div className="flex flex-col items-start text-left">
                      <span className="text-[10px] text-white/80 tracking-widest">{totalTickets} Ticket{totalTickets > 1 ? 's' : ''}</span>
                      <span className="text-sm">₹{Math.round(totalPrice / (1 - 0.0236)).toLocaleString('en-IN')} <span className="text-[9px] lowercase font-normal opacity-80">(inc. fee)</span></span>
                    </div>
                    <span className="flex items-center gap-2 text-sm bg-black/20 px-4 py-2 rounded-xl backdrop-blur-sm border border-white/10">Proceed to Pay <ArrowRight size={16} /></span>
                  </>
                )}
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}