"use client";
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, LayoutGrid, X } from 'lucide-react';

const SECTIONS = [
  { label: 'Hero Banner', href: '/admin/slider' },
  { label: 'Promotions & Ads', href: '/admin/collabs' },
  { label: 'Partners', href: '/admin/partners' },
  { label: 'Events', href: '/admin/events' },
  { label: 'Community', href: '/admin/community' },
  { label: 'Photo Gallery', href: '/admin/gallery' },
  { label: 'Social Media', href: '/admin/social' },
  { label: 'Members', href: '/admin/members' },
  { label: 'Box Office', href: '/admin/boxoffice' },
  { label: 'Email Studio', href: '/admin/emails' },
  { label: 'Support', href: '/admin/support' },
  { label: 'Mallu Mart', href: '/admin/mart' },
  { label: 'Payments', href: '/admin/payments' },
  { label: 'Football', href: '/admin/football' },
  { label: 'Gate Volunteers', href: '/admin/volunteers' },
  { label: 'Gate Scanner', href: '/gate' },
];

/** Floating admin navigation: back to the dashboard, which section you are in, and a switcher for every other section. */
export default function AdminDock({ email = '' }: { email?: string }) {
  const pathname = usePathname() || '';
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
  }, [open]);

  // The dashboard is its own menu. (The gate scanner now lives at /gate, outside this layout,
  // so it never shows the dock at all.)
  if (pathname === '/admin' || pathname === '/admin/') return null;

  const current = SECTIONS.find((s) => pathname === s.href || pathname.startsWith(`${s.href}/`));

  return (
    <div ref={ref} className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[90] w-[calc(100%-2rem)] max-w-md">
      {open && (
        <div role="menu" aria-label="Admin sections" className="mb-2 rounded-3xl border border-white/10 bg-zinc-950/95 backdrop-blur-xl p-3 shadow-2xl">
          <div className="flex items-center justify-between px-2 pb-2">
            <p className="min-w-0 truncate text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">Jump to{email ? <span className="normal-case tracking-normal font-semibold text-zinc-600"> · {email}</span> : null}</p>
            <button onClick={() => setOpen(false)} aria-label="Close menu" className="p-2 -m-2 text-zinc-500 hover:text-white"><X size={16} /></button>
          </div>
          <div className="grid grid-cols-2 gap-1.5 max-h-[50vh] overflow-y-auto">
            {SECTIONS.map((s) => {
              const active = current?.href === s.href;
              return (
                <Link key={s.href} href={s.href} role="menuitem" aria-current={active ? 'page' : undefined}
                  className={`px-3 py-3 rounded-xl text-[11px] font-black uppercase tracking-widest transition-colors ${active ? 'bg-brandRed text-white' : 'bg-white/[0.03] text-zinc-300 hover:bg-white/10 hover:text-white'}`}>
                  {s.label}
                </Link>
              );
            })}
          </div>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 rounded-full border border-white/10 bg-zinc-950/90 backdrop-blur-xl pl-2 pr-2 py-2 shadow-[0_10px_40px_rgba(0,0,0,0.6)]">
        <Link href="/admin" className="flex items-center gap-2 px-4 min-h-[40px] rounded-full bg-white/5 hover:bg-white/10 text-[11px] font-black uppercase tracking-widest text-white transition-colors">
          <ArrowLeft size={14} /> Dashboard
        </Link>
        <span className="min-w-0 truncate text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">{current?.label ?? 'Admin'}</span>
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" aria-label="Open admin sections"
          className="flex items-center gap-2 px-4 min-h-[40px] rounded-full bg-brandRed hover:bg-red-600 text-[11px] font-black uppercase tracking-widest text-white transition-colors">
          <LayoutGrid size={14} /> <span className="hidden sm:inline">Sections</span>
        </button>
      </div>
    </div>
  );
}
