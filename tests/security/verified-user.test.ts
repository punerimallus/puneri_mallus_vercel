import { describe, expect, it, vi } from 'vitest';
import { getVerifiedUser } from '@/lib/admin';

describe('getVerifiedUser (fast login check)', () => {
  it('uses the locally verified token claims when available, without asking the auth server', async () => {
    const getUser = vi.fn();
    const supabase = { auth: { getClaims: async () => ({ data: { claims: { sub: 'u1', email: 'a@b.c', phone: '919876543210' } }, error: null }), getUser } };
    expect(await getVerifiedUser(supabase)).toEqual({ id: 'u1', email: 'a@b.c', phone: '919876543210' });
    expect(getUser).not.toHaveBeenCalled();
  });

  it('treats a missing, invalid or expired token as logged out', async () => {
    expect(await getVerifiedUser({ auth: { getClaims: async () => ({ data: null, error: { message: 'bad jwt' } }) } })).toBeNull();
    expect(await getVerifiedUser({ auth: { getClaims: async () => ({ data: { claims: null }, error: null }) } })).toBeNull();
    expect(await getVerifiedUser({ auth: { getClaims: async () => ({ data: { claims: { email: 'x@y.z' } }, error: null }) } })).toBeNull(); // no subject
  });

  it('falls back to asking the auth server when getClaims is not available', async () => {
    const supabase = { auth: { getUser: async () => ({ data: { user: { id: 'u2', email: 'd@e.f', phone: '' } } }) } };
    expect(await getVerifiedUser(supabase)).toMatchObject({ id: 'u2', email: 'd@e.f' });
    expect(await getVerifiedUser({ auth: { getUser: async () => ({ data: { user: null } }) } })).toBeNull();
  });
});
