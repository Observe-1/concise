import { z } from 'zod';

/** 10^15 minor units — far below Number.MAX_SAFE_INTEGER. */
export const MAX_MINOR = 1_000_000_000_000_000;

export const valueMinorSchema = z.number().int().min(0).max(MAX_MINOR);

export const dateStringSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'Invalid date')
  .refine((s) => s >= '1900-01-01', 'Date too far in the past');
