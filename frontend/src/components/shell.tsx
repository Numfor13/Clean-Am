"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { authCall } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { initials } from "@/lib/format";
import type { Role } from "@/lib/types";
import {
  ArrowLeft,
  Camera,
  CheckCircle,
  ChevronDown,
  ClipboardList,
  Close,
  Download,
  FileText,
  Flag,
  Globe,
  House,
  LogOut,
  Menu,
  ShieldCheck,
  User,
  Users,
  AlertCircle,
} from "./icons";
import { LangSwitch } from "./forms";
import { useInstall } from "./pwa";
import { Logo } from "./ui";

// ---------------------------------------------------------------------------
// Mobile top bar
// ---------------------------------------------------------------------------
export function TopBar({
  title,
  back,
  end,
  logo,
  centerLogo,
  wide,
  small,
}: {
  title?: string;
  /** true = browser back; a string = that path. */
  back?: boolean | string;
  end?: React.ReactNode;
  logo?: boolean;
  centerLogo?: boolean;
  wide?: boolean;
  small?: boolean;
}) {
  const router = useRouter();
  const { t } = useT();
  return (
    <header className={`topbar on-deep${wide ? " topbar--wide" : ""}`}>
      <div className="topbar__inner" style={centerLogo ? { justifyContent: "center" } : undefined}>
        {back ? (
          typeof back === "string" ? (
            <Link href={back} className="icon-btn topbar__back" aria-label={t("common.back")}>
              <ArrowLeft aria-hidden="true" />
            </Link>
          ) : (
            <button type="button" className="icon-btn topbar__back" aria-label={t("common.back")} onClick={() => router.back()}>
              <ArrowLeft aria-hidden="true" />
            </button>
          )
        ) : null}
        {logo || centerLogo ? <Logo size={34} /> : null}
        {title ? <h1 className={`topbar__title${small ? " topbar__title--sm" : ""} truncate`}>{title}</h1> : null}
        {end ? <div className="topbar__end">{end}</div> : null}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Citizen bottom tabs
// ---------------------------------------------------------------------------
export function TabBar() {
  const pathname = usePathname() ?? "";
  const { t } = useT();
  const tabs = [
    { href: "/home", label: t("tab.home"), icon: House },
    { href: "/report", label: t("tab.report"), icon: Camera },
    { href: "/my-reports", label: t("tab.myReports"), icon: FileText },
    { href: "/profile", label: t("tab.profile"), icon: User },
  ];
  return (
    <nav className="tabbar" aria-label={t("tab.label")}>
      <div className="tabbar__inner">
        {tabs.map(({ href, label, icon: Icon }) => {
          const current = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link key={href} href={href} className="tab" aria-current={current ? "page" : undefined}>
              {current ? (
                <span className="tab__raise">
                  <Icon aria-hidden="true" />
                </span>
              ) : (
                <Icon aria-hidden="true" />
              )}
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Dialog: bottom sheet on phones, centred modal on desktop
// ---------------------------------------------------------------------------
export function Dialog({
  open,
  onClose,
  labelledBy,
  width,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  width?: number;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const { t } = useT();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = panel.current;
    const focusable = () =>
      Array.from(
        node?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? [],
      ).filter((el) => !el.hasAttribute("disabled"));
    focusable()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const items = focusable();
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          last.focus();
          e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === last) {
          first.focus();
          e.preventDefault();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        style={width ? ({ "--dialog-w": `${width}px` } as React.CSSProperties) : undefined}
      >
        <div className="dialog__grip" aria-hidden="true" />
        <button type="button" className="icon-btn dialog__close" onClick={onClose} aria-label={t("common.close")}>
          <Close aria-hidden="true" />
        </button>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
interface ToastItem {
  id: number;
  text: string;
  kind: "success" | "error";
}

const ToastContext = createContext<(text: string, kind?: "success" | "error") => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const { t } = useT();
  const push = useCallback((text: string, kind: "success" | "error" = "success") => {
    const id = Date.now() + Math.random();
    setItems((list) => [...list, { id, text, kind }]);
    setTimeout(() => setItems((list) => list.filter((i) => i.id !== id)), 6000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-region" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`toast${item.kind === "error" ? " toast--error" : ""}`} role="status">
            <span className="icon-disc" aria-hidden="true">
              {item.kind === "error" ? <AlertCircle /> : <CheckCircle />}
            </span>
            <span className="grow">{item.text}</span>
            <button
              type="button"
              className="icon-btn"
              aria-label={t("common.dismiss")}
              onClick={() => setItems((list) => list.filter((i) => i.id !== item.id))}
            >
              <Close aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// ---------------------------------------------------------------------------
// Signing out
// ---------------------------------------------------------------------------
export function useSignOut() {
  return useCallback(async () => {
    try {
      await authCall("sign-out");
    } finally {
      window.location.assign("/");
    }
  }, []);
}

// ---------------------------------------------------------------------------
// Staff and admin workspace frame
// ---------------------------------------------------------------------------
export function StaffShell({
  role,
  username,
  children,
}: {
  role: Role;
  username: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const { t } = useT();
  const signOut = useSignOut();
  const toast = useToast();
  const { offer, install } = useInstall();
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  useEffect(() => setDrawerOpen(false), [pathname]);

  const links =
    role === "Admin"
      ? [
          { href: "/admin/employees", label: t("nav.employees"), icon: Users },
          { href: "/admin/flagged", label: t("nav.flaggedCitizens"), icon: Flag },
          { href: "/staff/reports", label: t("nav.reports"), icon: ClipboardList },
        ]
      : [{ href: "/staff/reports", label: t("nav.reports"), icon: ClipboardList }];

  const isCurrent = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  // A report's own screen brings its own phone top bar (back + reference).
  const ownMobileBar = /^\/staff\/reports\/[^/]+$/.test(pathname);
  const name = username ?? (role === "Admin" ? "Admin" : t("nav.staff"));
  // iPhone has no install prompt: say where to find "Add to Home Screen".
  const installApp = () => (offer === "ios" ? toast(t("install.iosHint")) : install());

  return (
    <>
      <header className="staff-header on-deep desktop-only">
        <div className="staff-header__inner">
          <Logo sub={t("nav.councilWorkspace")} href={links[0].href} />
          <nav className="staff-nav" aria-label={t("nav.workspace")}>
            {links.map((l) => (
              <Link key={l.href} href={l.href} aria-current={isCurrent(l.href) ? "page" : undefined}>
                {l.label}
              </Link>
            ))}
          </nav>
          <LangSwitch />
          <div className="user-menu" ref={menuRef}>
            <button type="button" aria-expanded={menuOpen} aria-haspopup="menu" onClick={() => setMenuOpen((o) => !o)}>
              <span className="avatar">{initials(name)}</span>
              <span>
                {name} · {role === "Admin" ? t("nav.admin") : t("nav.staff")}
              </span>
              <ChevronDown aria-hidden="true" size={20} />
            </button>
            {menuOpen ? (
              <div className="user-menu__list" role="menu">
                <Link href="/staff/security" role="menuitem" onClick={() => setMenuOpen(false)}>
                  <ShieldCheck aria-hidden="true" />
                  {t("nav.security")}
                </Link>
                {offer ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      installApp();
                    }}
                  >
                    <Download aria-hidden="true" />
                    {t("install.cta")}
                  </button>
                ) : null}
                <button type="button" role="menuitem" onClick={signOut}>
                  <LogOut aria-hidden="true" />
                  {t("common.signOut")}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {ownMobileBar ? null : (
      <header className="topbar on-deep mobile-only">
        <div className="topbar__inner" style={{ maxWidth: "none" }}>
          <Logo size={34} href={links[0].href} />
          <div className="topbar__end">
            <span className="staff-pill">
              <User aria-hidden="true" />
              {role === "Admin" ? t("nav.admin") : t("nav.staff")}
            </span>
            <button type="button" className="icon-btn" aria-label={t("nav.menu")} aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}>
              <Menu aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>
      )}

      {drawerOpen ? (
        <div className="drawer" onMouseDown={(e) => e.target === e.currentTarget && setDrawerOpen(false)}>
          <div className="drawer__panel on-deep" role="dialog" aria-modal="true" aria-label={t("nav.menu")}>
            <div className="row-between" style={{ marginBottom: 8 }}>
              <span className="strong" style={{ color: "#fff" }}>
                {name}
              </span>
              <button type="button" className="icon-btn" aria-label={t("common.close")} onClick={() => setDrawerOpen(false)}>
                <Close aria-hidden="true" />
              </button>
            </div>
            {links.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} aria-current={isCurrent(href) ? "page" : undefined}>
                <Icon aria-hidden="true" />
                {label}
              </Link>
            ))}
            <Link href="/staff/security" aria-current={isCurrent("/staff/security") ? "page" : undefined}>
              <ShieldCheck aria-hidden="true" />
              {t("nav.security")}
            </Link>
            {offer ? (
              <button type="button" className="drawer__item" onClick={installApp}>
                <Download aria-hidden="true" />
                {t("install.cta")}
              </button>
            ) : null}
            <div className="drawer__item" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" }}>
              <Globe aria-hidden="true" />
              <LangSwitch />
            </div>
            <button type="button" className="drawer__item" onClick={signOut} style={{ marginTop: "auto" }}>
              <LogOut aria-hidden="true" />
              {t("common.signOut")}
            </button>
          </div>
        </div>
      ) : null}

      <main id="main" className="staff-main">
        {children}
      </main>
    </>
  );
}
