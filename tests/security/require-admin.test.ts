import { beforeEach, describe, expect, it, vi } from 'vitest';

let sessionUser: { id: string; email: string } | null = null;
let adminEmails: string[] = [];

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: sessionUser } }) },
    from: () => ({
      select: () => ({
        ilike: (_col: string, email: string) => ({
          maybeSingle: async () => ({ data: adminEmails.some((a) => a.toLowerCase() === email.toLowerCase()) ? { email } : null }),
        }),
      }),
    }),
  }),
}));

import { requireAdmin } from '@/lib/admin';

describe('requireAdmin', () => {
  beforeEach(() => {
    sessionUser = null;
    adminEmails = ['boss@punerimallus.com'];
  });

  it('401 when nobody is logged in', async () => {
    const res = await requireAdmin();
    expect(res?.status).toBe(401);
  });

  it('403 when logged in but not an admin', async () => {
    sessionUser = { id: 'u1', email: 'customer@example.com' };
    const res = await requireAdmin();
    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ error: 'Admin access required.' });
  });

  it('lets an admin through (null), matching the email case-insensitively', async () => {
    sessionUser = { id: 'u2', email: 'Boss@PuneriMallus.com' };
    expect(await requireAdmin()).toBeNull();
  });

  it('a phone-login placeholder account is never an admin', async () => {
    sessionUser = { id: 'u3', email: '919876543210@punerimallus.com' };
    expect((await requireAdmin())?.status).toBe(403);
  });
});
