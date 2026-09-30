"use client";
import { useState, useMemo } from 'react';
import { 
  Calendar, Camera, Instagram, Users, 
  ArrowRight, Settings, LayoutPanelTop, 
  Zap, ShieldCheck, Globe, Handshake, Search, X,
  MessageSquare,
  Megaphone, UserCircle2,
  PlaySquare,
  Ticket,
  Mail
} from 'lucide-react';
import Link from 'next/link';
import AddAdminCard from '@/components/admin/AddAdminCard';

export default function AdminPortal() {
  const [searchQuery, setSearchQuery] = useState("");

  const adminModules = [
    {
      title: "Hero Banner",
      desc: "Update the main images and text on the landing page header.",
      icon: <LayoutPanelTop className="text-brandRed" size={32} />,
      link: "/admin/slider",
      status: "Live",
      color: "from-brandRed/20"
    },
    {
      title: "Promotions & Ads",
      desc: "Manage partner ads, popup banners, and promotional alerts.",
      icon: <Megaphone className="text-brandRed" size={32} />,
      link: "/admin/collabs", 
      status: "Live",
      color: "from-brandRed/30"
    },
    {
      title: "Team Roster",
      desc: "Update the core team members and founders shown on the site.",
      icon: <UserCircle2 className="text-brandRed" size={32} />,
      link: "/admin/partners",
      status: "Live",
      color: "from-brandRed/20"
    },
    {
      title: "Event Management",
      desc: "Create, edit, or remove upcoming community events and jams.",
      icon: <Calendar className="text-white" size={32} />,
      link: "/admin/events",
      status: "Live",
      color: "from-white/10"
    },
    {
      title: "Community Groups",
      desc: "Manage regional sub-groups, interests, and WhatsApp joining links.",
      icon: <Globe className="text-cyan-400" size={32} />,
      link: "/admin/community",
      status: "Live",
      color: "from-cyan-400/20"
    },
    // {
    //   title: "Team Roster",
    //   desc: "Update the core team members and founders shown on the site.",
    //   icon: <UserCircle2 className="text-brandRed" size={32} />,
    //   link: "/admin/team",
    //   status: "Live",
    //   color: "from-brandRed/30"
    // },
    {
      title: "Photo Gallery",
      desc: "Upload and organize photos for t he 'About Us' legacy archive.",
      icon: <Camera className="text-brandRed" size={32} />,
      link: "/admin/gallery",
      status: "Live",
      color: "from-brandRed/20"
    },
    {
      title: "Social Media",
      desc: "Update Instagram highlights and official social profile links.",
      icon: <Instagram className="text-pink-500" size={32} />,
      link: "/admin/social",
      status: "Live",
      color: "from-pink-500/10"
    },
    {
      title: "Activity Logs",
      desc: "View a history of changes made by all administrators.",
      icon: <Users className="text-blue-500" size={32} />,
      link: "/admin/members",
      status: "Internal",
      color: "from-blue-500/10"
    },
    {
      title: "Box Office Dashboard",
      desc: "Monitor event sales, view purchaser ledgers, and pause/resume ticket categories.",
      icon: <Ticket className="text-green-400" size={32} />,
      link: "/admin/boxoffice",
      status: "Live",
      color: "from-green-400/20"
    },
    {
      title: "Email Studio",
      desc: "Write and send emails to any list in the Puneri Mallus look, with unsubscribe handled for you.",
      icon: <Mail className="text-brandRed" size={32} />,
      link: "/admin/emails",
      status: "New",
      color: "from-brandRed/30"
    },
    {
      title: "Support Tickets",
      desc: "Read and reply to messages sent from the contact form.",
      icon: <MessageSquare className="text-orange-500" size={32} />,
      link: "/admin/support",
      status: "Live",
      color: "from-orange-500/20"
    },
    {
      title: "Mallu Mart",
      desc: "Review, verify, or remove local business listings submitted by users.",
      icon: <ShieldCheck className="text-brandRed" size={32} />,
      link: "/admin/mart", 
      status: "Live",
      color: "from-brandRed/40"
    },
    {
      title: "Payment Settings",
      desc: "Adjust pricing, transaction fees, and global payment gateways.",
      icon: <Handshake className="text-yellow-500" size={32} />,
      link: "/admin/payments", 
      status: "Config",
      color: "from-yellow-500/20"
    },
    {
      title: "Football Dashboard",
      desc: "Manage registered football teams, rosters, and entry fees.",
      icon: <PlaySquare className="text-yellow-500" size={32} />,
      link: "/admin/football", 
      status: "Live",
      color: "from-yellow-500/20"
    },
  ];

  const filteredModules = useMemo(() => {
    return adminModules.filter(module => 
      module.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      module.desc.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [searchQuery]);

  return (
    <div className="min-h-screen bg-black text-white pt-40 pb-20 px-6 selection:bg-brandRed/30">
      {/* Background Effect */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-brandRed/5 blur-[150px] opacity-50" />
      </div>

      <div className="max-w-7xl mx-auto relative z-10">
        
        {/* Hero Section */}
        <div className="flex flex-col md:flex-row justify-between items-end mb-20 gap-8">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-3 px-5 py-2 bg-zinc-900 border border-white/5 rounded-full shadow-lg">
              <ShieldCheck size={14} className="text-brandRed" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                Authorized <span className="text-white">Admin Access</span>
              </span>
            </div>
            <h1 className="text-6xl md:text-8xl font-black italic uppercase tracking-tighter leading-none">
              Control <br />
              <span className="text-brandRed">Panel.</span>
            </h1>
          </div>
          
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2 text-emerald-500 animate-pulse">
              <Zap size={12} fill="currentColor" />
              <span className="text-xs font-bold uppercase tracking-widest">System Online</span>
            </div>
            <p className="text-zinc-500 font-bold uppercase tracking-widest text-[10px] border-t border-white/10 pt-4 mt-2">
              Version 2.0.26 // Pune Hub
            </p>
          </div>
        </div>

        {/* Admin Management Card */}
        <div className="max-w-md mb-20">
            <AddAdminCard />
        </div>

        {/* Section Header & Search */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
          <div className="flex items-center gap-4 flex-1">
            <h2 className="text-zinc-400 text-xs font-bold uppercase tracking-widest whitespace-nowrap">Dashboard Modules</h2>
            <div className="h-[1px] flex-1 bg-zinc-800" />
          </div>
          
          {/* Enhanced Visibility Search Bar */}
          <div className="relative group w-full md:w-96">
            <Search className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors duration-300 ${searchQuery ? 'text-brandRed' : 'text-zinc-400'}`} size={18} />
            <input 
              type="text"
              placeholder="Search modules..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-900/80 border border-zinc-700 p-4 pl-12 pr-10 rounded-xl text-xs font-bold uppercase tracking-widest text-white placeholder-zinc-500 focus:border-brandRed focus:ring-1 focus:ring-brandRed focus:bg-zinc-900 outline-none transition-all duration-300 shadow-md"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white transition-colors bg-zinc-800 p-1 rounded-md">
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Grid of Modules */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredModules.length > 0 ? (
            filteredModules.map((module, idx) => (
              <Link key={idx} href={module.link} className="group relative">
                <div className="bg-zinc-950 border border-zinc-800/80 p-8 rounded-3xl hover:border-brandRed/40 transition-all duration-500 h-full flex flex-col justify-between overflow-hidden shadow-lg">
                  <div className={`absolute top-0 right-0 w-40 h-40 bg-gradient-to-br ${module.color} to-transparent blur-[50px] opacity-0 group-hover:opacity-100 transition-opacity duration-700`} />
                  
                  <div>
                    <div className="flex justify-between items-start mb-10">
                      <div className="p-5 bg-black border border-zinc-800 rounded-2xl group-hover:scale-110 group-hover:border-brandRed/30 transition-all duration-500 shadow-xl">
                        {module.icon}
                      </div>
                      <span className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-md border ${
                        module.status === 'Live' ? 'text-brandRed border-brandRed/30 bg-brandRed/10' : 
                        module.status === 'Config' ? 'text-yellow-500 border-yellow-500/30 bg-yellow-500/10' : 
                        'text-zinc-400 border-zinc-700 bg-zinc-900'
                      }`}>
                        {module.status}
                      </span>
                    </div>
                    <div className="space-y-3 relative z-10">
                      <h3 className="text-2xl font-black uppercase tracking-tight leading-none text-white group-hover:text-brandRed transition-colors">
                        {module.title}
                      </h3>
                      <p className="text-zinc-400 font-medium text-sm leading-relaxed">
                        {module.desc}
                      </p>
                    </div>
                  </div>
                  
                  <div className="mt-8 pt-6 border-t border-zinc-800/80 flex items-center justify-between relative z-10">
                    <span className="text-zinc-500 font-bold uppercase text-[10px] tracking-widest group-hover:text-white transition-colors">
                      Open Module
                    </span>
                    <div className="w-10 h-10 bg-zinc-900 rounded-xl flex items-center justify-center group-hover:bg-brandRed transition-colors border border-zinc-800 group-hover:border-brandRed">
                      <ArrowRight size={16} className="text-white group-hover:translate-x-1 transition-transform" />
                    </div>
                  </div>
                </div>
              </Link>
            ))
          ) : (
            <div className="lg:col-span-3 py-24 text-center border-2 border-dashed border-zinc-800 rounded-3xl bg-zinc-950/50">
              <p className="text-zinc-500 font-bold uppercase tracking-widest text-sm">
                No modules found matching "{searchQuery}"
              </p>
              <button onClick={() => setSearchQuery("")} className="mt-6 px-6 py-2 bg-zinc-900 text-white rounded-lg font-bold uppercase text-xs tracking-wider hover:bg-brandRed transition-colors">
                Clear Search
              </button>
            </div>
          )}
          
          {searchQuery === "" && (
            <div className="border-2 border-dashed border-zinc-800 rounded-3xl p-8 flex flex-col items-center justify-center text-center opacity-40 hover:opacity-100 transition-opacity cursor-not-allowed text-zinc-600 bg-zinc-950/30">
                <Settings className="mb-4 text-zinc-500" size={32} />
                <p className="text-[11px] font-bold uppercase tracking-widest">
                  More Settings<br/><span className="text-brandRed mt-1 block">Coming Soon</span>
                </p>
            </div>
          )}
        </div>
      </div>
    </div> 
  );
}