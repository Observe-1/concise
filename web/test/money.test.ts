import { describe, expect, it } from 'vitest';
import {
  formatMinor, formatMinorCompact, minorToInput, parseSignedToMinor, parseToMinor,
} from '../src/lib/money.js';

describe('parseToMinor', () => {
  it('parses plain and formatted amounts', () => {
    expect(parseToMinor('1250')).toBe(125000);
    expect(parseToMinor('1250.5')).toBe(125050);
    expect(parseToMinor('1,250.55')).toBe(125055);
    expect(parseToMinor(' $1 250.55 ')).toBe(125055);
    expect(parseToMinor('0')).toBe(0);
  });

  it('rejects invalid input', () => {
    expect(parseToMinor('')).toBeNull();
    expect(parseToMinor('abc')).toBeNull();
    expect(parseToMinor('-50')).toBeNull();
    expect(parseToMinor('1.999')).toBeNull();
    expect(parseToMinor('1.2.3')).toBeNull();
  });
});

describe('parseSignedToMinor', () => {
  it('parses negative and positive amounts', () => {
    expect(parseSignedToMinor('-4000')).toBe(-400000);
    expect(parseSignedToMinor('- 4,000.50')).toBe(-400050);
    expect(parseSignedToMinor('25000')).toBe(2500000);
    expect(parseSignedToMinor('abc')).toBeNull();
    expect(parseSignedToMinor('--5')).toBeNull();
  });
});

describe('formatMinor', () => {
  it('formats minor units as currency', () => {
    expect(formatMinor(125055, 'USD')).toMatch(/1,?250\.55/);
    expect(formatMinor(-9900, 'USD')).toMatch(/99\.00/);
  });

  it('compact-formats large values', () => {
    expect(formatMinorCompact(123_456_789, 'USD')).toMatch(/1\.2\s?M/i);
  });
});

describe('minorToInput', () => {
  it('round-trips with parseToMinor', () => {
    expect(minorToInput(125055)).toBe('1250.55');
    expect(parseToMinor(minorToInput(99))).toBe(99);
  });
});
