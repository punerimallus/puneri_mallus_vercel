"use client";
import { useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';

export default function ChatWidget() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    const initChat = async () => {
      // 1. Get current user from Supabase
      const { data: { user } } = await supabase.auth.getUser();
      
      // 2. Configure Convocore
      window.VG_CONFIG = {
        ID: "oBT7fH5qUvtnlRzSaGGX",
        region: 'na',
        render: 'bottom-right',
        stylesheets: [
          "https://cdn.convocore.ai/vg_live_build/styles.css"
          
        ],
        // Pass Supabase user data to the AI
        user: {
          name: user?.user_metadata?.full_name || 'Tribe Member',
          email: user?.email || '',
        },
        userID: user?.id || 'guest',
        autostart: false, 
      };

      // 3. Load the script
      const script = document.createElement("script");
      script.src = "https://cdn.convocore.ai/vg_live_build/vg_bundle.js";
      script.defer = true;
      document.body.appendChild(script);
    };

    initChat();
  }, []);

 return (
  <div 
    id="VG_OVERLAY_CONTAINER" 
    className="fixed bottom-4 right-4 z-[9999]"
    style={{ 
      width: 'auto', 
      height: 'auto' 
    }}
  >
    {/* This is the safest way to ensure clicks always work */}
  </div>
);
}