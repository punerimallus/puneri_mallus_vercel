// Fail loudly when the database is behind the code.
//
// The old code carried a fallback for every optional column: if `scan_version` was missing it
// scanned anyway (silently dropping the guard that stops two gates admitting the same group
// pass), if the WhatsApp columns were missing it inserted without them, if the newer
// allocate_tickets wasn't there it called the older one. Each fallback individually looked
// kind. Together they meant a half-migrated database kept taking money while quietly behaving
// differently from the code, which is far worse than an obvious error.
//
// So: one marker row, checked once per process, and a refusal to take payments without it.

export const REQUIRED_MARKER = 'ticketing_integrity_v1';

export interface SchemaStatus {
  ok: boolean;
  marker: string;
  appliedAt?: string | null;
  error?: string;
}

/**
 * The tiny slice of a Supabase client this needs. Callers pass their client through
 * `asMarkerDb` rather than relying on structural matching: Supabase's generated types are deep
 * enough that matching them against an interface makes the compiler give up.
 */
export interface MarkerDb {
  from(table: string): {
    select(cols: string): {
      eq(col: string, val: string): {
        maybeSingle(): PromiseLike<{ data: { applied_at?: string } | null; error: { message: string } | null }>;
      };
    };
  };
}

/** Narrows any Supabase client to just what `checkSchema` touches. */
export function asMarkerDb(client: unknown): MarkerDb {
  return client as MarkerDb;
}

let cached: SchemaStatus | null = null;

/**
 * Has the ticketing migration been applied? Cached after the first successful answer, because a
 * migration cannot un-apply itself while the process lives. A failure is never cached, so the
 * check recovers on its own once the migration is run.
 */
export async function checkSchema(db: MarkerDb): Promise<SchemaStatus> {
  if (cached?.ok) return cached;
  try {
    const { data, error } = await db.from('app_schema_markers').select('applied_at').eq('name', REQUIRED_MARKER).maybeSingle();
    if (error) {
      return {
        ok: false,
        marker: REQUIRED_MARKER,
        error: /app_schema_markers/.test(error.message)
          ? 'The ticketing migration has not been run: supabase/migrations/20261028_ticketing_integrity.sql'
          : error.message,
      };
    }
    if (!data) {
      return {
        ok: false,
        marker: REQUIRED_MARKER,
        error: 'The ticketing migration has not been run: supabase/migrations/20261028_ticketing_integrity.sql',
      };
    }
    cached = { ok: true, marker: REQUIRED_MARKER, appliedAt: data.applied_at ?? null };
    return cached;
  } catch (e) {
    return { ok: false, marker: REQUIRED_MARKER, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Test seam: forget what we learned about the schema. */
export function resetSchemaCache(): void {
  cached = null;
}

export const SCHEMA_BEHIND_MESSAGE =
  'Checkout is temporarily unavailable while we finish a scheduled update. Nothing has been charged. Please try again shortly.';
