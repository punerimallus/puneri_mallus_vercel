"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { Instagram, Facebook, MessageCircle, ArrowUpRight, Shield } from 'lucide-react';
import { createBrowserClient } from '@supabase/ssr';

export default function Footer() {
  const pathname = usePathname();
  const [isAuthorized, setIsAuthorized] = useState(false);
  
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    const checkEmail = async (email: string | undefined) => {
      if (!email) {
        setIsAuthorized(false);
        return;
      }
      
      const { data, error } = await supabase
        .from('authorized_admins')
        .select('email')
        .eq('email', email.toLowerCase())
        .single();

      setIsAuthorized(!!data && !error);
    };

    supabase.auth.getUser().then(({ data }) => {
      if (data?.user?.email) checkEmail(data.user.email);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user?.email) {
        checkEmail(session.user.email);
      } else {
        setIsAuthorized(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  if (pathname.startsWith('/admin')) return null;

  const navLinks = [
    { name: 'Home', href: '/' },
    { name: 'About', href: '/about' },
    { name: 'Events', href: '/events' },
    { name: 'Community', href: '/community' },
    { name: 'Partners', href: '/partners' },
    { name: 'Contact', href: '/contact' },
  ];

  const socials = [
    { icon: Instagram, href: 'https://instagram.com/puneri_mallus', label: 'Instagram' },
    { icon: Facebook, href: 'https://facebook.com/punerimallus', label: 'Facebook' },
    { icon: MessageCircle, href: 'https://chat.whatsapp.com/JUmbCVtCCZE27JAXsYw0bU?mode=gi_t', label: 'WhatsApp' },
  ];

  return (
    <footer className="relative z-50 bg-black border-t border-white/5">
      <div className="max-w-7xl mx-auto px-6 md:px-10 pt-16 md:pt-20 pb-8 md:pb-10">
        
        {/* Top Section: Logo & Nav */}
        <div className="flex flex-col lg:flex-row justify-between gap-10 lg:gap-8 pb-10 md:pb-12">
          
          <div className="flex flex-col gap-4 md:gap-5">
            <Link href="/" className="inline-block group">
              {/* Responsive Logo Sizing Fix */}
              <div className="relative h-20 w-[240px] sm:h-28 sm:w-[320px] md:h-36 md:w-[400px] lg:h-48 lg:w-[480px]">
                <Image
                  src="/logo.png"
                  alt="Puneri Mallus"
                  fill
                  className="object-contain object-left transition-all duration-500 group-hover:drop-shadow-[0_0_40px_rgba(255,0,0,0.5)]"
                  priority
                />
              </div>
            </Link>
            <p className="text-zinc-500 text-[10px] md:text-[11px] font-medium uppercase tracking-[0.4em] leading-relaxed max-w-[280px]">
              Kerala's Heart.<br />
              <span className="text-brandRed">Pune's Soul.</span>
            </p>
          </div>

          {/* Navigation Links Grid */}
          <nav className="grid grid-cols-2 sm:grid-cols-3 lg:flex lg:flex-wrap lg:items-start gap-x-6 sm:gap-x-10 gap-y-6 lg:pt-8">
            {navLinks.map((link) => (
              <Link
                key={link.name}
                href={link.href}
                className="text-[11px] md:text-[12px] font-semibold uppercase tracking-[0.2em] text-zinc-500 hover:text-white transition-colors duration-200 whitespace-nowrap"
              >
                {link.name}
              </Link>
            ))}
            
            {/* DYNAMIC TERMINAL LINK */}
            {isAuthorized && (
              <Link
                href="/admin"
                className="flex items-center gap-2 text-[11px] md:text-[12px] font-black uppercase tracking-[0.2em] text-brandRed hover:text-white transition-all group"
              >
                <Shield size={14} className="group-hover:scale-110 transition-transform" />
                Terminal
              </Link>
            )}
          </nav>
        </div>

        {/* Bottom Section: Copyright & Links */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8 pt-8 border-t border-white/5">
          
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] md:text-[11px] font-semibold uppercase tracking-[0.35em] text-zinc-600">
              © 2026 Puneri Mallus Hub
            </span>
            <span className="text-[11px] md:text-[12px] uppercase tracking-[0.3em] text-white">
              Built by Rohit Anish
            </span>
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6 md:gap-8 w-full md:w-auto">
            
            <div className="flex items-center gap-5">
              {socials.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={s.label}
                  className="text-zinc-500 hover:text-white transition-all duration-200 hover:scale-110"
                >
                  <s.icon size={22} className="md:w-[26px] md:h-[26px]" />
                </a>
              ))}
            </div>

            <div className="flex items-center gap-4 md:gap-5">
              <Link href="/privacy" className="text-[9px] md:text-[10px] uppercase tracking-[0.25em] text-zinc-600 hover:text-white transition-colors">
                Privacy
              </Link>
              <Link href="/terms" className="text-[9px] md:text-[10px] uppercase tracking-[0.25em] text-zinc-600 hover:text-white transition-colors">
                Terms
              </Link>
            </div>

            <button
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="flex items-center gap-1.5 text-[9px] md:text-[10px] uppercase tracking-[0.25em] text-zinc-600 hover:text-white transition-colors group mt-2 sm:mt-0"
            >
              Top
              <ArrowUpRight size={12} className="group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-transform duration-200" />
            </button>
          </div>
          
        </div>
      </div>
    </footer>
  );
}