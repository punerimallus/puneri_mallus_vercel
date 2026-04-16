"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { 
  format, addMonths, subMonths, startOfMonth, endOfMonth, 
  startOfWeek, endOfWeek, isSameMonth, isSameDay, eachDayOfInterval, 
  getYear, setYear, isAfter, parseISO, isValid
} from 'date-fns';
import { ChevronLeft, ChevronRight, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface TribeCalendarProps {
  value: string;
  onChange: (date: string) => void;
  onClose: () => void;
  maxDate?: string;
  anchorRef?: React.RefObject<HTMLElement | null>; 
}

export default function TribeCalendar({ value, onChange, onClose, maxDate, anchorRef }: TribeCalendarProps) {
  const calendarRef = useRef<HTMLDivElement>(null);
  
  // Helper to safely parse dates (Handles ISO and Human Readable like "APR 16, 2026")
  const safeParse = (dateStr: string): Date => {
    if (!dateStr || dateStr === "DD-MM-YYYY" || dateStr === "SET DATE") return new Date();
    const parsed = new Date(dateStr); // Native Date is more forgiving than parseISO for human formats
    return isValid(parsed) ? parsed : new Date();
  };

  const [currentMonth, setCurrentMonth] = useState(() => {
    const initial = value ? safeParse(value) : (maxDate ? safeParse(maxDate) : new Date());
    return startOfMonth(initial);
  });

  const [showYearPicker, setShowYearPicker] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  
  const selectedDate = (value && value !== "DD-MM-YYYY" && value !== "SET DATE") ? safeParse(value) : null;
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 101 }, (_, i) => (currentYear + 10) - i); // Shows 10 years in future to 90 in past

  const updatePosition = useCallback(() => {
    if (anchorRef?.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      const calendarWidth = 300;
      let left = rect.left;
      
      // Prevent overflow on right side of screen
      if (left + calendarWidth > window.innerWidth) {
        left = window.innerWidth - calendarWidth - 20;
      }

      setCoords({
        top: rect.bottom + window.scrollY + 8,
        left: Math.max(20, left) // Prevent overflow on left side
      });
    }
  }, [anchorRef]);

  useEffect(() => {
    setMounted(true);
    updatePosition();
    
    const handleClickOutside = (event: MouseEvent) => {
      if (anchorRef?.current?.contains(event.target as Node)) return;
      if (calendarRef.current && !calendarRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [updatePosition, onClose, anchorRef]);

  if (!mounted || !anchorRef?.current) return null;

  const renderHeader = () => (
    <div className="flex items-center justify-between px-4 py-4 border-b border-white/10 bg-zinc-950">
      <button type="button" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-2 hover:bg-brandRed/20 rounded-full transition-colors">
        <ChevronLeft size={20} className="text-brandRed" />
      </button>
      
      <button type="button" onClick={() => setShowYearPicker(!showYearPicker)} className="text-[11px] font-black uppercase tracking-widest text-white hover:text-brandRed transition-colors flex items-center gap-2">
        {isValid(currentMonth) ? format(currentMonth, 'MMMM yyyy') : 'Select Month'}
      </button>

      <button 
        type="button" 
        onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} 
        disabled={maxDate ? isAfter(addMonths(startOfMonth(currentMonth), 1), safeParse(maxDate)) : false}
        className="p-2 hover:bg-brandRed/20 rounded-full transition-colors disabled:opacity-10"
      >
        <ChevronRight size={20} className="text-brandRed" />
      </button>
    </div>
  );

  const content = (
    <motion.div 
      ref={calendarRef}
      initial={{ opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      style={{
        position: 'absolute',
        top: `${coords.top}px`,
        left: `${coords.left}px`,
        width: '300px',
      }}
      className="bg-zinc-950 border border-white/10 rounded-[32px] shadow-[0_20px_60px_rgba(0,0,0,0.9)] z-[9999] overflow-hidden backdrop-blur-3xl"
    >
      <AnimatePresence mode="wait">
        {showYearPicker ? (
          <motion.div key="years" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-[320px] overflow-y-auto p-4 grid grid-cols-3 gap-2 bg-zinc-950 scrollbar-hide">
            {years.map(year => {
                const isYearDisabled = maxDate ? year > getYear(safeParse(maxDate)) : false;
                return (
                    <button 
                        key={year} 
                        type="button" 
                        disabled={isYearDisabled}
                        onClick={() => { setCurrentMonth(setYear(currentMonth, year)); setShowYearPicker(false); }} 
                        className={`py-3 rounded-xl text-[10px] font-black tracking-widest transition-all 
                            ${getYear(currentMonth) === year ? 'bg-brandRed text-white shadow-[0_0_15px_rgba(255,0,0,0.3)]' : 'text-zinc-500 hover:bg-white/5'}
                            ${isYearDisabled ? 'opacity-10 cursor-not-allowed' : ''}
                        `}
                    >
                        {year}
                    </button>
                );
            })}
          </motion.div>
        ) : (
          <motion.div key="calendar" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {renderHeader()}
            <div className="grid grid-cols-7 mb-2 border-b border-white/5 bg-zinc-900/30">
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, idx) => (
                <div key={idx} className="py-3 text-[10px] font-black text-zinc-600 text-center uppercase">{day}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1 p-2">
              {eachDayOfInterval({ 
                start: startOfWeek(startOfMonth(currentMonth)), 
                end: endOfWeek(endOfMonth(currentMonth)) 
              }).map((day, idx) => {
                const isDisabled = maxDate ? isAfter(day, safeParse(maxDate)) : false;
                const isCurrentMonth = isSameMonth(day, currentMonth);
                const isSelected = selectedDate && isSameDay(day, selectedDate);
                
                return (
                  <button
                    key={idx} type="button" disabled={isDisabled}
                    onClick={() => { if (!isDisabled) { onChange(format(day, 'yyyy-MM-dd')); onClose(); } }}
                    className={`h-9 w-full rounded-xl text-[11px] font-bold transition-all flex items-center justify-center 
                      ${!isCurrentMonth ? 'opacity-10' : 'text-zinc-300'} 
                      ${isSelected ? 'bg-brandRed text-white shadow-[0_0_15px_rgba(255,0,0,0.4)]' : 'hover:bg-white/5'} 
                      ${isDisabled ? 'opacity-10 cursor-not-allowed' : ''}`}
                  >
                    {format(day, 'd')}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="p-4 bg-zinc-900/50 flex justify-between items-center border-t border-white/5">
        <button type="button" onClick={onClose} className="text-[9px] font-black uppercase tracking-widest text-zinc-500 hover:text-white transition-colors">Close</button>
        <button 
          type="button" 
          onClick={() => { 
            const target = maxDate ? safeParse(maxDate) : new Date();
            onChange(format(target, 'yyyy-MM-dd')); 
            onClose(); 
          }} 
          className="text-[9px] font-black uppercase tracking-widest text-brandRed flex items-center gap-2 hover:scale-105 transition-transform"
        >
          <Zap size={10} fill="currentColor" /> {maxDate ? 'Limit' : 'Today'}
        </button>
      </div>
    </motion.div>
  );

  return createPortal(content, document.body);
}