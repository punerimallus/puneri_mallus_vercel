"use client";
import Image from 'next/image';
import { Calendar, MapPin } from 'lucide-react';

const events = [
  {
    title: "Christmas Jamming Session",
    date: "April 14, 2026",
    location: "Baner, Pune",
    image: "/about/image_1.jpeg", // Path: public/events/vishu.jpg
    category: "Culture"
  },
  {
    title: "Agam Program",
    date: "Jan 3, 2026",
    location: "Sameer Lawns,Ravet",
    image: "/events/agams.jpg", // Path: public/events/football.jpg
    category: "Music"
  },
  {
    title: "New Year Jamming Session",
    date: "June 05, 2026",
    location: "ST Thomas Church ,Dapodi",
    image: "/events/image_3.jpeg", // Path: public/events/agam.jpg
    category: "Music"
  }
];

export default function EventGlimpse() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
      {events.map((event, index) => (
        <div 
          key={index} 
          className="group relative overflow-hidden rounded-[32px] bg-zinc-950 border border-white/5 hover:border-brandRed/40 transition-all duration-700 shadow-2xl"
        >
          {/* IMAGE CONTAINER */}
          <div className="aspect-[4/5] relative overflow-hidden">
            <Image 
              src={event.image}
              alt={event.title}
              fill
              className="object-cover grayscale group-hover:grayscale-0 group-hover:scale-105 transition-all duration-1000 ease-in-out"
            />
            {/* GRADIENT OVERLAY - Makes text readable */}
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent opacity-90" />
            
            {/* CATEGORY TAG */}
            <div className="absolute top-6 left-6">
              <span className="px-4 py-1.5 rounded-full bg-brandRed text-white text-[10px] font-black uppercase tracking-widest shadow-[0_0_20px_rgba(255,0,0,0.4)]">
                {event.category}
              </span>
            </div>
          </div>

          {/* CONTENT AREA */}
          <div className="absolute bottom-0 w-full p-8 space-y-4">
            <h3 className="text-3xl font-black uppercase tracking-tighter text-white group-hover:text-brandRed transition-colors duration-300">
              {event.title}
            </h3>
            
            <div className="flex flex-col gap-2 opacity-80 group-hover:opacity-100 transition-opacity">
              <div className="flex items-center gap-2 text-zinc-300">
                <Calendar size={14} className="text-brandRed" />
                <span className="text-[11px] font-bold uppercase tracking-[0.2em]">{event.date}</span>
              </div>
              <div className="flex items-center gap-2 text-zinc-300">
                <MapPin size={14} className="text-brandRed" />
                <span className="text-[11px] font-bold uppercase tracking-[0.2em]">{event.location}</span>
              </div>
            </div>

            {/* INTERACTIVE LINE */}
            <div className="w-0 group-hover:w-full h-0.5 bg-brandRed transition-all duration-700 shadow-[0_0_10px_#FF0000]" />
          </div>
        </div>
      ))}
    </div>
  );
}