import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin';
import { communityStats } from '@/lib/ui/community-stats';

/**
 * The figures shown under the hero on the home page.
 *
 * Stored alongside the slider and the gallery in site_settings, keyed by type, because it is
 * the same kind of thing: content an admin edits, read by everyone, with no relation to a user
 * or a payment.
 */

export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db('punerimallus');
    const settings = await db.collection('site_settings').findOne({ type: 'community_stats' });
    // Always an array: the home page maps over this, and a failed read must not take the
    // whole landing page down with it.
    return NextResponse.json({ stats: communityStats(settings?.stats) });
  } catch (error) {
    console.error('Community Stats Fetch Error:', error);
    return NextResponse.json({ stats: [] });
  }
}

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const body = await request.json().catch(() => ({}));
    // Normalised rather than trusted: half-filled rows and over-long text are dropped here, so
    // the home page never has to defend against them.
    const stats = communityStats(body?.stats);

    const client = await clientPromise;
    await client.db('punerimallus').collection('site_settings').updateOne(
      { type: 'community_stats' },
      { $set: { stats, updatedAt: new Date() } },
      { upsert: true },
    );

    return NextResponse.json({ success: true, stats });
  } catch (error) {
    console.error('Community Stats Save Error:', error);
    return NextResponse.json({ error: 'Failed to save community stats' }, { status: 500 });
  }
}
