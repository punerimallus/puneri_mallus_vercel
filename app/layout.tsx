import { Inter } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Preloader from "@/components/Preloader";
import { AlertProvider } from "@/context/AlertContext";
import Footer from "@/components/Footer";
// import ChatWidget from "@/components/ChatWidget";
import { SpeedInsights } from "@vercel/speed-insights/next";
const inter = Inter({ subsets: ["latin"] });
import { Analytics } from "@vercel/analytics/next"
import { WhatsAppTribe } from '@/components/ui/WhatsappTribe';
export const metadata = {
  title: "Puneri Mallus | Kerala's Heart, Pune's Soul",
  description: "The official hub for the Malayali community in Pune. Events, Circles, and Tribe Connections.",
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
            <SpeedInsights />
            <Analytics/>
          </main>
          {/* <ChatWidget/> */}
          <Footer />
        </AlertProvider>
        <WhatsAppTribe 
          label="JOIN OUR WHATSAPP COMMUNITY FOR EXCLUSIVE UPDATES" 
        />
      </body>
    </html>
  );
}