import {
  useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes,
  type ReactNode, type SelectHTMLAttributes,
} from 'react';

// ---------- buttons ----------

type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'subtle';

const buttonStyles: Record<ButtonVariant, string> = {
  primary: 'bg-gold-500 text-ink-950 font-semibold hover:bg-gold-400 active:bg-gold-600 disabled:opacity-50',
  ghost: 'border border-ink-700 text-ink-100 hover:border-gold-500 hover:text-gold-400 disabled:opacity-50',
  subtle: 'text-ink-300 hover:text-gold-400 disabled:opacity-50',
  danger: 'border border-loss-500/40 text-loss-400 hover:bg-loss-500/10 disabled:opacity-50',
};

export function Button({
  variant = 'primary', className = '', ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type={props.type ?? 'button'}
      className={`rounded-xl px-4 py-2.5 text-sm transition-colors min-h-11 ${buttonStyles[variant]} ${className}`}
      {...props}
    />
  );
}

// ---------- form fields ----------

export function Field({
  label, children, hint,
}: { label: string; children: (id: string) => ReactNode; hint?: string }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-medium uppercase tracking-wider text-ink-400">
        {label}
      </label>
      {children(id)}
      {hint ? <p className="text-xs text-ink-400">{hint}</p> : null}
    </div>
  );
}

const inputClass =
  'w-full rounded-xl border border-ink-700 bg-ink-900 px-3.5 py-2.5 text-sm text-ink-100 ' +
  'placeholder:text-ink-600 focus:border-gold-500 focus:outline-none min-h-11';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ''}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputClass} appearance-none ${props.className ?? ''}`} />;
}

// ---------- surfaces ----------

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-ink-800 bg-ink-900 ${className}`}>{children}</div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-ink-700 px-6 py-10 text-center">
      <p className="text-sm text-ink-300">{title}</p>
      {hint ? <p className="mt-1 text-xs text-ink-400">{hint}</p> : null}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="flex justify-center py-10">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-ink-700 border-t-gold-500" />
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-xl border border-loss-500/30 bg-loss-500/10 px-3 py-2 text-sm text-loss-400">
      {message}
    </p>
  );
}

// ---------- modal (mobile bottom sheet, centered on desktop) ----------

export function Modal({
  title, onClose, children,
}: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input, select, button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-3xl border border-ink-800 bg-ink-900 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:max-w-md sm:rounded-3xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-2 text-ink-400 hover:text-ink-100"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
