'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/', label: 'Home', icon: 'H' },
  { href: '/listen', label: 'Listen', icon: 'L' },
  { href: '/piano', label: 'Piano', icon: 'P' },
  { href: '/train', label: 'Train', icon: 'T' },
  { href: '/metronome', label: 'Metro', icon: 'M' },
  { href: '/progress', label: 'Stats', icon: 'S' },
];

export default function NavBar() {
  const pathname = usePathname();

  return (
    <nav className="nav-bar fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around safe-area-bottom"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 8px)' }}
    >
      {NAV_ITEMS.map(item => {
        const active = item.href === '/'
          ? pathname === '/'
          : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`nav-item ${active ? 'active' : ''}`}
          >
            <span className="text-sm" style={{ fontFamily: 'var(--font-pixel)' }}>{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
