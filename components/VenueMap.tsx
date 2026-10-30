"use client";

// The 2D venue map on the booking page: a plan of the room with each pass category drawn where
// it actually sits, so a buyer can see what they are paying for before they pay.
//
// SVG rather than canvas, on purpose: taps hit-test themselves, it stays crisp at any size, one
// viewBox makes it responsive with no redraw-on-resize code, and each zone can carry a <title>
// a screen reader will read out.
//
// It sells nothing. Tapping a zone is the same as pressing ADD on that category's card — the
// cart, the hold and the reservation are all the parent page's, exactly as before.

import { Fragment, useMemo } from 'react';
import {
  DEFAULT_COLS,
  boundsOf,
  labelPoint,
  rowRuns,
  zoneState,
  type Cell,
  type VenueLayout,
  type ZoneState,
} from '@/lib/events/venue-layout';
import { formatAmount } from '@/lib/payments/format';

export interface MapZone {
  id: string;
  name: string;
  /** The price to print, after any member discount the page has already worked out. */
  price: number;
  cells: Cell[];
  color: string;
  /** Seats left, or null for an unlimited category. */
  left: number | null;
  /** How many of this category are in the cart right now. */
  qty: number;
  /**
   * People admitted per pass. Anything above 1 is printed on the zone, because a group pass at
   * Rs.1200 and a single at Rs.1200 are otherwise the same label for very different things.
   */
  admits?: number;
}

interface Props {
  layout: VenueLayout;
  zones: MapZone[];
  /** Pressed a zone: the parent adds one to the cart, or scrolls to that card. */
  onPick?: (id: string) => void;
  /** The category the buyer is currently looking at, highlighted in both directions. */
  activeId?: string | null;
}

const FEATURE_STYLE: Record<string, { fill: string; stroke: string; text: string; dashed?: boolean }> = {
  stage:    { fill: 'url(#pm-stage)', stroke: 'rgba(255,255,255,0.35)', text: '#ffffff' },
  aisle:    { fill: 'rgba(255,255,255,0.02)', stroke: 'rgba(255,255,255,0.14)', text: '#a1a1aa', dashed: true },
  entry:    { fill: 'rgba(16,185,129,0.14)', stroke: 'rgba(16,185,129,0.55)', text: '#6ee7b7' },
  exit:     { fill: 'rgba(16,185,129,0.14)', stroke: 'rgba(16,185,129,0.55)', text: '#6ee7b7' },
  bar:      { fill: 'rgba(255,255,255,0.05)', stroke: 'rgba(255,255,255,0.2)', text: '#d4d4d8' },
  food:     { fill: 'rgba(255,255,255,0.05)', stroke: 'rgba(255,255,255,0.2)', text: '#d4d4d8' },
  washroom: { fill: 'rgba(255,255,255,0.05)', stroke: 'rgba(255,255,255,0.2)', text: '#d4d4d8' },
  label:    { fill: 'transparent', stroke: 'transparent', text: '#a1a1aa' },
};

/** Sold out is drawn grey and hatched, never just dimmed: colour alone is not a signal everyone sees. */
const stateFill = (state: ZoneState, color: string, selected: boolean): string => {
  if (state === 'sold-out') return 'rgba(63,63,70,0.35)';
  if (selected) return color;
  return `${color}59`; // ~35% alpha, so the label still reads over it
};

export default function VenueMap({ layout, zones, onPick, activeId }: Props) {
  const { cols, rows, features, planUrl, planOpacity } = layout;
  // Everything textual is sized against the grid, so a 24-column plan does not render in 8px type.
  const u = cols / DEFAULT_COLS;
  const pad = 0.4 * u;

  const drawn = useMemo(() => zones.filter((z) => z.cells.length > 0), [zones]);
  if (!drawn.length) return null;

  const nameSize = 0.46 * u;
  const metaSize = 0.34 * u;

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Where you will be</h3>
        <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-600">Tap a zone</span>
      </div>

      {/* Capped and centred: with a viewBox the type scales with the box, and an unbounded
          width would render the labels comically large on a desktop. */}
      <div className="mx-auto w-full max-w-[420px] rounded-3xl border border-white/10 bg-gradient-to-b from-zinc-950 to-black p-3 shadow-inner">
        <svg
          viewBox={`${-pad} ${-pad} ${cols + pad * 2} ${rows + pad * 2}`}
          className="w-full h-auto select-none"
          role="group"
          aria-label="Venue map. Each area shows which pass covers it."
        >
          <defs>
            <linearGradient id="pm-stage" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3f3f46" />
              <stop offset="100%" stopColor="#09090b" />
            </linearGradient>
            {/* The sold-out hatch. userSpaceOnUse keeps the stripes the same width in every zone. */}
            <pattern id="pm-soldout" width={0.5 * u} height={0.5 * u} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2={0.5 * u} stroke="rgba(255,255,255,0.14)" strokeWidth={0.07 * u} />
            </pattern>
          </defs>

          {/* The venue's own floor plan, if one was uploaded. Underneath everything and dimmed,
              because it is orientation, not the thing being sold. "meet" keeps it undistorted;
              the editor draws it in the same box, so painted zones land where the admin put them. */}
          {planUrl && (
            <image
              href={planUrl}
              x={0}
              y={0}
              width={cols}
              height={rows}
              preserveAspectRatio="xMidYMid meet"
              opacity={(planOpacity ?? 45) / 100}
              pointerEvents="none"
            />
          )}

          {/* The room: stage, doors, dance floor. Shapes first, so zones sit on top of them —
              their labels are drawn again after the zones, below. */}
          {features.map((f, i) => {
            const style = FEATURE_STYLE[f.kind] || FEATURE_STYLE.label;
            return (
              <rect
                key={`f-${i}`}
                x={f.x + 0.04}
                y={f.y + 0.04}
                width={Math.max(0, f.w - 0.08)}
                height={Math.max(0, f.h - 0.08)}
                rx={0.22 * u}
                fill={style.fill}
                stroke={style.stroke}
                strokeWidth={0.05 * u}
                strokeDasharray={style.dashed ? `${0.25 * u} ${0.2 * u}` : undefined}
              />
            );
          })}

          {/* One group per category. The whole group is the tap target. */}
          {drawn.map((z) => {
            const state = zoneState(z.left);
            const soldOut = state === 'sold-out';
            const selected = z.qty > 0;
            const active = activeId === z.id;
            const runs = rowRuns(z.cells);
            const at = labelPoint(z.cells);
            const pickable = !soldOut && !!onPick;
            const admits = Math.max(1, Math.floor(z.admits || 1));
            const box = boundsOf(z.cells);
            const badge = { x: box.x + box.w - 0.42, y: box.y + 0.42 };

            return (
              <g
                key={z.id}
                onClick={pickable ? () => onPick!(z.id) : undefined}
                role={pickable ? 'button' : undefined}
                tabIndex={pickable ? 0 : undefined}
                aria-disabled={soldOut || undefined}
                onKeyDown={
                  pickable
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onPick!(z.id);
                        }
                      }
                    : undefined
                }
                style={{ cursor: pickable ? 'pointer' : 'not-allowed', outline: 'none' }}
                className="transition-opacity duration-200"
                opacity={soldOut ? 0.75 : 1}
              >
                <title>
                  {`${z.name} — ₹${formatAmount(z.price)}${
                    soldOut ? ' — sold out' : state === 'filling' ? ` — only ${z.left} left` : ''
                  }`}
                </title>

                {runs.map((r, i) => (
                  <Fragment key={`${z.id}-${i}`}>
                    <rect
                      x={r.x + 0.05}
                      y={r.y + 0.05}
                      width={Math.max(0, r.w - 0.1)}
                      height={0.9}
                      rx={0.18 * u}
                      fill={stateFill(state, z.color, selected || active)}
                      stroke={soldOut ? 'rgba(113,113,122,0.5)' : z.color}
                      strokeWidth={(selected || active ? 0.1 : 0.05) * u}
                    />
                    {soldOut && (
                      <rect
                        x={r.x + 0.05}
                        y={r.y + 0.05}
                        width={Math.max(0, r.w - 0.1)}
                        height={0.9}
                        rx={0.18 * u}
                        fill="url(#pm-soldout)"
                        pointerEvents="none"
                      />
                    )}
                  </Fragment>
                ))}

                {/* Name and price, on a dark plate so they read over any zone colour. */}
                <g pointerEvents="none">
                  <text
                    x={at.x}
                    y={at.y - metaSize * 0.75}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={soldOut ? '#a1a1aa' : '#ffffff'}
                    fontSize={nameSize}
                    fontWeight={900}
                    letterSpacing={0.03 * u}
                    stroke="rgba(0,0,0,0.85)"
                    strokeWidth={0.1 * u}
                    paintOrder="stroke"
                    style={{ textTransform: 'uppercase' }}
                  >
                    {z.name}
                  </text>
                  <text
                    x={at.x}
                    y={at.y + nameSize * 0.72}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={soldOut ? '#71717a' : 'rgba(255,255,255,0.85)'}
                    fontSize={metaSize}
                    fontWeight={700}
                    stroke="rgba(0,0,0,0.85)"
                    strokeWidth={0.09 * u}
                    paintOrder="stroke"
                  >
                    {soldOut
                      ? 'SOLD OUT'
                      : admits > 1
                        ? `₹${formatAmount(z.price)} · ${admits} people`
                        : `₹${formatAmount(z.price)}`}
                  </text>
                </g>

                {/* How many of this zone are in the cart. Pinned to the zone's own top-right
                    corner: anchoring it to the label meant guessing the text width, which drifted
                    off the zone on a long category name. Never shown on a sold-out zone. */}
                {selected && !soldOut && (
                  <g pointerEvents="none">
                    <circle cx={badge.x} cy={badge.y} r={0.34 * u} fill="#ffffff" stroke="#000000" strokeWidth={0.05 * u} />
                    <text
                      x={badge.x}
                      y={badge.y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="#000000"
                      fontSize={0.38 * u}
                      fontWeight={900}
                    >
                      {z.qty}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Fixture labels last. An admin can paint a zone across the stage — some venues do
              sell stage-side — and STAGE still has to be readable, or the plan loses the one
              thing it exists to tell you. */}
          {features.map((f, i) =>
            f.label ? (
              <text
                key={`fl-${i}`}
                x={f.x + f.w / 2}
                y={f.y + f.h / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fill={(FEATURE_STYLE[f.kind] || FEATURE_STYLE.label).text}
                fontSize={(f.kind === 'stage' ? 0.44 : 0.3) * u}
                fontWeight={900}
                letterSpacing={0.08 * u}
                stroke="rgba(0,0,0,0.75)"
                strokeWidth={0.08 * u}
                paintOrder="stroke"
                pointerEvents="none"
                style={{ textTransform: 'uppercase' }}
              >
                {f.label}
              </text>
            ) : null,
          )}
        </svg>
      </div>

      {/* What the shading means. The prices themselves are on the cards below, so this only has
          to explain the colours. */}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        {[
          { label: 'Available', cls: 'bg-white/30 border-white/50' },
          { label: 'Few left', cls: 'bg-orange-500/40 border-orange-500' },
          { label: 'Sold out', cls: 'bg-zinc-800 border-zinc-700' },
          { label: 'In your cart', cls: 'bg-white border-white' },
        ].map((l) => (
          <span key={l.label} className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-zinc-500">
            <span className={`w-2.5 h-2.5 rounded-[3px] border ${l.cls}`} /> {l.label}
          </span>
        ))}
      </div>

      {/* Said plainly, because a drawn map makes people assume they own a particular chair. */}
      <p className="mt-3 text-center text-[9px] font-bold uppercase tracking-widest text-zinc-600 leading-relaxed">
        Zone entry · seating is open within your zone
      </p>
    </div>
  );
}
