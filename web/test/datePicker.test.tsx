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

  it('disables days outside the min/max range', async () => {
    render(<DatePicker value="2026-07-15" min="2026-07-10" max="2026-07-20" onChange={vi.fn()} aria-label="d" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /choose date from calendar/i }));
    expect(screen.getByRole('button', { name: dayLabel('2026-07-05') })).toBeDisabled();
    expect(screen.getByRole('button', { name: dayLabel('2026-07-15') })).toBeEnabled();
  });
});
