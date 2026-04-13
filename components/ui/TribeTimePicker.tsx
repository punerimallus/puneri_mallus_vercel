"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, ArrowLeft, Check } from 'lucide-react';

interface TribeTimePickerProps {
  value: string;
  onChange: (time: string) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

export default function TribeTimePicker({ value, onChange, onClose, anchorRef }: TribeTimePickerProps) {
  const pickerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const [view, setView] = useState<'hours' | 'minutes'>('hours');

  // Initial State Parsing
  const parts = value.match(/(\d+):(\d+)\s(AM|PM)/);
  const [selH, setSelH] = useState(parts ? parts[1] : "12");
  const [selM, setSelM] = useState(parts ? parts[2] : "00");
  const [selP, setSelP] = useState(parts ? parts[3] : "PM");

  const hours = Array.from({ length: 12 }, (_, i) => (i + 1).toString().padStart(2, '0'));
  const minutes = ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"];

  const updatePosition = useCallback(() => {
  if (anchorRef.current) {
    const rect = anchorRef.current.getBoundingClientRect();
    const pickerWidth = 320;
    const pickerHeight = 450; // Estimated height

    // 1. Determine if we are on a small screen (mobile)
    const isMobile = window.innerWidth < 768;

    if (isMobile) {
      // Center it on screen for mobile
      setCoords({
        top: window.innerHeight / 2 - pickerHeight / 2 + window.scrollY,
        left: window.innerWidth / 2 - pickerWidth / 2 + window.scrollX
      });
    } else {
      // Desktop: Always drop DOWN unless there is zero space
      const spaceBelow = window.innerHeight - rect.bottom;
      const canFitBelow = spaceBelow > 100; // Minimal threshold

      setCoords({
        top: canFitBelow 
          ? rect.bottom + window.scrollY + 8 
          : rect.top + window.scrollY - pickerHeight - 8,
        left: Math.max(10, Math.min(rect.left, window.innerWidth - pickerWidth - 20))
      });
    }
  }
}, [anchorRef]);

  useEffect(() => {
    setMounted(true);
    updatePosition();
    const handleClickOutside = (e: MouseEvent) => {
      if (anchorRef?.current?.contains(e.target as Node)) return;
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [updatePosition, onClose, anchorRef]);

  if (!mounted || !anchorRef.current) return null;

  const getPosition = (index: number, total: number, radius: number) => {
    const angle = (index * (360 / total) - 90) * (Math.PI / 180);
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius
    };
  };

  const handleConfirm = () => {
    onChange(`${selH}:${selM} ${selP}`);
    onClose();
  };

  return createPortal(
    <motion.div
      ref={pickerRef}
      initial={{ opacity: 0, scale: 0.9, y: -10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9 }}
      style={{ position: 'absolute', top: coords.top, left: coords.left, width: '320px' }}
      className="bg-zinc-950 border border-white/10 rounded-[40px] shadow-[0_30px_100px_rgba(0,0,0,0.9)] z-[9999] overflow-hidden backdrop-blur-3xl p-6"
    >
      {/* HEADER DISPLAY */}
      <div className="flex justify-between items-center mb-8 bg-zinc-900/50 p-4 rounded-3xl border border-white/5">
        <div className="flex gap-1 items-baseline">
          <button onClick={() => setView('hours')} className={`text-3xl font-black italic ${view === 'hours' ? 'text-brandRed' : 'text-zinc-600'}`}>{selH}</button>
          <span className="text-zinc-700 text-2xl">:</span>
          <button onClick={() => setView('minutes')} className={`text-3xl font-black italic ${view === 'minutes' ? 'text-brandRed' : 'text-zinc-600'}`}>{selM}</button>
        </div>
        <div className="flex flex-col gap-1">
          {['AM', 'PM'].map(p => (
            <button key={p} onClick={() => setSelP(p)} className={`px-3 py-1 rounded-lg text-[10px] font-black tracking-widest transition-all ${selP === p ? 'bg-brandRed text-white' : 'text-zinc-600 hover:text-zinc-400'}`}>{p}</button>
          ))}
        </div>
      </div>

      {/* CLOCK FACE */}
      <div className="relative aspect-square w-full bg-zinc-900/30 rounded-full border border-white/5 flex items-center justify-center mb-6">
        <div className="w-2 h-2 bg-brandRed rounded-full z-20" />
        
        <AnimatePresence mode="wait">
          {view === 'hours' ? (
            <motion.div key="hours" initial={{ opacity: 0, rotate: -20 }} animate={{ opacity: 1, rotate: 0 }} exit={{ opacity: 0, rotate: 20 }} className="absolute inset-0">
              {hours.map((h, i) => {
                const pos = getPosition(i, 12, 100);
                const isSelected = selH === h;
                return (
                  <button
                    key={h}
                    onClick={() => { setSelH(h); setView('minutes'); }}
                    style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
                    className={`absolute top-[42%] left-[42%] w-10 h-10 rounded-full flex items-center justify-center text-sm font-black transition-all ${isSelected ? 'bg-brandRed text-white shadow-[0_0_20px_rgba(255,0,0,0.4)]' : 'text-zinc-500 hover:text-white'}`}
                  >
                    {h}
                  </button>
                );
              })}
            </motion.div>
          ) : (
            <motion.div key="minutes" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.2 }} className="absolute inset-0">
              {minutes.map((m, i) => {
                const pos = getPosition(i, 12, 100);
                const isSelected = selM === m;
                return (
                  <button
                    key={m}
                    onClick={() => setSelM(m)}
                    style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
                    className={`absolute top-[42%] left-[42%] w-10 h-10 rounded-full flex items-center justify-center text-xs font-black transition-all ${isSelected ? 'bg-brandRed text-white' : 'text-zinc-600 hover:text-white'}`}
                  >
                    {m}
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* FOOTER */}
      <div className="flex gap-3">
        <button onClick={onClose} className="flex-1 py-4 text-[9px] font-black uppercase tracking-widest text-zinc-500">Cancel</button>
        <button onClick={handleConfirm} className="flex-[2] py-4 bg-white text-black rounded-2xl text-[9px] font-black uppercase tracking-widest hover:bg-brandRed hover:text-white transition-all flex items-center justify-center gap-2">
          Confirm Time <Check size={14} />
        </button>
      </div>
    </motion.div>,
    document.body
  );
}