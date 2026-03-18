"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  {
    href: "/",
    label: "Dashboard",
    icon: (
      <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
        <rect x="1" y="1" width="6" height="6" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <rect x="10" y="1" width="6" height="6" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <rect x="1" y="10" width="6" height="6" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <rect x="10" y="10" width="6" height="6" rx="2" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    href: "/search",
    label: "Search",
    icon: (
      <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
        <circle cx="7.5" cy="7.5" r="5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M11.5 11.5L15 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/candidates",
    label: "Candidates",
    icon: (
      <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
        <circle cx="8.5" cy="5" r="3" stroke="currentColor" strokeWidth="1.5" />
        <path d="M2 15c0-3.314 2.91-6 6.5-6s6.5 2.686 6.5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/outreach",
    label: "Outreach",
    icon: (
      <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
        <path d="M2 3h13l-6.5 6L2 3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M2 3v10a1 1 0 001 1h11a1 1 0 001-1V3" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    href: "/replies",
    label: "Replies",
    icon: (
      <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
        <path d="M14 2H3a1 1 0 00-1 1v8a1 1 0 001 1h3l2.5 3L11 12h3a1 1 0 001-1V3a1 1 0 00-1-1z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/agents",
    label: "Agents",
    icon: (
      <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
        <circle cx="8.5" cy="8.5" r="6.5" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="6" cy="7.5" r="1" fill="currentColor" />
        <circle cx="11" cy="7.5" r="1" fill="currentColor" />
        <path d="M6 11s.8 1.5 2.5 1.5S11 11 11 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <aside className="nav-sidebar">
      <div className="nav-logo">
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
          <circle cx="14" cy="14" r="12" fill="#1d6b52" />
          <circle cx="14" cy="14" r="7" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" />
          <circle cx="14" cy="14" r="3" fill="rgba(255,255,255,0.9)" />
          <circle cx="14" cy="5" r="1.5" fill="rgba(255,255,255,0.45)" />
          <circle cx="20" cy="8" r="1" fill="rgba(255,255,255,0.3)" />
          <circle cx="8" cy="8" r="1" fill="rgba(255,255,255,0.3)" />
        </svg>
        <span className="nav-logo-text">sodacircle</span>
      </div>

      <nav className="nav-list">
        {navItems.map(({ href, label, icon }) => {
          const active = pathname === href;
          return (
            <Link key={href} href={href} className={`nav-item${active ? " nav-item-active" : ""}`}>
              <span className="nav-item-icon">{icon}</span>
              <span className="nav-item-label">{label}</span>
              {href === "/agents" && <span className="agent-pulse-dot" />}
            </Link>
          );
        })}
      </nav>

      <div className="nav-footer">
        <div className="nav-agent-status">
          <span className="running-dot" />
          <span>1 agent running</span>
        </div>
        <p className="nav-footer-hint">Sourcing · active</p>
      </div>
    </aside>
  );
}
