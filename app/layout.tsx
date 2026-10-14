import type { Metadata } from 'next';
import { Inter } from "next/font/google";
import "./globals.css";
import Script from "next/script";
import Navbar from "@/components/Navbar";
import Preloader from "@/components/Preloader";
import { AlertProvider } from "@/context/AlertContext";
import Footer from "@/components/Footer";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";
import { WhatsAppTribe } from '@/components/ui/WhatsappTribe';

// 🔥 Import the new client-side gatekeeper
import ConditionalGate from '@/components/ConditionalGate'; 

const inter = Inter({ subsets: ["latin"] });

// 🔥 FULL METADATA SETUP (Works perfectly because this is now a Server Component)
export const metadata: Metadata = {
  metadataBase: new URL('https://www.punerimallus.com'), 
  title: 'Puneri Mallus | The Hub for Malayalees in Pune',
  description: 'Join the ultimate community for Malayalees in Pune and PCMC. Connect with verified businesses, professionals, and fellow Mallus.',
  openGraph: {
    title: 'Puneri Mallus | The Hub for Malayalees in Pune',
    description: 'Join the ultimate community for Malayalees in Pune and PCMC. Connect with verified businesses, professionals, and fellow Mallus.',
    url: '/', 
    siteName: 'Puneri Mallus',
    images: [
      {
        url: '/logo_main.png',
        width: 552,
        height: 472,
        alt: 'Puneri Mallus Community Banner',
      },
    ],
    locale: 'en_IN',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Puneri Mallus',
    description: 'The professional hub for Malayalees in Pune and PCMC.',
    images: ['/logo_main.png'],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark scroll-smooth overflow-x-hidden">
      <body className={`${inter.className} antialiased bg-black text-white selection:bg-brandRed/30 overflow-x-hidden w-full`}>
        <AlertProvider>
          <Preloader />
          <Navbar />
          <main className="min-h-screen w-full overflow-x-hidden">
            {children}
            
            {/* 🔥 Client-side path checking happens safely inside this component */}
            <ConditionalGate />
            
            <Script
              id="razorpay-checkout-js"
              src="https://checkout.razorpay.com/v1/checkout.js"
              strategy="lazyOnload"
            />
            <SpeedInsights />
            <Analytics/>
          </main>
          <Footer />
        </AlertProvider>
        <WhatsAppTribe 
          label="JOIN OUR COMMUNITY " 
        />
      </body>
    </html>
  );
}