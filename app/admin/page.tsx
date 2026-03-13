"use client";
import { useState, useMemo } from 'react';
import { 
  Calendar, Camera, Instagram, Users, 
  ArrowRight, Settings, LayoutPanelTop, 
  Zap, ShieldCheck, Globe, Handshake, Search, X,
  MessageSquare, // Existing
  Megaphone // Added for Collaborations
} from 'lucide-react';
import Link from 'next/link';
import AddAdminCard from '@/components/admin/AddAdminCard';

export default function AdminPortal() {
  const [searchQuery, setSearchQuery] = useState("");

  const adminModules = [
    {
      title: "Hero Cinematic",
      desc: "Manage the high-frequency hero slider on the landing page.",
      icon: <LayoutPanelTop className="text-brandRed" size={32} />,
      link: "/admin/slider",
      status: "Live",
      color: "from-brandRed/20"
    },
    // --- NEW COLLABORATIONS MODULE ---
    {
      title: "Ad Popups",
      desc: "Deploy and manage partner ads, floating banners, and business popups.",
      icon: <Megaphone className="text-brandRed" size={32} />,
      link: "/admin/collabs", // This matches our new route
      status: "Live",
      color: "from-brandRed/30"
    },
    {
      title: "Team Management",
      desc: "Manage brand partners, collaborators, and member perks.",
      icon: <Handshake className="text-brandRed" size={32} />,
      link: "/admin/partners",
      status: "Live",
      color: "from-brandRed/20"
    },
    {
      title: "Event Management",
      desc: "Create, Edit or Delete Tribe Events and Jams.",
      icon: <Calendar className="text-white" size={32} />,
      link: "/admin/events",
      status: "Live",
      color: "from-white/10"
    },
    {
      title: "Community & Samajams",
      desc: "Manage community sub-groups, interest circles, and WhatsApp links.",
      icon: <Globe className="text-cyan-400" size={32} />,
      link: "/admin/community",
      status: "Live",
      color: "from-cyan-400/20"
    },
    {
      title: "Gallery Edit",
      desc: "Update the gallery images in the About Us section.",
      icon: <Camera className="text-brandRed" size={32} />,
      link: "/admin/gallery",
      status: "Live",
      color: "from-brandRed/20"
    },
    {
      title: "Social Media Edits",
      desc: "Modify the Instagram Glimpse and Social Links.",
      icon: <Instagram className="text-pink-500" size={32} />,
      link: "/admin/social",
      status: "Live",
      color: "from-pink-500/10"
    },
    {
      title: "Admin Logs",
      desc: "View detailed audit trails and operator activity history.",
      icon: <Users className="text-blue-500" size={32} />,
      link: "/admin/members",
      status: "Internal",
      color: "from-blue-500/10"
    },
    {
      title: "Support Ticket",
      desc: "Monitor and respond to community transmissions and support tickets.",
      icon: <MessageSquare className="text-orange-500" size={32} />,
      link: "/admin/support",
      status: "Live",
      color: "from-orange-500/20"
    }
  ];

  // Rest of your logic (filteredModules, return statement) remains the same
  const filteredModules = useMemo(() => {
    return adminModules.filter(module => 
      module.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      module.desc.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [searchQuery]);

  return (
    <div className="min-h-screen bg-black text-white pt-40 pb-20 px-6 selection:bg-brandRed/30">
      {/* Background and Header logic */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-brandRed/5 blur-[150px] opacity-50" />
      </div>

      <div className="max-w-7xl mx-auto relative z-10">
        {/* Hero Section */}
        <div className="flex flex-col md:flex-row justify-between items-end mb-20 gap-8">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-3 px-5 py-2 bg-zinc-900 border border-white/5 rounded-full">
              <ShieldCheck size={14} className="text-brandRed" />
              <span className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-400">
                Authorized <span className="text-white">Admin Access</span>
              </span>
            </div>
            <h1 className="text-6xl md:text-9xl font-black italic uppercase tracking-tighter leading-[0.8]">
              Control <br />
              <span className="text-brandRed">Tribe.</span>
            </h1>
          </div>
          
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2 text-brandRed animate-pulse">
              <Zap size={12} fill="currentColor" />
              <span className="text-[10px] font-black uppercase tracking-widest">System Online</span>
            </div>
            <p className="text-zinc-600 font-bold uppercase tracking-[0.5em] text-[10px] border-t border-white/10 pt-4">
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
            <h2 className="text-zinc-500 text-[10px] font-black uppercase tracking-[0.4em] whitespace-nowrap">Operational Modules</h2>
            <div className="h-[1px] flex-1 bg-zinc-900" />
          </div>
          
          <div className="relative group w-full md:w-80">
            <Search className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors duration-300 ${searchQuery ? 'text-brandRed' : 'text-zinc-600'}`} size={16} />
            <input 
              type="text"
              placeholder="SEARCH MODULES..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-950 border border-white/5 p-4 pl-12 rounded-2xl text-[10px] font-black uppercase tracking-widest focus:border-brandRed/50 focus:bg-zinc-900 outline-none transition-all duration-300"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white transition-colors">
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
                <div className="bg-zinc-950 border border-white/5 p-10 rounded-[40px] hover:border-brandRed/40 transition-all duration-700 h-full flex flex-col justify-between overflow-hidden">
                  <div className={`absolute top-0 right-0 w-40 h-40 bg-gradient-to-br ${module.color} to-transparent blur-[50px] opacity-0 group-hover:opacity-100 transition-opacity duration-700`} />
                  <div>
                    <div className="flex justify-between items-start mb-12">
                      <div className="p-6 bg-black border border-white/5 rounded-[32px] group-hover:scale-110 group-hover:border-brandRed/30 transition-all duration-700 shadow-2xl">
                        {module.icon}
                      </div>
                      <span className={`text-[8px] font-black uppercase tracking-widest px-4 py-1.5 rounded-full border ${module.status === 'Live' ? 'text-brandRed border-brandRed/20 bg-brandRed/5' : 'text-zinc-600 border-white/5 bg-white/5'}`}>
                        {module.status}
                      </span>
                    </div>
                    <div className="space-y-4">
                      <h3 className="text-3xl font-black uppercase italic tracking-tighter leading-none group-hover:text-brandRed transition-colors">
                        {module.title}
                      </h3>
                      <p className="text-zinc-500 font-bold italic text-sm leading-relaxed uppercase tracking-wider">
                        {module.desc}
                      </p>
                    </div>
                  </div>
                  <div className="mt-12 pt-8 border-t border-white/5 flex items-center justify-between">
                    <span className="text-white font-black uppercase text-[9px] tracking-[0.3em] opacity-0 group-hover:opacity-100 transition-all">
                      Initialize Module
                    </span>
                    <div className="w-12 h-12 bg-zinc-900 rounded-2xl flex items-center justify-center group-hover:bg-brandRed transition-colors">
                      <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                    </div>
                  </div>
                </div>
              </Link>
            ))
          ) : (
            <div className="lg:col-span-3 py-20 text-center border border-dashed border-white/5 rounded-[40px]">
              <p className="text-zinc-600 font-black uppercase tracking-[0.4em] text-xs">
                No Terminal Matches for "{searchQuery}"
              </p>
              <button onClick={() => setSearchQuery("")} className="mt-4 text-brandRed font-black uppercase tracking-widest text-[9px] hover:underline">
                Clear Protocol
              </button>
            </div>
          )}
          
          {searchQuery === "" && (
            <div className="border-2 border-dashed border-white/5 rounded-[40px] p-10 flex flex-col items-center justify-center text-center opacity-40 hover:opacity-100 transition-opacity cursor-pointer text-zinc-600">
                <Settings className="mb-4" size={40} />
                <p className="text-[10px] font-black uppercase tracking-widest">
                  Global System Settings<br/>Coming Soon
                </p>
            </div>
          )}
        </div>
      </div>
    </div> 
  );
}