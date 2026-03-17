"use client";
import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { Menu, X, Instagram, MessageCircle, User, LogOut, Facebook } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { createBrowserClient } from '@supabase/ssr';

export default function Navbar() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [hasUpcoming, setHasUpcoming] = useState(false);
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
    };
    fetchUser();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    const checkEvents = async () => {
      try {
        const res = await fetch('/api/events/manage');
        const data = await res.json();
        setHasUpcoming(data.hasUpcoming);
      } catch (e) {
        console.error("Signal check failed");
      }
    };
    checkEvents();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setIsMobileMenuOpen(false);
    window.location.href = '/';
  };

  const navLinks = [
    { name: 'Home', href: '/' },
    { name: 'About Us', href: '/about' },
    { name: 'Events', href: '/events' },
    { name: 'Partners', href: '/partners' },
    { name: 'Community', href: '/community' },
    { name: 'Mallu Mart', href: '/directory' },
    { name: 'Contact', href: '/contact' },
  ];

  return (
    <>
      <nav className={`fixed top-0 inset-x-0 z-[100] transition-all duration-300 ${
        scrolled
          ? 'bg-black/90 backdrop-blur-xl shadow-lg shadow-black/40'
          : 'bg-gradient-to-b from-black/60 to-transparent'
      }`}>
        {/* Removed py-3 and tightened horizontal padding for better laptop fit */}
        <div className="w-full px-4 md:px-6 lg:px-8 xl:px-12 flex items-center justify-between gap-2 lg:gap-4 py-1">

          {/* Removed py-2 to shift the nav up and save space */}
          <Link href="/" className="block group flex-shrink-0">
            <Image
              src="/logo.png"
              alt="Puneri Mallus"
              width={400}
              height={120}
              className={`object-contain object-left transition-all duration-300 group-hover:scale-105
                drop-shadow-[0_0_20px_rgba(255,0,0,0.4)] w-auto ${
                scrolled
                  ? 'h-20 sm:h-24 md:h-28'
                : 'h-24 sm:h-28 md:h-32 lg:h-36'
              }`}
              priority
            />
          </Link>

          {/* Adjusted gap values (lg:gap-5) to prevent squishing on smaller 13/14-inch laptops */}
          <div className="hidden lg:flex items-center gap-4 lg:gap-5 xl:gap-8 2xl:gap-10 flex-1 justify-center">
            {navLinks.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link key={link.name} href={link.href} className="group relative py-2">
                  <span className={`text-[10px] xl:text-[11px] 2xl:text-[12px] font-black uppercase tracking-[0.2em] xl:tracking-[0.25em] transition-all duration-300 whitespace-nowrap ${
                    isActive ? 'text-brandRed' : 'text-white/70 group-hover:text-white'
                  }`}>
                    {link.name}
                  </span>
                  {link.name === 'Events' && hasUpcoming && (
                    <span className="absolute -top-0.5 -right-2 flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brandRed opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-brandRed shadow-[0_0_10px_#FF0000]"></span>
                    </span>
                  )}
                  {isActive && (
                    <motion.div
                      layoutId="activeTab"
                      className="absolute -bottom-1 left-0 w-full h-[2px] bg-brandRed shadow-[0_0_12px_#FF0000]"
                    />
                  )}
                </Link>
              );
            })}
          </div>

          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            <div className="hidden lg:flex items-center gap-4">
              {user ? (
                <div className="flex items-center gap-4 relative group">
                  <Link
                    href="/profile"
                    className="flex items-center gap-3 bg-white/5 backdrop-blur-md border border-white/10 p-1.5 pr-4 xl:pr-5 rounded-full hover:border-brandRed transition-all"
                  >
                    <div className="w-8 h-8 xl:w-9 xl:h-9 bg-brandRed rounded-full flex items-center justify-center shadow-[0_0_15px_rgba(255,0,0,0.4)] overflow-hidden">
                      {user.user_metadata?.avatar_url ? (
                        <img 
                          src={user.user_metadata.avatar_url} 
                          alt="Profile" 
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <User size={14} className="text-white" />
                      )}
                    </div>
                    
                    <div className="flex flex-col text-left">
                      <span className="text-[7px] font-black text-zinc-500 uppercase tracking-widest leading-none mb-1">Active Member</span>
                      <span className="text-[10px] font-black text-white uppercase italic leading-none truncate max-w-[100px]">
                        {user.user_metadata?.full_name?.split(' ')[0] || 'Tribe User'}
                      </span>
                    </div>
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="absolute -bottom-12 right-0 bg-zinc-900 border border-white/10 px-4 py-2 rounded-xl text-[9px] font-black uppercase text-zinc-400 hover:text-brandRed opacity-0 group-hover:opacity-100 transition-all flex items-center gap-2 whitespace-nowrap"
                  >
                    <LogOut size={12} /> Sign Out
                  </button>
                </div>
              ) : (
                <Link href="/auth/login">
                  <button className="px-5 lg:px-6 xl:px-8 py-2.5 xl:py-3 rounded-full bg-brandRed text-white font-black uppercase text-[10px] tracking-widest hover:bg-white hover:text-black transition-all duration-300 shadow-[0_0_20px_rgba(255,0,0,0.3)] active:scale-95 whitespace-nowrap">
                    Join Tribe
                  </button>
                </Link>
              )}
            </div>

            {!user && (
              <Link href="/auth/login" className="lg:hidden">
                <button className="px-3 py-2 rounded-full bg-brandRed text-white font-black uppercase text-[9px] tracking-widest active:scale-95 whitespace-nowrap">
                  Join
                </button>
              </Link>
            )}

            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="lg:hidden flex items-center justify-center w-9 h-9 sm:w-11 sm:h-11 bg-zinc-900 rounded-xl border border-white/20 text-white hover:text-brandRed hover:border-brandRed transition-all active:scale-95 flex-shrink-0 mr-1"
              aria-label="Open menu"
            >
              <Menu size={20} strokeWidth={2.5} />
            </button>
          </div>

        </div>
      </nav>

      <AnimatePresence>
        {isMobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsMobileMenuOpen(false)}
              className="fixed inset-0 bg-black/95 backdrop-blur-sm z-[150] lg:hidden"
            />
            <motion.div
              initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 left-0 h-full w-[85%] max-w-[340px] bg-zinc-950 z-[160] p-6 sm:p-8 border-r border-white/10 lg:hidden flex flex-col"
            >
              <div className="flex justify-between items-center mb-10 sm:mb-14">
                <Image src="/logo.png" alt="Logo" width={300} height={90} className="object-contain object-left w-auto h-20 sm:h-24 max-w-[220px]" />
                <button onClick={() => setIsMobileMenuOpen(false)} className="p-2 text-zinc-500 hover:text-brandRed flex-shrink-0">
                  <X size={26} />
                </button>
              </div>

              <div className="flex flex-col gap-5 sm:gap-6 flex-1 overflow-y-auto">
                {navLinks.map((link) => {
                  const isActive = pathname === link.href;
                  return (
                    <Link
                      key={link.name} href={link.href}
                      onClick={() => setIsMobileMenuOpen(false)}
                      className={`text-2xl sm:text-3xl font-black italic tracking-tighter transition-all flex items-center gap-2 ${
                        isActive ? 'text-brandRed translate-x-4' : 'text-white'
                      }`}
                    >
                      {link.name.toUpperCase()}
                      {link.name === 'Events' && hasUpcoming && (
                        <motion.div 
                          animate={{ opacity: [0.4, 1, 0.4] }}
                          transition={{ duration: 2, repeat: Infinity }}
                          className="w-8 h-[2px] bg-brandRed shadow-[0_0_8px_#FF0000]" 
                        />
                      )}
                    </Link>
                  );
                })}
              </div>

              <div className="pt-6 sm:pt-8 border-t border-white/10 space-y-5">
                {user ? (
                  <div className="flex flex-col gap-4">
                    <Link 
                      href="/profile" 
                      onClick={() => setIsMobileMenuOpen(false)}
                      className="flex items-center gap-4 bg-white/5 p-4 rounded-2xl border border-white/10"
                    >
                      <div className="w-10 h-10 bg-brandRed rounded-full flex items-center justify-center overflow-hidden">
                        {user.user_metadata?.avatar_url ? (
                          <img src={user.user_metadata.avatar_url} alt="Profile" className="w-full h-full object-cover" />
                        ) : (
                          <User size={18} className="text-white" />
                        )}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Active Member</span>
                        <span className="text-sm font-black text-white uppercase italic">{user.user_metadata?.full_name || 'Tribe User'}</span>
                      </div>
                    </Link>

                    <button
                      onClick={handleLogout}
                      className="flex items-center gap-2 text-[10px] font-black uppercase text-zinc-500 hover:text-brandRed transition-all px-2"
                    >
                      <LogOut size={14} /> Sign Out
                    </button>
                  </div>
                ) : (
                  <Link href="/auth/login" onClick={() => setIsMobileMenuOpen(false)}>
                    <button className="w-full py-3 rounded-full bg-brandRed text-white font-black uppercase text-[10px] tracking-widest">
                      Join Tribe
                    </button>
                  </Link>
                )}
                <div className="flex gap-4 pt-2 px-2">
                  <Instagram size={20} className="text-zinc-500 hover:text-brandRed cursor-pointer transition-colors" />
                  <Facebook size={20} className="text-zinc-500 hover:text-brandRed cursor-pointer transition-colors" />
                  <MessageCircle size={20} className="text-zinc-500 hover:text-brandRed cursor-pointer transition-colors" />
                </div>
                <p className="text-[8px] font-black text-zinc-700 tracking-[0.3em] uppercase px-2">© 2026 Puneri Mallus Hub</p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}