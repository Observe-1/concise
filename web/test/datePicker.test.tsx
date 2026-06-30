import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DatePicker } from '../src/components/DatePicker.js';

/** Mirrors the component's day-button aria-label so assertions are locale-agnostic. */
const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric',
  });

describe('DatePicker', () => {
  it('passes typed input straight through (drop-in for a text date field)', () => {
    const onChange = vi.fn();
    render(<DatePicker value="" onChange={onChange} aria-label="Pick a date" />);
    fireEvent.change(screen.getByLabelText('Pick a date'), { target: { value: '2026-07-01' } });
    expect(onChange).toHaveBeenCalledWith('2026-07-01');
  });

  it('opens a calendar and emits the ISO date for the clicked day', async () => {
    const onChange = vi.fn();
    render(<DatePicker value="2026-07-15" onChange={onChange} aria-label="Pick a date" />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /choose date from calendar/i }));
    const dialog = screen.getByRole('dialog', { name: /choose a date/i });
    expect(within(dialog).getByText('July 2026')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: dayLabel('2026-07-01') }));
    expect(onChange).toHaveBeenCalledWith('2026-07-01');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); // closes on select
  });

  it('jumps to a distant year via the year picker without month-by-month paging', async () => {
    const onChange = vi.fn();
    render(<DatePicker value="2026-07-15" onChange={onChange} aria-label="d" />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /choose date from calendar/i }));
    // Open the year grid from the month/year header.
    await user.click(screen.getByRole('button', { name: /july 2026 — pick a year/i }));
    // Page back two decades (2021–2032 → 2009–2020 → 1997–2008), then pick 1998.
    await user.click(screen.getByRole('button', { name: /earlier years/i }));
    await user.click(screen.getByRole('button', { name: /earlier years/i }));
    await user.click(screen.getByRole('button', { name: '1998' }));

    // Back in the day grid, now on the chosen year.
    expect(screen.getByRole('button', { name: /july 1998 — pick a year/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: dayLabel('1998-07-10') }));
    expect(onChange).toHaveBeenCalledWith('1998-07-10');
  });

  it('disables days outside the min/max range', async () => {
    render(<DatePicker value="2026-07-15" min="2026-07-10" max="2026-07-20" onChange={vi.fn()} aria-label="d" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /choose date from calendar/i }));
    expect(screen.getByRole('button', { name: dayLabel('2026-07-05') })).toBeDisabled();
    expect(screen.getByRole('button', { name: dayLabel('2026-07-15') })).toBeEnabled();
  });
});
