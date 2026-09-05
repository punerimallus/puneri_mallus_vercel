"use client";
import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter, usePathname } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { motion, AnimatePresence, useScroll, useTransform } from 'framer-motion';
import { createBrowserClient } from '@supabase/ssr';
import { 
  MessageCircle, MapPin, Globe, Instagram, 
  ExternalLink, Maximize2, X, ShieldCheck, Share2, 
  Phone, Star, ChevronRight, Zap, ListChecks, Info, 
  Image as ImageIcon, Clock, Lock, Unlock, Eye, Loader2
} from 'lucide-react';

// --- CUSTOM UI COMPONENTS ---
import MartVerificationModal from '@/components/MartVerificationModal';
import TribeAlert from '@/components/TribeAlert';
import TribeConfirm from '@/components/TribeConfirm';
import MartInvoiceGate from '@/components/MartInvoiceGate';

interface UserProfile {
  martUnlocked?: boolean;
  isPremiumMember?: boolean;
}

export default function ProfessionalDetailsPage() {
  const { id } = useParams();
  const router = useRouter();
  const [item, setItem] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [paymentLoading, setPaymentLoading] = useState(false); 
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const pathname = usePathname();
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isPaymentEnabled, setIsPaymentEnabled] = useState(false);
  const [isVerifyOpen, setIsVerifyOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);

  const [alertConfig, setAlertConfig] = useState({ isVisible: false, message: '', type: 'info' as 'success' | 'error' | 'info' });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const [avgRating, setAvgRating] = useState(3);

  const [martPlans, setMartPlans] = useState<any>(null);
  const [selectedPlan, setSelectedPlan] = useState<string>('');

  const [showInvoiceGate, setShowInvoiceGate] = useState(false);
  const [verifiedInvoiceEmail, setVerifiedInvoiceEmail] = useState("");

  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 500], [0, 150]);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const overviewRef = useRef<HTMLDivElement>(null);
  const photosRef = useRef<HTMLDivElement>(null);
  const servicesRef = useRef<HTMLDivElement>(null);
  const paywallRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function fetchAllData() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        setCurrentUser(user);

        if (user?.id) {
          const { data: invoiceData } = await supabase
            .from('mallu_invoice')
            .select('invoice_email')
            .eq('user_id', user.id)
            .maybeSingle();
          if (invoiceData?.invoice_email) setVerifiedInvoiceEmail(invoiceData.invoice_email);
        }

        const [martRes, settingsRes, profileRes] = await Promise.all([
          fetch('/api/mart'),
          fetch('/api/admin/settings'),
          user?.id 
            ? fetch(`/api/profile/check?id=${user.id}`) 
            : Promise.resolve({ ok: true, json: () => Promise.resolve({ exists: false }) })
        ]);

        const martData = await martRes.json();
        const settingsData = await settingsRes.json();
        const profileJson = await profileRes.json();
        const userProfile = profileJson?.profile || {};

        if (settingsData) {
          setIsPaymentEnabled(settingsData.martEnabled); 

          const availablePlans = {
            monthly: { active: settingsData.martMonthlyActive || false, price: settingsData.martMonthlyPrice || 99 },
            yearly: { active: settingsData.martYearlyActive || false, price: settingsData.martYearlyPrice || 899 },
            lifetime: { active: settingsData.martLifetimeActive || false, price: settingsData.martLifetimePrice || 2499 }
          };
          setMartPlans(availablePlans);

          if (availablePlans.monthly.active) setSelectedPlan('monthly');
          else if (availablePlans.yearly.active) setSelectedPlan('yearly');
          else if (availablePlans.lifetime.active) setSelectedPlan('lifetime');
        }

        const found = martData.find((i: any) => i._id === id);
        
        if (found) {
          setItem(found);
          if (found.rating) setAvgRating(found.rating);

          const MASTER_ADMINS = [
            'punerimallus1@gmail.com', 
            'rohitanish86@gmail.com', 
            'panikarvishnu7@gmail.com'
          ];
          
          const isOwner = user?.email === found.userEmail;
          const isMasterAdmin = user?.email ? MASTER_ADMINS.includes(user.email) : false;
          
          if (
            isOwner || 
            isMasterAdmin || 
            !settingsData.martEnabled || 
            userProfile?.is_member === true || 
            userProfile?.mart_unlocked === true
          ) {
            setIsUnlocked(true);
          }
        }
      } catch (err) { 
        console.error("MALLU_MART_INIT_ERROR:", err); 
      } finally { 
        setLoading(false); 
      }
    }
    fetchAllData();
  }, [id, supabase]);

  const handleLockedAction = (target: string, type: 'URL' | 'UNLOCK' = 'URL') => {
    if (isUnlocked) {
      if (type === 'URL' && target) window.open(target, '_blank');
      return;
    }

    if (isPaymentEnabled) {
      setPendingAction(target);
      
      if (paywallRef.current) {
        const offset = 150; 
        const elementPosition = paywallRef.current.getBoundingClientRect().top + window.pageYOffset;
        window.scrollTo({ top: elementPosition - offset, behavior: 'smooth' });
      }
      
      setAlertConfig({ isVisible: true, message: "Select an access plan to continue.", type: 'info' });
    } else {
      setIsUnlocked(true);
      if (type === 'URL' && target) window.open(target, '_blank');
    }
  };

  const handleCheckoutInitiation = () => {
    setConfirmOpen(false);
    
    if (!currentUser) return router.push(`/auth/login?next=${pathname}`);

    const hasRealAuthEmail = currentUser?.email && 
                             !currentUser.email.includes('supabase.co') && 
                             !currentUser.email.includes('@punerimallus.com'); 

    if (!hasRealAuthEmail && !verifiedInvoiceEmail) {
      setShowInvoiceGate(true);
      return;
    }

    triggerRazorpay(verifiedInvoiceEmail || currentUser.email);
  };

  const triggerRazorpay = async (finalEmail: string) => {
    setPaymentLoading(true); 

    try {
      const orderRes = await fetch('/api/razorpay/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          businessId: id, 
          paymentType: 'MART',
          plan: selectedPlan.toUpperCase()
        })
      });

      const orderData = await orderRes.json();

      const options = {
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID, 
        amount: orderData.amount,
        currency: orderData.currency,
        name: "PUNERI MALLUS",
        description: `Unlock Mallu Mart Access (${selectedPlan.toUpperCase()})`,
        order_id: orderData.id,
        method: { netbanking: true, card: true, upi: true, wallet: true, emi: false, paylater: false },
        config: { display: { sequence: ['block.banks', 'block.cards'], preferences: { show_default_blocks: true } } },
        handler: async function (response: any) {
          setPaymentLoading(true); 
          
          const verifyRes = await fetch('/api/razorpay/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              userId: currentUser.id,
              paymentType: 'MART', 
              plan: selectedPlan.toUpperCase(),
              amount: martPlans[selectedPlan].price,
              invoiceEmail: finalEmail
            })
          });

          const verifyData = await verifyRes.json();
          
          if (verifyData.success) {
            setIsUnlocked(true); 
            setAlertConfig({ isVisible: true, message: "Access Granted! Unlocking directory...", type: 'success' });
            setTimeout(() => { window.location.href = window.location.pathname + "?unlocked=true"; }, 2000);
          } else {
            setAlertConfig({ isVisible: true, message: "Verification Failed", type: 'error' });
            setPaymentLoading(false);
          }
        },
        prefill: { 
          email: finalEmail, 
          contact: currentUser?.phone || "" 
        },
        theme: { color: "#FF0000" },
        modal: { ondismiss: () => setPaymentLoading(false) } 
      };

      const rzp = new (window as any).Razorpay(options);
      rzp.open();

    } catch (err) {
      setAlertConfig({ isVisible: true, message: "Gateway Error", type: 'error' });
      setPaymentLoading(false);
    }
  };

  if (loading) return <div className="min-h-screen bg-black flex items-center justify-center"><Loader2 className="animate-spin text-brandRed" size={40} /></div>;
  if (!item) return <div className="min-h-screen bg-black flex flex-col items-center justify-center text-white"><h1>Profile Not Found</h1><Link href="/directory" className="px-6 py-3 bg-brandRed rounded-lg font-bold text-sm uppercase">Return</Link></div>;

  const images = item.imagePaths || (item.imagePath ? [item.imagePath] : []);
  const thumbnail = images[0];
  const gallery = images.slice(1, 7);

  const tabs = [
    { id: 'overview', label: 'Overview', icon: Info, ref: overviewRef },
    { id: 'photos', label: 'Photos', icon: ImageIcon, ref: photosRef },
    { id: 'services', label: 'Services', icon: ListChecks, ref: servicesRef },
  ];

  const scrollToSection = (ref: any, id: string) => {
    if (!isUnlocked) {
      handleLockedAction('', 'UNLOCK');
      return;
    }
    setActiveTab(id);
    const offset = 180;
    const elementPosition = ref.current?.getBoundingClientRect().top + window.pageYOffset;
    window.scrollTo({ top: elementPosition - offset, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-[#030303] text-zinc-100 relative overflow-x-hidden selection:bg-brandRed/30">
      
      {showInvoiceGate && currentUser && (
        <MartInvoiceGate 
          userId={currentUser.id}
          userPhone={currentUser.phone}
          onSuccess={(capturedEmail) => {
            setShowInvoiceGate(false);
            setVerifiedInvoiceEmail(capturedEmail);
            triggerRazorpay(capturedEmail);
          }}
          onCancel={() => setShowInvoiceGate(false)}
        />
      )}

      <TribeAlert 
        isVisible={alertConfig.isVisible} 
        message={alertConfig.message} 
        type={alertConfig.type} 
        onClose={() => setAlertConfig({ ...alertConfig, isVisible: false })} 
      />

      <TribeConfirm 
        isOpen={confirmOpen}
        title="Secure Access"
        message={
          isPaymentEnabled && martPlans && selectedPlan
            ? `A fee of ₹${martPlans[selectedPlan].price} is required to unlock this professional profile for ${selectedPlan.toUpperCase()} access.`
            : "A fee is required to unlock the full Mallu Mart directory and professional contacts."
        }
        onConfirm={handleCheckoutInitiation} 
        onCancel={() => setConfirmOpen(false)}
      />

      <motion.div style={{ y }} className="fixed inset-0 z-0 pointer-events-none overflow-hidden bg-[#030303]">
        <Image 
          src="/events/mmart.webp" 
          alt="BG" 
          fill 
          priority 
          quality={60} // 🔥 Dropped quality for background speed
          sizes="100vw"
          className="object-cover opacity-[0.2] brightness-[0.7] scale-110" 
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#030303] via-transparent to-[#030303] z-[1]" />
      </motion.div>

      <main className="max-w-7xl mx-auto px-6 pt-44 pb-32 relative z-10">
        <div className="bg-zinc-950/40 backdrop-blur-2xl border border-white/5 p-8 rounded-[40px] mb-10 shadow-3xl">
          <div className="flex flex-col md:flex-row gap-10 justify-center items-center md:items-start">
            <div className="w-32 h-32 md:w-44 md:h-44 relative rounded-[32px] overflow-hidden border border-white/10 bg-zinc-900 shadow-2xl shrink-0 transition-all duration-500 hover:scale-105">
              <Image 
                src={`https://bhfrgcphqmbocplfcvbg.supabase.co/storage/v1/object/public/mallu-mart/${thumbnail}`}
                alt={item.name} 
                fill 
                priority 
                // 🔥 Removed 'unoptimized' and added explicit sizes
                sizes="(max-width: 768px) 128px, 176px"
                quality={80}
                className="object-cover"
              />
            </div>

            <div className="flex-1 space-y-6 w-full flex flex-col items-center text-center md:items-start md:text-left">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 w-full">
                <div className="space-y-2 flex flex-col items-center md:items-start w-full md:w-auto">
                  <div className="inline-flex items-center gap-2 px-3 py-1 bg-brandRed/10 border border-brandRed/20 rounded-lg">
                    <Zap size={12} className="text-brandRed" />
                    <span className="text-[9px] font-black uppercase tracking-[0.3em] text-brandRed">{item.category}</span>
                  </div>
                  <h1 className="text-3xl md:text-4xl font-black text-white italic uppercase tracking-tighter leading-none flex items-center gap-2">
                    {item.name} {item.isVerified && <ShieldCheck size={24} className="text-brandRed inline-block ml-2" />}
                  </h1>
                </div>

                <div className="flex items-center gap-3">
                  <button onClick={() => handleLockedAction(`https://wa.me/91${item.whatsapp || item.contact}`)} className="p-4 bg-[#25D366]/10 text-[#25D366] rounded-2xl border border-[#25D366]/20 hover:bg-[#25D366] hover:text-white transition-all shadow-xl">
                    <MessageCircle size={20} />
                  </button>
                  <button onClick={() => handleLockedAction(`tel:${item.contact}`)} className="p-4 bg-zinc-900 text-white rounded-2xl border border-white/10 hover:border-brandRed transition-all shadow-xl">
                    <Phone size={20} />
                  </button>
                  <button onClick={() => navigator.share({title: item.name, url: window.location.href})} className="p-4 bg-zinc-900 text-white rounded-2xl border border-white/10 transition-all shadow-xl">
                    <Share2 size={20} />
                  </button>
                </div>
              </div>

              <div className="space-y-4 flex flex-col items-center md:items-start w-full md:w-auto">
                <div className="flex flex-wrap items-center justify-center md:justify-start gap-6 w-full md:w-auto">
                  <div className="flex items-center gap-2 text-zinc-100 font-black uppercase tracking-[0.2em] text-[11px]">
                    <MapPin size={16} className="text-brandRed" />
                    {item.area}
                  </div>
                  {(item.openTime || item.closeTime) && (
                    <div className="flex items-center gap-2 text-zinc-500 font-black uppercase tracking-[0.2em] text-[10px]">
                      <Clock size={16} className="text-brandRed" />
                      <span>{item.openTime} — {item.closeTime}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1 bg-zinc-900 px-3 py-1 rounded-xl border border-white/5">
                    <span className="text-yellow-500 font-black text-xs">{avgRating.toFixed(1)}</span>
                    <Star size={12} fill="#EAB308" className="text-yellow-500" />
                  </div>
                </div>

                <div className="relative max-w-3xl w-full">
                  <p className={`text-zinc-400 text-base leading-relaxed italic md:border-l-2 border-brandRed/30 md:pl-6 whitespace-pre-wrap break-words ${!isUnlocked ? 'line-clamp-2' : ''}`}>
                    {item.description}
                  </p>
                  {!isUnlocked && (
                    <button onClick={() => handleLockedAction('', 'UNLOCK')} className="mt-3 text-brandRed font-black uppercase text-[10px] tracking-widest flex items-center justify-center md:justify-start gap-2 hover:gap-3 transition-all w-full md:w-auto">
                      Read Full Profile <ChevronRight size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {currentUser && (currentUser.id === item.userId || currentUser.email === item.userEmail) && !item.isVerified && item.verificationStatus !== 'PENDING' && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-10 p-6 rounded-[32px] bg-brandRed/10 border border-brandRed/20 backdrop-blur-xl flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-4 text-center md:text-left">
              <ShieldCheck className="text-brandRed shrink-0" size={28} />
              <p className="text-[10px] font-black uppercase tracking-widest text-white italic">Identity Verification Required for Green Badge</p>
            </div>
            <button onClick={() => setIsVerifyOpen(true)} className="w-full md:w-auto px-8 py-3 bg-white text-black text-[10px] font-black uppercase rounded-xl hover:bg-brandRed hover:text-white transition-all shadow-xl">
              Verify Now
            </button>
          </motion.div>
        )}

        {/* 🔥 FIX: RESTRUCTURED THE PAYWALL OVERLAY */}
        <div className="relative w-full rounded-[40px]" ref={paywallRef}>
          
          {/* THE LOCKED SCREEN - Forces absolute center regardless of height */}
          {!isUnlocked && (
            <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center p-6 md:p-10">
              {/* Blur Overlay - Covers the exact bounding box of the fake content */}
              <div className="absolute inset-0 bg-[#030303]/80 backdrop-blur-xl rounded-[40px] border border-white/5 shadow-3xl" />
              
              <div className="relative z-10 text-center space-y-8 w-full max-w-sm mx-auto">
                <div className="w-20 h-20 bg-brandRed/10 rounded-full flex items-center justify-center mx-auto border border-brandRed/20 shadow-[0_0_50px_rgba(255,0,0,0.2)]">
                  <Lock size={32} className="text-brandRed animate-pulse" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-3xl font-black uppercase italic text-white tracking-tighter">Profile Restricted</h3>
                  <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-[0.3em]">Unlock to view Services, Portfolio & Map location</p>
                </div>

                {isPaymentEnabled && martPlans && (
                  <div className="space-y-3 text-left w-full pt-4">
                    {martPlans.monthly.active && (
                      <div onClick={() => setSelectedPlan('monthly')} className={`flex items-center justify-between p-4 rounded-2xl border cursor-pointer transition-all ${selectedPlan === 'monthly' ? 'border-brandRed bg-brandRed/10 shadow-[0_0_15px_rgba(255,0,0,0.2)]' : 'border-white/10 bg-black/50 hover:border-white/30'}`}>
                        <div className="flex items-center gap-4">
                          <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${selectedPlan === 'monthly' ? 'border-brandRed' : 'border-zinc-500'}`}>
                            {selectedPlan === 'monthly' && <div className="w-2 h-2 rounded-full bg-brandRed" />}
                          </div>
                          <span className="text-xs font-black uppercase tracking-widest text-white">Monthly Access</span>
                        </div>
                        <span className="text-lg font-black italic text-white">₹{martPlans.monthly.price}</span>
                      </div>
                    )}
                    {martPlans.yearly.active && (
                      <div onClick={() => setSelectedPlan('yearly')} className={`flex items-center justify-between p-4 rounded-2xl border cursor-pointer transition-all ${selectedPlan === 'yearly' ? 'border-brandRed bg-brandRed/10 shadow-[0_0_15px_rgba(255,0,0,0.2)]' : 'border-white/10 bg-black/50 hover:border-white/30'}`}>
                        <div className="flex items-center gap-4">
                          <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${selectedPlan === 'yearly' ? 'border-brandRed' : 'border-zinc-500'}`}>
                            {selectedPlan === 'yearly' && <div className="w-2 h-2 rounded-full bg-brandRed" />}
                          </div>
                          <span className="text-xs font-black uppercase tracking-widest text-white">Yearly Access</span>
                        </div>
                        <span className="text-lg font-black italic text-white">₹{martPlans.yearly.price}</span>
                      </div>
                    )}
                    {martPlans.lifetime.active && (
                      <div onClick={() => setSelectedPlan('lifetime')} className={`flex items-center justify-between p-4 rounded-2xl border cursor-pointer transition-all ${selectedPlan === 'lifetime' ? 'border-brandRed bg-brandRed/10 shadow-[0_0_15px_rgba(255,0,0,0.2)]' : 'border-white/10 bg-black/50 hover:border-white/30'}`}>
                        <div className="flex items-center gap-4">
                          <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${selectedPlan === 'lifetime' ? 'border-brandRed' : 'border-zinc-500'}`}>
                            {selectedPlan === 'lifetime' && <div className="w-2 h-2 rounded-full bg-brandRed" />}
                          </div>
                          <span className="text-xs font-black uppercase tracking-widest text-white">Lifetime Access</span>
                        </div>
                        <span className="text-lg font-black italic text-white">₹{martPlans.lifetime.price}</span>
                      </div>
                    )}
                  </div>
                )}

                <button 
                  onClick={() => {
                    if (!currentUser) {
                      router.push(`/auth/login?next=${pathname}`);
                      return; 
                    }
                    if (isPaymentEnabled) {
                      if (!selectedPlan) {
                        setAlertConfig({ isVisible: true, message: "Please select an access plan.", type: 'error' });
                        return;
                      }
                      setConfirmOpen(true);
                    } else {
                      setIsUnlocked(true);
                    }
                  }} 
                  disabled={paymentLoading} 
                  className={`w-full px-12 py-5 bg-brandRed text-white font-black uppercase text-xs tracking-[0.2em] rounded-2xl transition-all shadow-[0_20px_40px_rgba(255,0,0,0.3)] ${paymentLoading ? 'opacity-70 cursor-not-allowed' : 'hover:bg-white hover:text-black active:scale-95'}`}
                >
                  {paymentLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 size={16} className="animate-spin" /> PROCESSING...
                    </span>
                  ) : (
                    isPaymentEnabled ? 'Authorize Payment' : 'View More & Contact'
                  )}
                </button>
              </div>
            </div>
          )}

          {/* 🔥 FIX: CONTENT CONTAINER - Enforces a strict 650px height box when locked, making the overlay perfectly sized! */}
          <div className={!isUnlocked ? "opacity-10 pointer-events-none select-none blur-2xl h-[650px] overflow-hidden rounded-[40px]" : "space-y-20 transition-all duration-1000"}>
            <div className="sticky top-[100px] z-[40] mb-12 bg-black/60 backdrop-blur-xl border-y border-white/5 mx-[-1.5rem] px-6">
              <div className="flex items-center gap-8 overflow-x-auto no-scrollbar py-4">
                {tabs.map((tab) => (
                  <button key={tab.id} onClick={() => scrollToSection(tab.ref, tab.id)} className={`flex items-center gap-2 whitespace-nowrap text-[10px] font-black uppercase tracking-[0.2em] transition-all relative py-2 ${activeTab === tab.id ? 'text-brandRed' : 'text-zinc-500 hover:text-white'}`}>
                    <tab.icon size={14} /> {tab.label}
                    {activeTab === tab.id && <motion.div layoutId="activeTabUnderline" className="absolute -bottom-4 left-0 right-0 h-1 bg-brandRed shadow-[0_0_10px_#FF0000]" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-16 items-start">
              <div className="lg:col-span-8 space-y-20">
                {item.services && item.services.length > 0 && (
                  <section ref={servicesRef} className="scroll-mt-44 space-y-10">
                    <h2 className="text-xs font-black text-white uppercase tracking-[0.4em] flex items-center gap-4"><div className="w-12 h-px bg-brandRed" /> Services Offered</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {item.services.map((service: any, idx: number) => (
                        <div key={idx} className="bg-zinc-900/40 p-8 rounded-[32px] border border-white/5 hover:border-brandRed/30 transition-all group">
                          <div className="flex items-start gap-5">
                            <div className="w-10 h-10 rounded-full bg-brandRed/10 flex items-center justify-center text-brandRed font-black text-xs shrink-0 border border-brandRed/20">{idx + 1}</div>
                            <div className="space-y-2">
                              <h4 className="text-lg font-black uppercase text-white tracking-tight">{service.name}</h4>
                              <p className="text-sm text-zinc-500 leading-relaxed italic">{service.desc}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {gallery.length > 0 && (
                  <section ref={photosRef} className="scroll-mt-44 space-y-10">
                    <h2 className="text-xs font-black text-white uppercase tracking-[0.4em] flex items-center gap-4"><div className="w-12 h-px bg-brandRed" /> Portfolio Gallery</h2>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                      {gallery.map((img: string, idx: number) => (
                        <div key={idx} onClick={() => setZoomImage(`https://bhfrgcphqmbocplfcvbg.supabase.co/storage/v1/object/public/mallu-mart/${img}`)} className="relative aspect-square rounded-[32px] overflow-hidden border border-white/10 bg-zinc-900 cursor-zoom-in group">
                          <Image 
                            src={`https://bhfrgcphqmbocplfcvbg.supabase.co/storage/v1/object/public/mallu-mart/${img}`} 
                            alt="Gallery" 
                            fill 
                            // 🔥 Removed 'unoptimized', added lazy loading and sizes
                            sizes="(max-width: 768px) 50vw, 33vw"
                            quality={75}
                            loading="lazy"
                            className="object-cover transition-transform duration-700 group-hover:scale-110" 
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"><Maximize2 size={24} className="text-white" /></div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>

              <aside className="lg:col-span-4 sticky top-44 space-y-8">
                <div className="bg-zinc-950 border border-white/10 p-10 rounded-[45px] space-y-10 shadow-3xl">
                  <div className="space-y-8">
                    <div className="flex gap-6">
                      <div className="w-14 h-14 bg-zinc-900 rounded-2xl flex items-center justify-center shrink-0 border border-white/5 text-brandRed"><MapPin size={28} /></div>
                      <div>
                        <p className="text-[10px] text-zinc-500 font-black uppercase tracking-widest mb-1">Navigation Protocol</p>
                        <p className="text-sm text-zinc-200 font-bold uppercase">{item.area}</p>
                        {item.mapUrl && <button onClick={() => handleLockedAction(item.mapUrl)} className="text-[10px] text-brandRed font-black mt-3 inline-flex items-center gap-2 hover:underline tracking-widest uppercase">Maps Link <ExternalLink size={14} /></button>}
                      </div>
                    </div>
                    <div className="flex gap-6">
                      <div className="w-14 h-14 bg-zinc-900 rounded-2xl flex items-center justify-center shrink-0 border border-white/5 text-brandRed"><Globe size={28} /></div>
                      <div className="flex-1">
                        <p className="text-[10px] text-zinc-500 font-black uppercase tracking-widest mb-1">Web Presence</p>
                        {item.website && <button onClick={() => handleLockedAction(item.website)} className="text-xs text-zinc-200 font-bold break-all hover:text-brandRed transition-colors flex items-center gap-2">{item.website.replace(/^https?:\/\//, '')} <ExternalLink size={14} /></button>}
                        <div className="flex gap-4 mt-4">{item.instagram && <button onClick={() => handleLockedAction(`https://instagram.com/${item.instagram}`)} className="text-zinc-500 hover:text-brandRed transition-colors"><Instagram size={24} /></button>}</div>
                      </div>
                    </div>
                    {item.buttonText && item.buttonUrl && (
                      <button onClick={() => handleLockedAction(item.buttonUrl)} className="flex items-center justify-center bg-brandRed text-white w-full py-5 rounded-2xl font-black uppercase text-xs tracking-[0.2em] shadow-lg hover:scale-105 transition-all">{item.buttonText}</button>
                    )}
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </div>
      </main>

      <AnimatePresence>
        {zoomImage && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setZoomImage(null)} className="fixed inset-0 z-[1000] bg-black/98 flex items-center justify-center p-8">
            <div className="relative w-full max-w-6xl h-full flex items-center justify-center"><Image src={zoomImage} alt="Zoomed" fill unoptimized className="object-contain" /></div>
            <button className="absolute top-10 right-10 text-white p-4 bg-zinc-900 rounded-full hover:bg-brandRed transition-all"><X size={32} /></button>
          </motion.div>
        )}
      </AnimatePresence>

      <MartVerificationModal isOpen={isVerifyOpen} onClose={() => setIsVerifyOpen(false)} businessId={item._id} businessName={item.name} userEmail={currentUser?.email || ''} />
    </div>
  );
}