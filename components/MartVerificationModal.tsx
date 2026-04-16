"use client";
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ShieldCheck, X, Upload, Loader2, CheckCircle2, 
  FileText, UserCheck, Landmark, AlertCircle 
} from 'lucide-react';
import { createBrowserClient } from '@supabase/ssr';
import { useAlert } from '@/context/AlertContext';

interface MartVerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  businessId: string;
  businessName: string;
  userEmail: string;
}

export default function MartVerificationModal({ 
  isOpen, onClose, businessId, businessName, userEmail 
}: MartVerificationModalProps) {
  const { showAlert } = useAlert();
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [files, setFiles] = useState<{ [key: string]: File | null }>({
    shopAct: null,
    idProof: null,
    utility: null
  });

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, key: string) => {
    const file = e.target.files?.[0];
    if (file) setFiles(prev => ({ ...prev, [key]: file }));
  };

  const handleSubmit = async () => {
    if (!files.shopAct || !files.idProof) {
      showAlert("Critical documents missing", "error");
      return;
    }

    setLoading(true);
    try {
      const docUrls: { [key: string]: string } = {};

      // 1. Upload each file to verification-vault
      for (const [key, file] of Object.entries(files)) {
        if (!file) continue;
        
        const fileExt = file.name.split('.').pop();
        const fileName = `${businessId}/${key}-${Date.now()}.${fileExt}`;
        
        const { data, error: uploadError } = await supabase.storage
          .from('mallu-mart')
          .upload(`verification-vault/${fileName}`, file);

        if (uploadError) throw uploadError;
        
        const { data: { publicUrl } } = supabase.storage
          .from('mallu-mart')
          .getPublicUrl(data.path);
          
        docUrls[key] = data.path; // Store relative path for secure deletion later
      }

      // 2. Patch the MongoDB Record
      const res = await fetch('/api/mart', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: businessId,
          userEmail,
          verificationDocs: docUrls,
          auditType: 'SUBMIT_VERIFICATION'
        })
      });

      if (res.ok) {
        setSuccess(true);
        showAlert("Verification protocol initiated", "success");
        setTimeout(() => {
          onClose();
          setSuccess(false);
        }, 3000);
      }
    } catch (error) {
      showAlert("Transmission error", "error");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/90 backdrop-blur-md"
            onClick={onClose}
          />
          
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="relative w-full max-w-lg bg-zinc-950 border border-white/10 rounded-[40px] shadow-2xl overflow-hidden p-8 md:p-10"
          >
            {success ? (
              <div className="py-20 text-center space-y-4">
                <CheckCircle2 size={60} className="text-green-500 mx-auto animate-bounce" />
                <h2 className="text-2xl font-black uppercase italic tracking-tighter">Request Received</h2>
                <p className="text-zinc-500 text-[10px] uppercase tracking-widest leading-relaxed">
                  The Tribe Moderator has been alerted. <br />
                  Audit completion expected in 24-48 hours.
                </p>
              </div>
            ) : (
              <>
                <div className="flex justify-between items-start mb-8">
                  <div className="space-y-1">
                    <h2 className="text-2xl font-black uppercase italic tracking-tighter text-white">
                      Get <span className="text-brandRed">Verified .</span>
                    </h2>
                    <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Protocol for: {businessName}</p>
                  </div>
                  <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors text-zinc-500">
                    <X size={20} />
                  </button>
                </div>

                <div className="space-y-6">
                  {/* DOCUMENT INPUTS */}
                  {[
                    { key: 'shopAct', label: 'Business Registration', icon: Landmark, desc: 'Shop Act, GST, or Udyam Cert' },
                    { key: 'idProof', label: 'Founder Identity', icon: UserCheck, desc: 'Aadhar or PAN Card' },
                    { key: 'utility', label: 'Operational Proof', icon: FileText, desc: 'Electricity or Water Bill' }
                  ].map((doc) => (
                    <div key={doc.key} className="relative group">
                      <label className={`flex items-center gap-4 p-4 rounded-2xl border transition-all cursor-pointer ${
                        files[doc.key] ? 'bg-brandRed/5 border-brandRed/30' : 'bg-black border-white/5 hover:border-white/20'
                      }`}>
                        <div className={`p-3 rounded-xl ${files[doc.key] ? 'bg-brandRed text-white' : 'bg-zinc-900 text-zinc-500'}`}>
                          <doc.icon size={20} />
                        </div>
                        <div className="flex-1">
                          <p className="text-[10px] font-black uppercase tracking-widest text-white">{doc.label}</p>
                          <p className="text-[8px] font-bold text-zinc-600 uppercase tracking-tighter mt-0.5">{files[doc.key] ? files[doc.key]?.name : doc.desc}</p>
                        </div>
                        <Upload size={16} className={files[doc.key] ? 'text-brandRed' : 'text-zinc-800'} />
                        <input type="file" className="hidden" accept=".pdf,image/*" onChange={(e) => handleFileChange(e, doc.key)} />
                      </label>
                    </div>
                  ))}

                  <div className="bg-white/5 p-4 rounded-2xl border border-white/5 flex gap-3">
                    <AlertCircle size={16} className="text-zinc-500 shrink-0 mt-0.5" />
                    <p className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest leading-relaxed">
                      Submission of false documents will result in a <span className="text-brandRed">permanent ban</span> from the Mallu Mart ecosystem.
                    </p>
                  </div>

                  <button 
                    disabled={loading}
                    onClick={handleSubmit}
                    className="w-full py-5 bg-brandRed text-white font-black uppercase tracking-widest rounded-2xl hover:bg-white hover:text-black transition-all shadow-xl active:scale-95 flex items-center justify-center gap-3 text-xs"
                  >
                    {loading ? <Loader2 className="animate-spin" size={18} /> : (
                      <>Initialize Audit <ShieldCheck size={18} /></>
                    )}
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}