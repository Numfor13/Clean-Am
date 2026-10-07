"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { site } from "@/lib/site";
import { useSession } from "./Providers";
import { LangSwitch } from "./forms";
import { ArrowLeft, ArrowRight, Camera, Close, Facebook, Instagram, Mail, MapPin, Menu, Phone, XTwitter, Youtube, ChevronDown } from "./icons";
import { Logo } from "./ui";
import { homeFor } from "@/lib/jwt";

/** Dark header for public pages: full nav on desktop, a drawer on phones. */
export function PublicHeader({ minimal }: { minimal?: boolean }) {
  const { t } = useT();
  const session = useSession();
  const pathname = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  const signedIn = Boolean(session.role);
  const isAccountArea = pathname.startsWith("/home") || pathname.startsWith("/my-reports") || pathname.startsWith("/profile");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const isSelfContained = pathname === "/" || pathname === "/home" || pathname === "/guest";
  const prefix = isSelfContained ? "" : (isAccountArea ? "/home" : "/");

  const links = isAccountArea
    ? [
        { href: `${prefix}#services`, label: t("nav.services") },
        { href: `${prefix}#how`, label: t("nav.reportGuide") },
      ]
    : [
        { href: `${prefix}#services`, label: t("nav.services") },
        { href: `${prefix}#how`, label: t("nav.reportGuide") },
        { href: `${prefix}#about`, label: t("nav.about") },
        { href: `${prefix}#contact`, label: t("nav.contact") },
      ];

  return (
    <header className="public-header">
      <div className="public-header__inner">
        {isAccountArea ? (
          <Link
            href="/"
            className="icon-btn topbar__back"
            aria-label={t("common.back") || "Back to landing page"}
            title="Back to landing page"
          >
            <ArrowLeft aria-hidden="true" />
          </Link>
        ) : null}
        <Logo sub={t("brand.sub")} href={isAccountArea ? "/home" : "/"} />
        {!minimal ? (
          <nav className="public-nav desktop-only" aria-label={t("nav.main")}>
            {links.map((l) => (
              <Link key={l.href} href={l.href}>
                {l.label}
              </Link>
            ))}
          </nav>
        ) : null}
        <div className="public-header__end">
          <span className="desktop-only">
            <LangSwitch />
          </span>
          {!isAccountArea ? (
            signedIn ? (
              <Link href={homeFor(session.role)} className="topbar__link">
                {t("nav.myAccount")}
              </Link>
            ) : (
              <Link href="/login" className="topbar__link">
                {t("nav.signIn")}
              </Link>
            )
          ) : null}
          <Link href="/report" className="btn btn--primary btn--sm desktop-only">
            {t("nav.submitReport")}
            <ArrowRight aria-hidden="true" />
          </Link>
          <button type="button" className="icon-btn mobile-only" aria-label={t("nav.menu")} aria-expanded={open} onClick={() => setOpen(true)}>
            <Menu aria-hidden="true" />
          </button>
        </div>
      </div>

      {open ? (
        <div className="drawer" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="drawer__panel" role="dialog" aria-modal="true" aria-label={t("nav.menu")}>
            <div className="drawer__head">
              <LangSwitch />
              <button type="button" className="icon-btn" aria-label={t("common.close")} onClick={() => setOpen(false)} autoFocus>
                <Close aria-hidden="true" />
              </button>
            </div>
            {links.map((l) => (
              <Link key={l.href} href={l.href} onClick={() => setOpen(false)}>
                {l.label}
              </Link>
            ))}
            {!isAccountArea ? (
              signedIn ? (
                <Link key="account" href={homeFor(session.role)} onClick={() => setOpen(false)}>
                  {t("nav.myAccount")}
                </Link>
              ) : (
                <Link key="login" href="/login" onClick={() => setOpen(false)}>
                  {t("nav.signIn")}
                </Link>
              )
            ) : null}
            <Link href="/report" className="btn btn--primary btn--lg" style={{ marginTop: "auto" }} onClick={() => setOpen(false)}>
              <Camera aria-hidden="true" />
              {t("nav.submitReport")}
            </Link>
          </div>
        </div>
      ) : null}
    </header>
  );
}

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <details className="footer-acc mobile-only">
        <summary>
          {title}
          <ChevronDown aria-hidden="true" />
        </summary>
        <div className="footer-links">{children}</div>
      </details>
      <div className="footer-col desktop-only">
        <h2>{title}</h2>
        <div className="footer-links">{children}</div>
      </div>
    </>
  );
}

export function PublicFooter({ compact }: { compact?: boolean }) {
  const { t } = useT();
  const year = new Date().getFullYear();
  return (
    <footer className="public-footer on-deep" id="contact">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-brand">
            <Logo sub={t("brand.sub")} />
            <p>{t("brand.tagline")}</p>
            <div className="socials">
              <a href={site.social.facebook} aria-label="Facebook" rel="noopener noreferrer" target="_blank">
                <Facebook />
              </a>
              <a href={site.social.instagram} aria-label="Instagram" rel="noopener noreferrer" target="_blank">
                <Instagram />
              </a>
              <a href={site.social.x} aria-label="X" rel="noopener noreferrer" target="_blank">
                <XTwitter />
              </a>
              <a href={site.social.youtube} aria-label="YouTube" rel="noopener noreferrer" target="_blank">
                <Youtube />
              </a>
            </div>
          </div>
          {!compact ? (
            <>
              <FooterColumn title={t("footer.quickLinks")}>
                <Link href="/">{t("nav.home")}</Link>
                <Link href="/#services">{t("nav.services")}</Link>
                <Link href="/#how">{t("nav.reportGuide")}</Link>
                <Link href="/#about">{t("nav.about")}</Link>
                <Link href="/login">{t("nav.signIn")}</Link>
              </FooterColumn>
              <FooterColumn title={t("footer.ourServices")}>
                <Link href="/report">{t("service.reporting.title")}</Link>
                <Link href="/my-reports">{t("service.tracking.title")}</Link>
                <span>{t("service.recycling.title")}</span>
                <span>{t("service.pickup.title")}</span>
              </FooterColumn>
              <FooterColumn title={t("footer.getInTouch")}>
                <a href={site.phoneHref}>
                  <Phone aria-hidden="true" /> {site.phone}
                </a>
                <a href={`mailto:${site.email}`}>
                  <Mail aria-hidden="true" /> {site.email}
                </a>
                <span>
                  <MapPin aria-hidden="true" /> {site.city}
                </span>
              </FooterColumn>
            </>
          ) : null}
        </div>
        {!compact ? <p className="footer-copy">© {year} CLEAN-AM. {t("footer.rights")}</p> : null}
      </div>
    </footer>
  );
}
