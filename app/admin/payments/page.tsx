// app/admin/payments/page.tsx
"use client";
import { useState, useEffect } from 'react';
import { 
  ShieldCheck, Zap, Info, Save, Loader2, 
  IndianRupee, ToggleLeft, ToggleRight, Store, 
  Crown, ListChecks, Calendar, CalendarDays, Infinity,
  Receipt, ArrowUpRight, Search, Filter, AlertTriangle, RefreshCw
} from 'lucide-react';
import { useAlert } from '@/context/AlertContext';

export default function AdminPaymentSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { showAlert } = useAlert();
  
  // Settings State
  const [settings, setSettings] = useState({
    martEnabled: false,
    martNote: "Unlock premium contact details and portfolio gallery.",
    martMonthlyActive: false,
    martMonthlyPrice: 99,
    martYearlyActive: false,
    martYearlyPrice: 899,
    martLifetimeActive: true,
    martLifetimePrice: 2499,
    membershipPrice: 499,
    currency: "INR",
    membershipBenefits: "Lifetime Access, Decision Making Power, VIP Community Badge, Exclusive Events"
  });

  // Ledger State
  const [payments, setPayments] = useState<any[]>([]);

  // Payment health: orders that are stuck, need a refund, or whose email failed
  const [problemOrders, setProblemOrders] = useState<any[]>([]);
  const [reconciling, setReconciling] = useState(false);

  const loadProblemOrders = async () => {
    try {
      const res = await fetch('/api/admin/payments?view=orders');
      const data = await res.json();
      if (Array.isArray(data)) setProblemOrders(data);
    } catch {
      // The rest of the page still works without this panel.
    }
  };

  const runReconcile = async () => {
    setReconciling(true);
    try {
      const res = await fetch('/api/razorpay/reconcile', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showAlert(`Checked ${data.checked} orders: ${data.fulfilled.length} recovered, ${data.needsAttention.length} need attention, ${data.emailsSent}/${data.emailsRetried} emails re-sent`, "success");
      loadProblemOrders();
    } catch (err: any) {
      showAlert(err.message || "Reconcile failed", "error");
    } finally {
      setReconciling(false);
    }
  };
  
  // Search and Filter States
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState<"ALL" | "MART" | "LIFETIME">("ALL");

  useEffect(() => {
    async function fetchAdminData() {
      try {
        const [settingsRes, paymentsRes] = await Promise.all([
          fetch('/api/admin/settings'),
          fetch('/api/admin/payments')
        ]);

        const settingsData = await settingsRes.json();
        const paymentsData = await paymentsRes.json();

        // Safe merge with existing settings
        if (settingsData && !settingsData.error) {
          setSettings(prev => ({ ...prev, ...settingsData }));
        }
        if (Array.isArray(paymentsData)) setPayments(paymentsData);

      } catch (err) {
        showAlert("Failed to load admin data", "error");
      } finally {
        setLoading(false);
      }
    }
    fetchAdminData();
    loadProblemOrders();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH', // Or PUT/POST depending on your API
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      if (res.ok) showAlert("Protocols Deployed Successfully", "success");
      else showAlert("Failed to deploy settings", "error");
    } catch (err) {
      showAlert("Transmission Error", "error");
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return "N/A";
    const options: Intl.DateTimeFormatOptions = { 
      year: 'numeric', month: 'short', day: 'numeric', 
      hour: '2-digit', minute: '2-digit' 
    };
    return new Date(dateString).toLocaleDateString('en-IN', options);
  };

  // Filtering Logic
  const filteredPayments = payments.filter((payment) => {
    const matchesSearch = 
      (payment.email?.toLowerCase() || "").includes(searchTerm.toLowerCase()) || // Updated to 'email' based on typical Supabase schema
      (payment.razorpay_order_id?.toLowerCase() || "").includes(searchTerm.toLowerCase());
    
    // Note: Adjusted payment.payment_type based on your API insertion logic
    const matchesFilter = filterType === "ALL" || payment.payment_type === filterType;

    return matchesSearch && matchesFilter;
  });

  if (loading) return <div className="min-h-screen bg-black flex items-center justify-center"><Loader2 className="animate-spin text-brandRed" size={30} /></div>;

  return (
    <div className="min-h-screen bg-black pt-40 pb-20 px-6 text-white">
      <div className="max-w-6xl mx-auto space-y-16">
        
        {/* HEADER */}
        <div className="space-y-4 border-b border-white/5 pb-10">
          <h1 className="text-5xl md:text-7xl font-black italic uppercase tracking-tighter leading-none">
            Revenue <span className="text-brandRed">Control .</span>
          </h1>
          <p className="text-zinc-500 font-bold uppercase tracking-[0.3em] text-[10px]">Configure Global Monetization Models</p>
        </div>

        {/* PRICING CONTROLS */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* CATEGORY 1: MALLU MART ACCESS */}
          <div className="bg-zinc-950 border border-white/5 p-8 rounded-[40px] space-y-8 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-5"><Store size={120} /></div>
            <div className="flex items-center justify-between relative z-10">
              <div className="space-y-1">
                <h3 className="text-xl font-black uppercase italic tracking-tight flex items-center gap-2">
                   Mallu Mart <span className="text-brandRed">Access</span>
                </h3>
                <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest">Multi-Tier Subscription Model</p>
              </div>
              <button onClick={() => setSettings({...settings, martEnabled: !settings.martEnabled})}>
                {settings.martEnabled ? <ToggleRight size={48} className="text-brandRed" /> : <ToggleLeft size={48} className="text-zinc-800" />}
              </button>
            </div>

            <div className="pt-6 border-t border-white/5 space-y-6 relative z-10">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Available Billing Cycles</label>
              
              {/* MONTHLY */}
              <div className={`flex items-center gap-4 p-4 rounded-2xl border transition-all ${settings.martMonthlyActive ? 'bg-brandRed/10 border-brandRed' : 'bg-white/5 border-white/10'}`}>
                <input type="checkbox" checked={settings.martMonthlyActive} onChange={(e) => setSettings({...settings, martMonthlyActive: e.target.checked})} className="w-5 h-5 accent-brandRed" />
                <div className="flex-1 flex items-center gap-2"><Calendar size={16} className="text-zinc-400" /> <span className="text-sm font-bold uppercase">Monthly</span></div>
                <div className="flex items-center gap-1">
                  <span className="text-zinc-500 font-bold">₹</span>
                  {/* 🔥 FIX: Fallback empty string to prevent NaN on clear */}
                  <input 
                    type="number" 
                    disabled={!settings.martMonthlyActive} 
                    value={settings.martMonthlyPrice === 0 || isNaN(settings.martMonthlyPrice) ? '' : settings.martMonthlyPrice} 
                    onChange={(e) => {
                      const val = e.target.value;
                      setSettings({...settings, martMonthlyPrice: val === '' ? 0 : parseInt(val)});
                    }} 
                    className="w-20 bg-transparent border-b border-white/20 text-right text-lg font-black outline-none focus:border-brandRed disabled:opacity-50" 
                  />
                </div>
              </div>

              {/* YEARLY */}
              <div className={`flex items-center gap-4 p-4 rounded-2xl border transition-all ${settings.martYearlyActive ? 'bg-brandRed/10 border-brandRed' : 'bg-white/5 border-white/10'}`}>
                <input type="checkbox" checked={settings.martYearlyActive} onChange={(e) => setSettings({...settings, martYearlyActive: e.target.checked})} className="w-5 h-5 accent-brandRed" />
                <div className="flex-1 flex items-center gap-2"><CalendarDays size={16} className="text-zinc-400" /> <span className="text-sm font-bold uppercase">Yearly</span></div>
                <div className="flex items-center gap-1">
                  <span className="text-zinc-500 font-bold">₹</span>
                  {/* 🔥 FIX */}
                  <input 
                    type="number" 
                    disabled={!settings.martYearlyActive} 
                    value={settings.martYearlyPrice === 0 || isNaN(settings.martYearlyPrice) ? '' : settings.martYearlyPrice} 
                    onChange={(e) => {
                      const val = e.target.value;
                      setSettings({...settings, martYearlyPrice: val === '' ? 0 : parseInt(val)});
                    }} 
                    className="w-20 bg-transparent border-b border-white/20 text-right text-lg font-black outline-none focus:border-brandRed disabled:opacity-50" 
                  />
                </div>
              </div>

              {/* LIFETIME */}
              <div className={`flex items-center gap-4 p-4 rounded-2xl border transition-all ${settings.martLifetimeActive ? 'bg-brandRed/10 border-brandRed' : 'bg-white/5 border-white/10'}`}>
                <input type="checkbox" checked={settings.martLifetimeActive} onChange={(e) => setSettings({...settings, martLifetimeActive: e.target.checked})} className="w-5 h-5 accent-brandRed" />
                <div className="flex-1 flex items-center gap-2"><Infinity size={16} className="text-zinc-400" /> <span className="text-sm font-bold uppercase">Lifetime</span></div>
                <div className="flex items-center gap-1">
                  <span className="text-zinc-500 font-bold">₹</span>
                  {/* 🔥 FIX */}
                  <input 
                    type="number" 
                    disabled={!settings.martLifetimeActive} 
                    value={settings.martLifetimePrice === 0 || isNaN(settings.martLifetimePrice) ? '' : settings.martLifetimePrice} 
                    onChange={(e) => {
                      const val = e.target.value;
                      setSettings({...settings, martLifetimePrice: val === '' ? 0 : parseInt(val)});
                    }} 
                    className="w-20 bg-transparent border-b border-white/20 text-right text-lg font-black outline-none focus:border-brandRed disabled:opacity-50" 
                  />
                </div>
              </div>
            </div>
          </div>

          {/* CATEGORY 2: LIFETIME MEMBERSHIP */}
          <div className="bg-zinc-950 border border-white/5 p-8 rounded-[40px] space-y-8 relative overflow-hidden">
             <div className="absolute top-0 right-0 p-8 opacity-5"><Crown size={120} /></div>
             <div className="flex items-center justify-between relative z-10">
              <div className="space-y-1">
                <h3 className="text-xl font-black uppercase italic tracking-tight flex items-center gap-2">
                   Lifetime <span className="text-brandRed">Membership</span>
                </h3>
                <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest">Global Community Product</p>
              </div>
              <div className="px-4 py-1.5 bg-brandRed/10 border border-brandRed/20 rounded-full">
                <span className="text-[8px] font-black uppercase text-brandRed tracking-widest">Always Active</span>
              </div>
            </div>

            <div className="pt-6 border-t border-white/5 space-y-6 relative z-10">
              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 flex items-center gap-2"><IndianRupee size={14} className="text-brandRed" /> Membership Price</label>
                {/* 🔥 FIX */}
                <input 
                  type="number" 
                  value={settings.membershipPrice === 0 || isNaN(settings.membershipPrice) ? '' : settings.membershipPrice} 
                  onChange={(e) => {
                    const val = e.target.value;
                    setSettings({...settings, membershipPrice: val === '' ? 0 : parseInt(val)});
                  }} 
                  className="w-full bg-black border border-white/10 p-5 rounded-2xl text-xl font-black italic focus:border-brandRed outline-none" 
                />
              </div>
              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 flex items-center gap-2"><ListChecks size={14} className="text-brandRed" /> Benefits (Comma Separated)</label>
                <textarea 
                  value={settings.membershipBenefits} 
                  onChange={(e) => setSettings({...settings, membershipBenefits: e.target.value})} 
                  className="w-full bg-black border border-white/10 p-5 rounded-2xl text-xs font-bold h-24 focus:border-brandRed outline-none" 
                />
              </div>
            </div>
          </div>
        </div>

        {/* SAVE BUTTON */}
        <div className="max-w-md mx-auto pt-4">
          <button 
            disabled={saving}
            onClick={handleSave}
            className="w-full py-6 bg-white text-black font-black uppercase tracking-[0.4em] rounded-[30px] hover:bg-brandRed hover:text-white transition-all shadow-2xl active:scale-95 flex items-center justify-center gap-3"
          >
            {saving ? <Loader2 className="animate-spin" size={24} /> : <><Save size={24} /> Deploy Changes</>}
          </button>
        </div>

        {/* PAYMENT HEALTH */}
        <div className="space-y-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-3xl font-black uppercase italic tracking-tighter flex items-center gap-3">
                <AlertTriangle className="text-yellow-500" size={28} /> Payment Health
              </h2>
              <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Paid orders not yet delivered, refunds to action, and failed emails. Runs automatically every day.</p>
            </div>
            <button onClick={runReconcile} disabled={reconciling} className="flex items-center gap-2 px-6 py-3 bg-white text-black rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-50">
              {reconciling ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Run Reconcile Now
            </button>
          </div>
          <div className="bg-zinc-950 border border-white/5 rounded-[30px] overflow-x-auto">
            <table className="w-full text-left min-w-[800px]">
              <thead>
                <tr className="text-[9px] uppercase tracking-[0.2em] text-zinc-500 font-black border-b border-white/10">
                  <th className="p-5">Order</th>
                  <th className="p-5">Type</th>
                  <th className="p-5">Buyer</th>
                  <th className="p-5">Amount</th>
                  <th className="p-5">State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-xs font-bold">
                {problemOrders.length === 0 ? (
                  <tr><td colSpan={5} className="p-8 text-center text-zinc-500 italic">All paid orders delivered.</td></tr>
                ) : problemOrders.map((o) => (
                  <tr key={o.razorpay_order_id}>
                    <td className="p-5 font-mono text-[10px] text-zinc-400">{o.razorpay_order_id}<span className="block text-zinc-600">{o.razorpay_payment_id || '-'}</span></td>
                    <td className="p-5 uppercase">{o.payment_type}{o.plan ? ` / ${o.plan}` : ''}</td>
                    <td className="p-5 text-zinc-300">{o.receipt_email || '-'}</td>
                    <td className="p-5">₹{((o.amount_paise || 0) / 100).toFixed(2)}</td>
                    <td className="p-5">
                      <span className={`uppercase ${o.status === 'NEEDS_ATTENTION' ? 'text-brandRed' : 'text-yellow-500'}`}>{o.status === 'FULFILLED' ? `Email ${o.email_status}` : o.status}</span>
                      <span className="block text-[10px] text-zinc-500 font-normal">{o.status_reason || o.email_error || ''}</span>
                      <span className="block text-[9px] text-zinc-600">{formatDate(o.created_at)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* FINANCIAL LEDGER */}
        <div className="pt-10 border-t border-white/5 space-y-8">
          <div className="space-y-2">
            <h2 className="text-3xl font-black uppercase italic tracking-tighter flex items-center gap-3">
              <Receipt className="text-brandRed" size={32} /> Financial Ledger
            </h2>
            <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.2em]">Live Transaction History</p>
          </div>

          {/* SEARCH & FILTER TABS */}
          <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-zinc-950 p-4 rounded-[20px] border border-white/10">
            {/* Search Bar */}
            <div className="relative w-full md:w-96">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
              <input 
                type="text" 
                placeholder="Search email or order ID..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-black border border-white/10 text-white text-sm rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:border-brandRed transition-colors"
              />
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center gap-1 bg-black p-1 rounded-xl border border-white/10 w-full md:w-auto overflow-x-auto no-scrollbar">
              <button 
                onClick={() => setFilterType("ALL")} 
                className={`flex-1 md:flex-none px-6 py-2.5 rounded-lg text-xs font-black uppercase tracking-widest whitespace-nowrap transition-all ${filterType === "ALL" ? "bg-white text-black" : "text-zinc-500 hover:text-white"}`}
              >
                All
              </button>
              <button 
                onClick={() => setFilterType("MART")} 
                className={`flex-1 md:flex-none flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg text-xs font-black uppercase tracking-widest whitespace-nowrap transition-all ${filterType === "MART" ? "bg-brandRed text-white" : "text-zinc-500 hover:text-white"}`}
              >
                <Store size={14} /> Mallu Mart
              </button>
              <button 
                onClick={() => setFilterType("LIFETIME")} 
                className={`flex-1 md:flex-none flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg text-xs font-black uppercase tracking-widest whitespace-nowrap transition-all ${filterType === "LIFETIME" ? "bg-yellow-500 text-black" : "text-zinc-500 hover:text-white"}`}
              >
                <Crown size={14} /> Lifetime
              </button>
            </div>
          </div>

          {/* TABLE DATA */}
          <div className="bg-zinc-950 border border-white/10 rounded-[30px] overflow-hidden shadow-2xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white/5 text-[10px] uppercase tracking-widest text-zinc-400 font-black border-b border-white/10">
                    <th className="p-6">User Identity</th>
                    <th className="p-6">Subscription</th>
                    <th className="p-6">Duration</th>
                    <th className="p-6">Amount</th>
                    <th className="p-6">Order ID</th>
                    <th className="p-6">Timestamp</th>
                    <th className="p-6">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-sm font-bold">
                  {filteredPayments.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-10 text-center text-zinc-500 italic">No matching transactions found.</td>
                    </tr>
                  ) : (
                    filteredPayments.map((payment, index) => (
                      <tr key={index} className="hover:bg-white/5 transition-colors">
                        <td className="p-6 text-zinc-300">{payment.email || 'Unknown User'}</td>
                        <td className="p-6">
                          <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
                            payment.payment_type === 'LIFETIME' ? 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20' : 'bg-brandRed/10 text-brandRed border border-brandRed/20'
                          }`}>
                            {payment.payment_type === 'LIFETIME' ? 'VIP Premium' : 'Mallu Mart'}
                          </span>
                        </td>
                        <td className="p-6 text-zinc-300 uppercase text-[11px] tracking-widest">
                          {payment.plan || (payment.payment_type === 'LIFETIME' ? 'LIFETIME' : 'N/A')}
                        </td>
                        <td className="p-6 text-white font-mono">
                          ₹{payment.amount || 0}
                        </td>
                        <td className="p-6">
                          <span className="font-mono text-xs text-zinc-500">{payment.razorpay_order_id}</span>
                        </td>
                        <td className="p-6 text-zinc-400 text-xs">
                          {formatDate(payment.created_at)}
                        </td>
                        <td className="p-6">
                          <span className="flex items-center gap-1 text-emerald-500 text-[10px] uppercase font-black tracking-widest">
                            <ArrowUpRight size={14} /> {payment.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}