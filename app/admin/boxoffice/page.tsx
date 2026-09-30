"use client";
import { useState, useEffect } from 'react';
import { 
  Ticket, Loader2, ArrowLeft, Users, 
  PauseCircle, PlayCircle, IndianRupee, ShieldCheck, Search, Mail
} from 'lucide-react';
import Link from 'next/link';
import { useAlert } from '@/context/AlertContext';

export default function BoxOfficeDashboard() {
  const [events, setEvents] = useState<any[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [dashboardData, setDashboardData] = useState<{ categories: any[], bookings: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { showAlert } = useAlert();

  useEffect(() => {
    fetch('/api/admin/boxoffice')
      .then(res => res.json())
      .then(data => {
        setEvents(data.events || []);
        if (data.events?.length > 0) fetchDashboard(data.events[0]._id);
        setLoading(false);
      });
  }, []);

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

  const toggleCategoryStatus = async (categoryId: string, currentStatus: boolean) => {
    try {
      const res = await fetch('/api/admin/boxoffice', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryId, active: !currentStatus })
      });
      if (res.ok) {
        showAlert(currentStatus ? "Category Paused" : "Category Resumed", "success");
        if (selectedEventId) fetchDashboard(selectedEventId);
      }
    } catch (err) {
      showAlert("Status override failed", "error");
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

  const filteredBookings = dashboardData?.bookings.filter(b => 
    b.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    b.email?.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

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

        {refreshing && !dashboardData ? (
          <div className="py-20 flex justify-center"><Loader2 className="animate-spin text-brandRed" size={32}/></div>
        ) : dashboardData && (
          <div className="space-y-12">
            
            {/* INVENTORY CONTROL (PAUSE/RESUME) */}
            <div className="space-y-6">
              <h3 className="text-2xl font-black uppercase italic tracking-tighter flex items-center gap-3">
                <ShieldCheck className="text-brandRed" size={24} /> Inventory Control
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {dashboardData.categories.map((cat: any) => (
                  <div key={cat.id} className={`p-6 rounded-[30px] border transition-all ${cat.active ? 'bg-zinc-950 border-white/5 hover:border-brandRed/30' : 'bg-brandRed/5 border-brandRed/30 opacity-80'}`}>
                    <div className="flex justify-between items-start mb-6">
                      <div>
                        <h4 className="font-black uppercase text-xl">{cat.name}</h4>
                        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-1">₹{cat.price} per pass</p>
                      </div>
                      <button 
                        onClick={() => toggleCategoryStatus(cat.id, cat.active)}
                        className={`p-3 rounded-full flex items-center justify-center transition-all ${cat.active ? 'bg-brandRed/10 text-brandRed hover:bg-brandRed hover:text-white' : 'bg-green-500/10 text-green-500 hover:bg-green-500 hover:text-white'}`}
                        title={cat.active ? "Pause Category" : "Resume Category"}
                      >
                        {cat.active ? <PauseCircle size={24} /> : <PlayCircle size={24} />}
                      </button>
                    </div>
                    
                    <div className="flex justify-between items-end border-t border-white/5 pt-4">
                      <div>
                        <p className="text-[9px] text-zinc-600 font-black uppercase tracking-widest mb-1">Passes Sold</p>
                        <p className="text-2xl font-black text-white">{cat.sold} <span className="text-sm text-zinc-600">/ {cat.capacity}</span></p>
                      </div>
                      <div className={`text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded-full ${cat.active ? 'bg-white/5 text-zinc-400' : 'bg-brandRed text-white animate-pulse'}`}>
                        {cat.active ? 'Live' : 'Paused'}
                      </div>
                    </div>
                  </div>
                ))}
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
                    placeholder="SEARCH NAMES OR EMAILS..." 
                    value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                    className="w-full bg-zinc-950 border border-white/10 p-3 pl-12 rounded-2xl text-[10px] font-black uppercase tracking-widest outline-none focus:border-brandRed"
                  />
                </div>
              </div>

              <div className="bg-zinc-950 border border-white/10 rounded-[30px] overflow-hidden shadow-2xl overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[900px]">
                  <thead>
                    <tr className="bg-white/5 text-[9px] uppercase tracking-[0.2em] text-zinc-500 font-black border-b border-white/10">
                      <th className="p-6">User Identity</th>
                      <th className="p-6">Tickets Acquired</th>
                      <th className="p-6">Amount Paid</th>
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
                        </td>
                        <td className="p-6">
                          <span className="bg-brandRed/10 text-brandRed border border-brandRed/20 px-3 py-1.5 rounded-lg text-[10px] uppercase tracking-widest inline-block">
                            {formatTickets(booking.tickets_data)}
                          </span>
                        </td>
                        <td className="p-6 font-mono text-zinc-300">
                          <div className="flex items-center gap-1"><IndianRupee size={12}/>{booking.amount_paid}</div>
                        </td>
                        <td className="p-6">
                          <span className="font-mono text-[10px] text-zinc-500 block">{booking.razorpay_payment_id}</span>
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
                      <tr><td colSpan={5} className="p-10 text-center text-zinc-500 italic">No bookings found matching query.</td></tr>
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