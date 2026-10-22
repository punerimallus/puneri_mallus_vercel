"use client";
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  format, addMonths, subMonths, startOfMonth, endOfMonth,
  startOfWeek, endOfWeek, isSameMonth, isSameDay, eachDayOfInterval,
  isAfter, isBefore, isValid, setMonth, setYear,
} from 'date-fns';
import { ChevronLeft, ChevronRight, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { parseDateOnly, formatDateOnly } from '@/lib/dob';

interface TribeCalendarProps {
  value: string;
  onChange: (date: string) => void;
  onClose: () => void;
  /** Latest selectable date, "yyyy-MM-dd" (for a birth date: the date 16 years ago). */
  maxDate?: string;
  /** Earliest selectable date, "yyyy-MM-dd". */
  minDate?: string;
  /** Where the calendar opens when nothing is picked yet. */
  defaultDate?: string;
  anchorRef?: React.RefObject<HTMLElement | null>;
  /** Accessible name for the popup, e.g. "Choose your birth date". */
  label?: string;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "yyyy-MM-dd" as a local calendar day; other text (e.g. an event's "OCT 18, 2026") through the browser's parser. */
const toDate = (s?: string): Date | null => {
  if (!s || s === 'DD-MM-YYYY' || s === 'SET DATE') return null;
  const iso = parseDateOnly(s);
  if (iso) return iso;
  const loose = new Date(s);
  return isValid(loose) ? loose : null;
};

type View = 'days' | 'months' | 'years';

export default function TribeCalendar({ value, onChange, onClose, maxDate, minDate, defaultDate, anchorRef, label = 'Choose a date' }: TribeCalendarProps) {
  const calendarRef = useRef<HTMLDivElement>(null);
  const selectedYearRef = useRef<HTMLButtonElement>(null);

  const max = useMemo(() => toDate(maxDate), [maxDate]);
  const min = useMemo(() => toDate(minDate), [minDate]);
  const selectedDate = useMemo(() => toDate(value), [value]);

  const clampMonth = useCallback((month: Date): Date => {
    let m = startOfMonth(month);
    if (max && isAfter(m, startOfMonth(max))) m = startOfMonth(max);
    if (min && isBefore(m, startOfMonth(min))) m = startOfMonth(min);
    return m;
  }, [max, min]);

  const [currentMonth, setCurrentMonth] = useState(() =>
    clampMonth(selectedDate ?? toDate(defaultDate) ?? max ?? new Date()),
  );
  // A birth date is far from today, so start on the year list; a date for an upcoming event starts on the days.
  const [view, setView] = useState<View>(() => (max && !selectedDate ? 'years' : 'days'));
  const [mounted, setMounted] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  const years = useMemo(() => {
    const now = new Date().getFullYear();
    const top = max ? max.getFullYear() : now + 5;
    const bottom = min ? min.getFullYear() : max ? top - 100 : now - 80;
    return Array.from({ length: Math.max(1, top - bottom + 1) }, (_, i) => top - i);
  }, [max, min]);

  const updatePosition = useCallback(() => {
    if (!anchorRef?.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const width = 300;
    const height = 400;
    // On a phone, centre it: it is easier to reach and can never run off the edge.
    let left = window.innerWidth < 480 ? (window.innerWidth - width) / 2 : Math.min(rect.left, window.innerWidth - width - 16);
    left = Math.max(12, left);
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    let top = rect.bottom + window.scrollY + 8;
    if (spaceBelow < height && spaceAbove > spaceBelow) top = Math.max(window.scrollY + 8, rect.top + window.scrollY - height - 8);
    setCoords({ top, left });
  }, [anchorRef]);

  useEffect(() => {
    setMounted(true);
    updatePosition();
    const handleClickOutside = (event: MouseEvent) => {
      if (anchorRef?.current?.contains(event.target as Node)) return;
      if (calendarRef.current && !calendarRef.current.contains(event.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKey);
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [updatePosition, onClose, anchorRef]);

  // Open the year list already scrolled to the chosen year, instead of at the top of a hundred years.
  useEffect(() => {
    if (view === 'years') selectedYearRef.current?.scrollIntoView({ block: 'center' });
  }, [view]);

  if (!mounted || !anchorRef?.current) return null;

  const maxMonthStart = max ? startOfMonth(max) : null;
  const minMonthStart = min ? startOfMonth(min) : null;
  const canNext = !maxMonthStart || isBefore(startOfMonth(currentMonth), maxMonthStart);
  const canPrev = !minMonthStart || isAfter(startOfMonth(currentMonth), minMonthStart);

  const pick = (day: Date) => { onChange(formatDateOnly(day)); onClose(); };

  const header = (
    <div className="flex items-center justify-between px-3 py-3 border-b border-white/10 bg-zinc-950">
      <button type="button" aria-label="Previous month" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} disabled={!canPrev} className="p-2.5 hover:bg-brandRed/20 rounded-full transition-colors disabled:opacity-10">
        <ChevronLeft size={20} className="text-brandRed" />
      </button>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => setView('months')} className="px-2 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest text-white hover:text-brandRed hover:bg-white/5 transition-colors">
          {format(currentMonth, 'MMMM')}
        </button>
        <button type="button" onClick={() => setView('years')} className="px-2 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest text-white hover:text-brandRed hover:bg-white/5 transition-colors">
          {format(currentMonth, 'yyyy')}
        </button>
      </div>
      <button type="button" aria-label="Next month" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} disabled={!canNext} className="p-2.5 hover:bg-brandRed/20 rounded-full transition-colors disabled:opacity-10">
        <ChevronRight size={20} className="text-brandRed" />
      </button>
    </div>
  );

  const content = (
    <motion.div
      ref={calendarRef}
      role="dialog"
      aria-label={label}
      initial={{ opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      style={{ position: 'absolute', top: `${coords.top}px`, left: `${coords.left}px`, width: '300px' }}
      className="bg-zinc-950 border border-white/10 rounded-[32px] shadow-[0_20px_60px_rgba(0,0,0,0.9)] z-[9999] overflow-hidden backdrop-blur-3xl"
    >
      <AnimatePresence mode="wait">
        {view === 'years' ? (
          <motion.div key="years" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <p className="px-4 pt-4 text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">Choose year</p>
            <div className="h-[290px] overflow-y-auto p-4 grid grid-cols-3 gap-2 content-start">
              {years.map((year) => {
                const selected = currentMonth.getFullYear() === year;
                return (
                  <button
                    key={year}
                    ref={selected ? selectedYearRef : undefined}
                    type="button"
                    onClick={() => { setCurrentMonth(clampMonth(setYear(currentMonth, year))); setView('months'); }}
                    className={`py-3 rounded-xl text-[12px] font-bold tracking-widest transition-all ${selected ? 'bg-brandRed text-white' : 'text-zinc-400 hover:bg-white/5'}`}
                  >
                    {year}
                  </button>
                );
              })}
            </div>
          </motion.div>
        ) : view === 'months' ? (
          <motion.div key="months" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="flex items-center justify-between px-4 pt-4">
              <p className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">Choose month</p>
              <button type="button" onClick={() => setView('years')} className="text-[11px] font-black tracking-widest text-white hover:text-brandRed">{format(currentMonth, 'yyyy')}</button>
            </div>
            <div className="p-4 grid grid-cols-3 gap-2">
              {MONTH_NAMES.map((name, i) => {
                const first = new Date(currentMonth.getFullYear(), i, 1);
                const disabled = (!!maxMonthStart && isAfter(first, maxMonthStart)) || (!!minMonthStart && isBefore(first, minMonthStart));
                const selected = currentMonth.getMonth() === i;
                return (
                  <button
                    key={name}
                    type="button"
                    disabled={disabled}
                    onClick={() => { setCurrentMonth(setMonth(currentMonth, i)); setView('days'); }}
                    className={`py-4 rounded-xl text-[12px] font-bold tracking-widest uppercase transition-all ${disabled ? 'opacity-20 cursor-not-allowed text-zinc-600' : selected ? 'bg-brandRed text-white' : 'text-zinc-300 hover:bg-white/5'}`}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </motion.div>
        ) : (
          <motion.div key="days" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {header}
            <div className="grid grid-cols-7 mb-2 border-b border-white/5 bg-zinc-900/30">
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, idx) => (
                <div key={idx} className="py-3 text-[10px] font-black text-zinc-500 text-center uppercase">{day}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1 p-2">
              {eachDayOfInterval({ start: startOfWeek(startOfMonth(currentMonth)), end: endOfWeek(endOfMonth(currentMonth)) }).map((day, idx) => {
                const isDisabled = (!!max && isAfter(day, max)) || (!!min && isBefore(day, min));
                const inMonth = isSameMonth(day, currentMonth);
                const isSelected = !!selectedDate && isSameDay(day, selectedDate);
                return (
                  <button
                    key={idx}
                    type="button"
                    disabled={isDisabled}
                    aria-label={format(day, 'd MMMM yyyy')}
                    aria-pressed={isSelected}
                    onClick={() => pick(day)}
                    className={`h-9 w-full rounded-xl text-[13px] font-bold transition-all flex items-center justify-center
                      ${!inMonth ? 'opacity-25' : 'text-zinc-300'}
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
        <button type="button" onClick={onClose} className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 hover:text-white py-2">Close</button>
        {/* "Today" only where it makes sense. For a birth date it used to set the date to exactly the age limit. */}
        {!max && (
          <button type="button" onClick={() => pick(new Date())} className="text-[10px] font-bold uppercase tracking-widest text-brandRed flex items-center gap-2 hover:scale-105 transition-transform py-2">
            <Zap size={12} fill="currentColor" /> Today
          </button>
        )}
      </div>
    </motion.div>
  );

  return createPortal(content, document.body);
}
