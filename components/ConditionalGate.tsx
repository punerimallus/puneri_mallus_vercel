"use client";

import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';

// The login gate pulls in Firebase; load it after the page is up instead of in the first bundle.
const GlobalEntryGate = dynamic(() => import('@/components/GlobalEntryGate'), { ssr: false });

export default function ConditionalGate() {
  const pathname = usePathname();

  // 🔥 Define the "No-Fly Zone"
  const isAuthOrAdmin = 
    pathname?.includes('/login') || 
    pathname?.includes('/auth') || 
    pathname?.includes('/admin');

  // Only render the gate if we are NOT on an Admin/Auth page
  if (isAuthOrAdmin) return null;

  return <GlobalEntryGate />;
}