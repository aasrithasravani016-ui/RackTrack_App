import { NavLink } from 'react-router-dom';
import styles from './BottomNav.module.css';

const IconHome = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/>
    <path d="M9 21V12h6v9"/>
  </svg>
);
const IconScan = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
    <circle cx="12" cy="13" r="4"/>
  </svg>
);
const IconHistory = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="1 4 1 10 7 10"/>
    <path d="M3.51 15a9 9 0 102.13-9.36L1 10"/>
    <polyline points="12 7 12 12 16 14"/>
  </svg>
);

const NAV_ITEMS = [
  { to: '/', end: true, icon: <IconHome />, label: 'Home' },
  { to: '/scan', icon: <IconScan />, label: 'Scan' },
  { to: '/history', icon: <IconHistory />, label: 'History' },
];

export default function BottomNav() {
  return (
    <nav className={styles.nav}>
      <div className={styles.bar}>
        {NAV_ITEMS.map(({ to, end, icon, label }) => (
          <NavLink key={to} to={to} end={end}
            className={({ isActive }) => `${styles.item} ${isActive ? styles.active : ''}`}>
            <div className={styles.iconWrap}>{icon}</div>
            <span className={styles.label}>{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
