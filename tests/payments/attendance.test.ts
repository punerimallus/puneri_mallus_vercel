import { describe, expect, it } from 'vitest';
import { attendancePercent, bookingAttendance, eventAttendance } from '@/lib/payments/attendance';
import { ScanTicket } from '@/lib/payments/scan';

const pass = (over: Partial<ScanTicket> = {}): ScanTicket =>
  ({ categoryName: 'GENERAL', ticketNumber: 'GEN-001', status: 'ISSUED', ...over }) as ScanTicket;

describe('one booking', () => {
  it('nobody has arrived', () => {
    const a = bookingAttendance([pass(), pass({ ticketNumber: 'GEN-002' })]);
    expect(a).toMatchObject({ passes: 2, people: 2, admitted: 0, remaining: 2, passesScanned: 0, state: 'NOT_ARRIVED' });
  });

  it('everyone is in', () => {
    const a = bookingAttendance([pass({ status: 'CHECKED_IN' }), pass({ ticketNumber: 'GEN-002', status: 'CHECKED_IN' })]);
    expect(a).toMatchObject({ admitted: 2, remaining: 0, passesScanned: 2, state: 'ALL_IN' });
  });

  it('some of the party has arrived', () => {
    const a = bookingAttendance([pass({ status: 'CHECKED_IN' }), pass({ ticketNumber: 'GEN-002' })]);
    expect(a).toMatchObject({ people: 2, admitted: 1, remaining: 1, passesScanned: 1, state: 'PARTLY_IN' });
  });

  it('counts one person per pass, however many are on the booking', () => {
    // What a bundle of five looks like at the door: five ordinary passes, five people.
    const five = Array.from({ length: 5 }, (_, i) => pass({ ticketNumber: `GEN-10${i}` }));
    expect(bookingAttendance(five)).toMatchObject({ passes: 5, people: 5, admitted: 0, remaining: 5 });
  });

  it('follows a party arriving in ones and twos', () => {
    const a = bookingAttendance([
      pass({ ticketNumber: 'GEN-101', status: 'CHECKED_IN' }),
      pass({ ticketNumber: 'GEN-102', status: 'CHECKED_IN' }),
      pass({ ticketNumber: 'GEN-103' }),
    ]);
    expect(a).toMatchObject({ passes: 3, people: 3, admitted: 2, remaining: 1, passesScanned: 2, state: 'PARTLY_IN' });
  });

  it('ignores a stale admitted count left by the group model', () => {
    // An old pass could say "2 of 5 in". It is one seat now, and one person.
    const a = bookingAttendance([pass({ admitted: 2 })]);
    expect(a).toMatchObject({ passes: 1, people: 1, admitted: 1, remaining: 0, passesScanned: 1, state: 'ALL_IN' });
  });

  it('a voided pass drops out of the expected head count', () => {
    const a = bookingAttendance([pass({ status: 'REFUNDED' }), pass({ ticketNumber: 'GEN-002' })]);
    expect(a).toMatchObject({ passes: 1, people: 1, refunded: 1, state: 'NOT_ARRIVED' });
  });

  it('a refunded booking is out of the count entirely', () => {
    const a = bookingAttendance([pass(), pass({ ticketNumber: 'GEN-002' })], 'REFUNDED');
    expect(a).toMatchObject({ passes: 0, people: 0, admitted: 0, refunded: 2, state: 'REFUNDED' });
  });

  it('so is a booking whose every pass was voided one by one', () => {
    const a = bookingAttendance([pass({ status: 'REFUNDED' }), pass({ ticketNumber: 'GEN-002', status: 'REFUNDED' })]);
    expect(a.state).toBe('REFUNDED');
  });

  it('copes with nothing at all', () => {
    expect(bookingAttendance(null).state).toBe('NOT_ARRIVED');
    expect(bookingAttendance([]).people).toBe(0);
    expect(bookingAttendance(undefined, 'REFUNDED').state).toBe('REFUNDED');
  });
});

describe('a whole event', () => {
  const bookings = [
    { tickets_data: [pass({ status: 'CHECKED_IN' }), pass({ ticketNumber: 'GEN-002', status: 'CHECKED_IN' })] },
    { tickets_data: [pass({ ticketNumber: 'GEN-003', admitted: 2 })] },
    { tickets_data: [pass({ ticketNumber: 'GEN-004' })] },
    { tickets_data: [pass({ ticketNumber: 'GEN-005' })], status: 'REFUNDED' },
  ];

  it('adds up the live passes across every booking', () => {
    const a = eventAttendance(bookings);
    // Four live passes (the refunded booking drops out); two in, and a third whose stale
    // admitted count from the group model reads as the one person it can now be.
    expect(a).toMatchObject({ passes: 4, people: 4, admitted: 3, remaining: 1 });
  });

  it('counts bookings arrived vs still to come, ignoring refunded ones', () => {
    const a = eventAttendance(bookings);
    expect(a).toMatchObject({ bookings: 3, arrived: 2, notArrived: 1, refunded: 1 });
  });

  it('is empty-safe', () => {
    expect(eventAttendance([]).people).toBe(0);
    expect(eventAttendance(null).bookings).toBe(0);
  });

  it('reports the door percentage', () => {
    expect(attendancePercent({ people: 8, admitted: 4 })).toBe(50);
    expect(attendancePercent({ people: 0, admitted: 0 })).toBe(0);
    expect(attendancePercent({ people: 3, admitted: 1 })).toBe(33);
    expect(attendancePercent({ people: 100, admitted: 100 })).toBe(100);
  });
});
