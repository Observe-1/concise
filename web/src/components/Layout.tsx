import { NavLink, Outlet } from 'react-router-dom';

const navItems = [
  { to: '/', label: 'Home', icon: HomeIcon },
  { to: '/assets', label: 'Assets', icon: CoinsIcon },
  { to: '/liabilities', label: 'Debts', icon: ScaleIcon },
  { to: '/recurring', label: 'Recurring', icon: RepeatIcon },
  { to: '/settings', label: 'Settings', icon: GearIcon },
];

// Mobile bottom bar: Home sits centred among the five icons (and renders
// slightly larger). Desktop rail keeps the conventional Home-first order.
const mobileNavItems = [navItems[1]!, navItems[2]!, navItems[0]!, navItems[3]!, navItems[4]!];

export function Layout() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col md:flex-row">
      {/* Desktop rail */}
      <nav aria-label="Primary" className="hidden md:flex md:w-52 md:flex-col md:gap-1 md:border-r md:border-ink-800 md:p-4">
        <p className="mb-6 px-3 pt-2 text-lg font-semibold tracking-wide text-gold-500">Concise</p>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                isActive ? 'bg-ink-800 text-gold-400' : 'text-ink-300 hover:text-ink-100'
              }`
            }
          >
            <item.icon />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <main className="flex-1 px-4 pb-24 pt-5 md:px-8 md:pb-8">
        <Outlet />
      </main>

      {/* Mobile bottom tab bar */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-800 bg-ink-950/95 backdrop-blur md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto grid max-w-md grid-cols-5">
          {mobileNavItems.map((item) => {
            const isHome = item.to === '/';
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={isHome}
                className={({ isActive }) =>
                  `flex flex-col items-center justify-end gap-1 px-1 py-2.5 text-[10px] ${
                    isActive ? 'text-gold-400' : 'text-ink-400'
                  }`
                }
              >
                <item.icon size={isHome ? 26 : 20} />
                {item.label}
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

interface IconProps {
  size?: number;
}

function HomeIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3 9.5L10 3l7 6.5V17a1 1 0 01-1 1h-4v-5H8v5H4a1 1 0 01-1-1V9.5z"
        stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function CoinsIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <ellipse cx="10" cy="5.5" rx="6" ry="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 5.5v9c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5v-9M4 10c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5"
        stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function ScaleIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 3v14M5 6l-2.5 5a3 3 0 005 0L5 6zm10 0l-2.5 5a3 3 0 005 0L15 6zM6 17h8M5 6h10"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RepeatIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4 8a6 6 0 0110.5-4M16 12a6 6 0 01-10.5 4M14 4h2.5V1.5M6 16H3.5v2.5"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GearIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 2.5l1 2.2 2.4-.5 1 1.7-1.6 1.8.7 2.3 2.3.7-.3 2-2.4.3-1 2.2-2.1-.6-2.1.6-1-2.2-2.4-.3-.3-2 2.3-.7.7-2.3L5.6 5.9l1-1.7 2.4.5 1-2.2z"
        stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}
