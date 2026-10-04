"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { formatNumber } from "@/lib/format";
import type { ReportPage } from "@/lib/types";
import { useSession } from "@/components/Providers";
import { PublicFooter, PublicHeader } from "@/components/public";
import { LangSwitch } from "@/components/forms";
import { TabBar, TopBar, useSignOut } from "@/components/shell";
import { ReportCard } from "@/components/reports";
import { InstallCard } from "@/components/pwa";
import { Camera, ChevronRight, Headphones, FileText, Recycle, ShieldAlert, Trash, Truck, UserRound } from "@/components/icons";
import { site } from "@/lib/site";
import { HowItWorks, usePublicStats } from "./Landing";

/** Guest home (no account) and citizen home share one layout. */
export function HomeScreen({ mode }: { mode: "guest" | "citizen" }) {
  const { t, lang } = useT();
  const session = useSession();
  const stats = usePublicStats();
  const [latest, setLatest] = useState<ReportPage["reports"][number] | null>(null);

  useEffect(() => {
    if (mode !== "citizen") return;
    api
      .get<ReportPage>("reports/me", { limit: 1 })
      .then((r) => setLatest(r.reports[0] ?? null))
      .catch(() => setLatest(null));
  }, [mode]);

  const services = [
    { icon: Trash, title: t("service.reporting.title"), body: t("service.reporting.bodyShort"), href: "/report" },
    { icon: Recycle, title: t("service.recycling.title"), body: t("service.recycling.body"), soon: true },
    { icon: Truck, title: t("service.pickup.title"), body: t("service.pickup.body"), soon: true },
  ];

  return (
    <>
      <PublicHeader />
      <main id="main">
        <section className="home-hero on-deep" id="top">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/guest-hero.jpg" alt="" />
          <div className="home-hero__copy">
            <h1 className="home-hero__title">
              {t("home.title1")}
              <br />
              <span className="accent">{t("home.title2")}</span>
            </h1>
            <p className="home-hero__sub">
              {mode === "guest" ? t("home.noAccount") : t("home.hello", { name: session.username ?? "" })}
            </p>
            <Link href="/report" className="btn btn--primary btn--lg">
              <Camera aria-hidden="true" />
              {t("home.cta")}
            </Link>
          </div>
        </section>

        <div className={`m-col m-col--wide${mode === "citizen" ? " m-screen--tabs" : ""}`} style={mode === "citizen" ? { paddingBottom: 110 } : undefined}>
          {mode === "guest" ? (
            <div className="guest-note">
              <span className="icon-disc">
                <UserRound aria-hidden="true" />
              </span>
              <div>
                {session.guestLabel ? (
                  <>
                    {t("home.guestAs")} <strong>{session.guestLabel}</strong>.{" "}
                  </>
                ) : (
                  <>{t("home.guestNew")} </>
                )}
                {t("home.guestNoTracking")}{" "}
                <Link href="/register" className="link">
                  {t("home.createAccount")}
                </Link>{" "}
                {t("home.toTrack")}
              </div>
            </div>
          ) : latest ? (
            <section className="stack" style={{ "--gap": "10px" } as React.CSSProperties} aria-labelledby="latest-title">
              <div className="row-between">
                <h2 id="latest-title" className="heading-m">
                  {t("home.latest")}
                </h2>
                <Link href="/my-reports" className="link">
                  {t("home.seeAll")}
                </Link>
              </div>
              <ReportCard report={latest} href={`/my-reports/${latest.report_id}`} />
            </section>
          ) : null}

          <section className="stats" aria-label={t("landing.stat.label")}>
            <div>
              <div className="stat-value">{formatNumber(stats?.reports_total, lang)}</div>
              <div className="stat-label">{t("home.stat.reports")}</div>
            </div>
            <div>
              <div className="stat-value">{formatNumber(stats?.reports_resolved, lang)}</div>
              <div className="stat-label">{t("home.stat.collected")}</div>
            </div>
            <div>
              <div className="stat-value">{formatNumber(stats?.reports_in_progress, lang)}</div>
              <div className="stat-label">{t("home.stat.inProgress")}</div>
            </div>
          </section>

          <InstallCard />

          <section className="stack" style={{ "--gap": "16px" } as React.CSSProperties} id="how" aria-labelledby="how-title">
            <div>
              <h2 id="how-title" className="display-m" style={{ fontSize: 30 }}>
                {t("how.title")}
              </h2>
              <p className="body-l">{t("how.lead")}</p>
            </div>
            <HowItWorks />
          </section>

          <section className="stack" style={{ "--gap": "12px" } as React.CSSProperties} id="services" aria-labelledby="svc-title">
            <div>
              <h2 id="svc-title" className="display-m" style={{ fontSize: 30 }}>
                {t("home.servicesTitle")}
              </h2>
              <p className="body-l">{t("home.servicesLead")}</p>
            </div>
            {services.map(({ icon: Icon, title, body, href, soon }) =>
              soon ? (
                <div className="service-card is-soon" key={title}>
                  <span className="icon-disc icon-disc--muted" style={{ "--size": "64px" } as React.CSSProperties}>
                    <Icon aria-hidden="true" />
                  </span>
                  <span className="service-card__text">
                    <span className="service-card__title">{title}</span>
                    <span className="service-card__body">{body}</span>
                    <span className="soon-pill">{t("common.comingSoon")}</span>
                  </span>
                </div>
              ) : (
                <Link className="service-card" href={href!} key={title}>
                  <span className="icon-disc icon-disc--deep" style={{ "--size": "64px" } as React.CSSProperties}>
                    <Icon aria-hidden="true" />
                  </span>
                  <span className="service-card__text">
                    <span className="service-card__title">{title}</span>
                    <span className="service-card__body">{body}</span>
                  </span>
                  <ChevronRight aria-hidden="true" className="service-card__chev" />
                </Link>
              ),
            )}
          </section>
        </div>
      </main>
      {mode === "guest" ? <PublicFooter compact /> : <TabBar />}
    </>
  );
}

/** Suspended citizen, or a guest device blocked after 5 upheld flags. */
export function SuspendedScreen({ guest, guestLabel }: { guest: boolean; guestLabel: string | null }) {
  const { t } = useT();
  const signOut = useSignOut();
  return (
    <>
      <TopBar centerLogo />
      <main id="main" className="m-screen" style={{ paddingTop: 40 }}>
        <div className="stack" style={{ "--gap": "24px" } as React.CSSProperties}>
          <div className="stack center" style={{ "--gap": "16px" } as React.CSSProperties}>
            <span className="icon-disc icon-disc--danger hero-disc" style={{ "--size": "140px" } as React.CSSProperties}>
              <ShieldAlert aria-hidden="true" />
            </span>
            <h1 className="display-l" style={{ fontSize: 40 }}>
              {guest ? t("suspended.guestTitle") : t("suspended.title")}
            </h1>
            <p className="body-l" style={{ fontSize: 19 }}>
              {guest ? t("suspended.guestBody", { label: guestLabel ?? "" }) : t("suspended.body")}
            </p>
          </div>
          <div className="card card--pad">
            <h2 className="heading-l">{t("suspended.canDo")}</h2>
            <ul className="can-do" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {!guest ? (
                <li>
                  <span className="icon-disc">
                    <FileText aria-hidden="true" />
                  </span>
                  <span>{t("suspended.pastVisible")}</span>
                </li>
              ) : null}
              <li>
                <span className="icon-disc">
                  <Headphones aria-hidden="true" />
                </span>
                <span>{t("suspended.mistake")}</span>
              </li>
            </ul>
          </div>
          <a href={`mailto:${site.email}?subject=${encodeURIComponent(t("suspended.mailSubject"))}`} className="btn btn--primary btn--block btn--lg">
            {t("suspended.contact")}
          </a>
          <p className="center" style={{ fontSize: 16 }}>
            {t("suspended.orCall")}{" "}
            <a className="link" href={site.phoneHref}>
              {site.phone}
            </a>
          </p>
          {!guest ? (
            <button type="button" className="link center" style={{ fontSize: 18 }} onClick={signOut}>
              {t("common.signOut")}
            </button>
          ) : (
            <Link href="/" className="link center" style={{ fontSize: 18 }}>
              {t("common.backHome")}
            </Link>
          )}
        </div>
      </main>
    </>
  );
}
