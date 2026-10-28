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

  it('counts a group pass as the people it admits, not as one', () => {
    const a = bookingAttendance([pass({ groupSize: 5 })]);
    expect(a).toMatchObject({ passes: 1, people: 5, admitted: 0, remaining: 5 });
  });

  it('follows a group pass admitted in parts', () => {
    const a = bookingAttendance([pass({ groupSize: 5, admitted: 2 })]);
    expect(a).toMatchObject({ passes: 1, people: 5, admitted: 2, remaining: 3, passesScanned: 0, state: 'PARTLY_IN' });
  });

  it('a fully used group pass counts as scanned', () => {
    const a = bookingAttendance([pass({ groupSize: 5, status: 'CHECKED_IN' })]);
    expect(a).toMatchObject({ people: 5, admitted: 5, remaining: 0, passesScanned: 1, state: 'ALL_IN' });
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
    { tickets_data: [pass({ ticketNumber: 'GEN-003', groupSize: 5, admitted: 2 })] },
    { tickets_data: [pass({ ticketNumber: 'GEN-004' })] },
    { tickets_data: [pass({ ticketNumber: 'GEN-005' })], status: 'REFUNDED' },
  ];

  it('adds up people rather than passes', () => {
    const a = eventAttendance(bookings);
    //  2 singles + a group of 5 + 1 single = 8 expected; 2 + 2 in = 4
    expect(a).toMatchObject({ passes: 4, people: 8, admitted: 4, remaining: 4 });
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
