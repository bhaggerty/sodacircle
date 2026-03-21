"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStore } from "@/lib/store";

export function Nav() {
  const pathname = usePathname();
  const { shortlist, statuses, approvedCount, replies } = useStore();

  // Candidates needing a decision (new + good/potential tier)
  const unreviewed = shortlist.filter(
    (c) => (!statuses[c.id] || statuses[c.id] === "new") && c.matchTier !== "no-match"
  ).length;

  // Approved candidates waiting in outreach queue
  const outreachPending = Object.values(statuses).filter((s) => s === "approved").length;

  // Unclassified replies
  const repliesPending = replies.filter((r) => !r.classification || r.classification === "interested").length;

  const navItems = [
    { href: "/",           label: "Dashboard", icon: iconDash },
    { href: "/search",     label: "Search",    icon: iconSearch },
    { href: "/candidates", label: "Candidates",icon: iconPerson, badge: unreviewed > 0 ? unreviewed : null },
    { href: "/outreach",   label: "Outreach",  icon: iconMail,   badge: outreachPending > 0 ? outreachPending : null },
    { href: "/replies",    label: "Replies",   icon: iconChat,   badge: repliesPending > 0 ? repliesPending : null },
    { href: "/agents",     label: "Agents",    icon: iconAgent,  pulse: true },
    { href: "/profiles",   label: "Profiles",  icon: iconDb },
  ];

  return (
    <aside className="nav-sidebar">
      <Link href="/" className="nav-logo">
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
          <circle cx="14" cy="14" r="12" fill="#1d6b52" />
          <circle cx="14" cy="14" r="7" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" />
          <circle cx="14" cy="14" r="3" fill="rgba(255,255,255,0.9)" />
          <circle cx="14" cy="5" r="1.5" fill="rgba(255,255,255,0.45)" />
          <circle cx="20" cy="8" r="1" fill="rgba(255,255,255,0.3)" />
          <circle cx="8" cy="8" r="1" fill="rgba(255,255,255,0.3)" />
        </svg>
        <span className="nav-logo-text">sodacircle</span>
      </Link>

      <nav className="nav-list">
        {navItems.map(({ href, label, icon, badge, pulse }) => {
          const active = pathname === href || (href !== "/" && pathname.startsWith(href));
          return (
            <Link key={href} href={href} className={`nav-item${active ? " nav-item-active" : ""}`}>
              <span className="nav-item-icon">{icon}</span>
              <span className="nav-item-label">{label}</span>
              {badge != null && <span className="nav-badge">{badge > 99 ? "99+" : badge}</span>}
              {pulse && <span className="agent-pulse-dot" />}
            </Link>
          );
        })}
      </nav>

      <div className="nav-footer">
        {shortlist.length > 0 ? (
          <>
            <div className="nav-agent-status">
              <span className="running-dot" />
              <span>{shortlist.length} candidates in pool</span>
            </div>
            <p className="nav-footer-hint">{approvedCount} approved · {unreviewed} to review</p>
          </>
        ) : (
          <>
            <div className="nav-agent-status">
              <span style={{ opacity: 0.4 }}>○</span>
              <span>No candidates yet</span>
            </div>
            <p className="nav-footer-hint">Run an agent to start sourcing</p>
          </>
        )}
      </div>
    </aside>
  );
}

const iconDash = (
  <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
    <rect x="1" y="1" width="6" height="6" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <rect x="10" y="1" width="6" height="6" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <rect x="1" y="10" width="6" height="6" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <rect x="10" y="10" width="6" height="6" rx="2" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

const iconSearch = (
  <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
    <circle cx="7.5" cy="7.5" r="5" stroke="currentColor" strokeWidth="1.5" />
    <path d="M11.5 11.5L15 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const iconPerson = (
  <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
    <circle cx="8.5" cy="5" r="3" stroke="currentColor" strokeWidth="1.5" />
    <path d="M2 15c0-3.314 2.91-6 6.5-6s6.5 2.686 6.5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const iconMail = (
  <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
    <path d="M2 3h13l-6.5 6L2 3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M2 3v10a1 1 0 001 1h11a1 1 0 001-1V3" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

const iconChat = (
  <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
    <path d="M14 2H3a1 1 0 00-1 1v8a1 1 0 001 1h3l2.5 3L11 12h3a1 1 0 001-1V3a1 1 0 00-1-1z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
);

const iconDb = (
  <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
    <ellipse cx="8.5" cy="4" rx="5.5" ry="2" stroke="currentColor" strokeWidth="1.5" />
    <path d="M3 4v9c0 1.105 2.462 2 5.5 2S14 14.105 14 13V4" stroke="currentColor" strokeWidth="1.5" />
    <path d="M3 8.5c0 1.105 2.462 2 5.5 2S14 9.605 14 8.5" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

const iconAgent = (
  <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
    <circle cx="8.5" cy="8.5" r="6.5" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="6" cy="7.5" r="1" fill="currentColor" />
    <circle cx="11" cy="7.5" r="1" fill="currentColor" />
    <path d="M6 11s.8 1.5 2.5 1.5S11 11 11 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
