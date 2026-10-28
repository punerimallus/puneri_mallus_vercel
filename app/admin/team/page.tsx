"use client";
import { useState, useEffect } from 'react';
import { 
  Plus, Trash2, Loader2, Camera, Shield, 
  ArrowLeft, Save, UserPlus, GripVertical 
} from 'lucide-react';
import { createBrowserClient } from '@supabase/ssr';
import { useAlert } from '@/context/AlertContext';
import { Reorder } from 'framer-motion'; 
import Link from 'next/link';
import Image from 'next/image';
import { friendlyError } from '@/lib/user-errors';

interface TeamMember {
  _id?: string;
  name: string;
  role: string;
  image: string;
}

export default function AdminTeamPage() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const { showAlert } = useAlert();

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const fetchTeam = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/team');
      const data = await res.json();
      if (Array.isArray(data)) setMembers(data);
    } catch (err) {
      showAlert("Failed to sync team data", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTeam(); }, []);

  // Helper to extract filename for Supabase deletion
  const getFilePath = (url: string) => {
    const parts = url.split('/team/');
    return parts.length > 1 ? parts[1] : null;
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || members.length >= 9) return;

    setUploading(true);
    const fileName = `member-${Date.now()}`;
    
    try {
      const { data, error } = await supabase.storage.from('team').upload(fileName, file);
      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage.from('team').getPublicUrl(fileName);
      
      const newMember: TeamMember = { name: "NEW MEMBER", role: "TEAM ROLE", image: publicUrl };
      const updatedList = [...members, newMember];
      setMembers(updatedList);
      await syncToDatabase(updatedList);
    } catch (err: any) {
      showAlert(friendlyError(err), "error");
    } finally {
      setUploading(false);
    }
  };

  // NEW: Replace Image Logic
  const handleReplaceImage = async (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const oldImageUrl = members[index].image;
    const fileName = `member-${Date.now()}`;

    try {
      // 1. Upload new image
      const { error: uploadError } = await supabase.storage.from('team').upload(fileName, file);
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage.from('team').getPublicUrl(fileName);

      // 2. Delete old image from storage
      const oldPath = getFilePath(oldImageUrl);
      if (oldPath) {
        await supabase.storage.from('team').remove([oldPath]);
      }

      // 3. Update state and Database
      const updated = [...members];
      updated[index].image = publicUrl;
      setMembers(updated);
      await syncToDatabase(updated);
      showAlert("Image replaced successfully", "success");
    } catch (err: any) {
      showAlert(friendlyError(err), "error");
    } finally {
      setUploading(false);
    }
  };

  const removeMember = async (index: number) => {
    const memberToDelete = members[index];
    
    try {
      // 1. Delete image from Supabase Storage
      if (memberToDelete.image) {
        const filePath = getFilePath(memberToDelete.image);
        if (filePath) {
          await supabase.storage.from('team').remove([filePath]);
        }
      }

      // 2. Update state and sync
      const updated = members.filter((_, i) => i !== index);
      setMembers(updated);
      await syncToDatabase(updated);
    } catch (err) {
      showAlert("Failed to completely remove member", "error");
    }
  };

  const syncToDatabase = async (currentMembers: TeamMember[]) => {
    setSaving(true);
    try {
      await fetch('/api/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ members: currentMembers })
      });
      showAlert("Team Sequence Updated", "success");
    } catch (err) {
      showAlert("Database sync failed", "error");
    } finally {
      setSaving(false);
    }
  };

  const updateMemberData = (index: number, field: keyof TeamMember, value: string) => {
    const updated = [...members];
    updated[index] = { ...updated[index], [field]: value.toUpperCase() };
    setMembers(updated);
  };

  if (loading) return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <Loader2 className="animate-spin text-brandRed" size={40} />
    </div>
  );

  return (
    <div className="min-h-screen bg-black text-white pt-48 pb-20 px-6 lg:px-16 selection:bg-brandRed/30">
      <div className="max-w-6xl mx-auto">
        
        {/* Header Section */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-16 border-b border-white/5 pb-10">
          <div className="space-y-4">
            <Link href="/admin" className="text-zinc-500 hover:text-white flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.3em] transition-all">
              <ArrowLeft size={14} /> Back to Terminal
            </Link>
            <h1 className="text-6xl md:text-8xl font-black uppercase italic tracking-tighter">
              Team <span className="text-brandRed">Members .</span>
            </h1>
          </div>
          <div className="flex items-center gap-6">
             <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-600 italic">Drag cards to reorder</span>
             <div className="h-10 w-px bg-white/10" />
             <p className={`text-xl font-black italic ${members.length >= 9 ? 'text-brandRed' : 'text-white'}`}>
                {members.length} / 09
             </p>
          </div>
        </div>

        {/* REORDERABLE GRID */}
        <Reorder.Group 
          axis="y" 
          values={members} 
          onReorder={(newOrder) => {
            setMembers(newOrder);
          }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8"
        >
          {members.map((member, idx) => (
            <Reorder.Item 
              key={member.image} 
              value={member}
              onDragEnd={() => syncToDatabase(members)} 
              className="bg-zinc-950 border border-white/5 rounded-[40px] p-8 relative group hover:border-brandRed/30 transition-all duration-500 cursor-grab active:cursor-grabbing"
            >
              {/* Drag Handle */}
              <div className="absolute top-8 left-8 p-2 bg-black rounded-lg border border-white/5 text-zinc-700 opacity-0 group-hover:opacity-100 transition-opacity z-20">
                <GripVertical size={14} />
              </div>

              {/* Portrait */}
              <div className="relative aspect-[3/4] w-full rounded-[30px] overflow-hidden mb-6 border border-white/5 bg-black pointer-events-none">
                <Image src={member.image} alt={member.name} fill className="object-cover" />
                
                {/* Actions (Replace & Delete) */}
                <div className="absolute top-4 right-4 flex gap-2 pointer-events-auto opacity-100 transition-all">
                  <label className="p-3 bg-black/60 backdrop-blur-md text-white hover:text-brandRed rounded-xl border border-white/10 cursor-pointer transition-colors hover:scale-105">
                    <Camera size={16} />
                    <input 
                      type="file" 
                      className="hidden" 
                      accept="image/*" 
                      onChange={(e) => handleReplaceImage(idx, e)} 
                      disabled={uploading} 
                    />
                  </label>
                  <button 
                    onClick={(e) => { e.stopPropagation(); removeMember(idx); }}
                    className="p-3 bg-black/60 backdrop-blur-md text-white hover:text-brandRed rounded-xl border border-white/10 transition-colors hover:scale-105"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              {/* Data Inputs */}
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[8px] font-black uppercase tracking-[0.3em] text-zinc-600 ml-2">Name</label>
                  <input 
                    value={member.name}
                    onChange={(e) => updateMemberData(idx, 'name', e.target.value)}
                    onBlur={() => syncToDatabase(members)}
                    className="w-full bg-black border border-white/10 p-4 rounded-xl text-[11px] font-black uppercase tracking-widest focus:border-brandRed outline-none text-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[8px] font-black uppercase tracking-[0.3em] text-zinc-600 ml-2">Role</label>
                  <input 
                    value={member.role}
                    onChange={(e) => updateMemberData(idx, 'role', e.target.value)}
                    onBlur={() => syncToDatabase(members)}
                    className="w-full bg-black border border-white/10 p-4 rounded-xl text-[11px] font-black uppercase tracking-widest focus:border-brandRed outline-none text-brandRed"
                  />
                </div>
              </div>
            </Reorder.Item>
          ))}

          {/* Add Member Card */}
          {members.length < 9 && (
            <label className="relative aspect-[3/4] border-2 border-dashed border-white/5 rounded-[40px] flex flex-col items-center justify-center cursor-pointer hover:border-brandRed/40 transition-all group overflow-hidden h-full min-h-[400px]">
              {uploading ? (
                <div className="flex flex-col items-center gap-4">
                  <Loader2 className="animate-spin text-brandRed" size={32} />
                  <span className="text-[10px] font-black uppercase tracking-widest text-brandRed">Uploading Image...</span>
                </div>
              ) : (
                <>
                  <UserPlus className="text-zinc-600 group-hover:text-brandRed mb-4" size={32} />
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-600 group-hover:text-white">Add Team Member</span>
                </>
              )}
              <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} accept="image/*" />
            </label>
          )}
        </Reorder.Group>
      </div>
    </div>
  );
}