"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { formatNumber } from "@/lib/format";
import type { PublicStats } from "@/lib/types";
import { PublicFooter, PublicHeader } from "@/components/public";
import { InstallCard } from "@/components/pwa";
import {
  ArrowRight,
  CalendarDays,
  Camera,
  ChevronRight,
  Clock,
  Globe,
  Leaf,
  MapPin,
  Recycle,
  ShieldCheck,
  Trash,
  Truck,
  Users,
  CheckCircle,
  Zap,
} from "@/components/icons";

export function usePublicStats() {
  const [stats, setStats] = useState<PublicStats | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .get<{ stats: PublicStats }>("public/stats")
      .then((r) => alive && setStats(r.stats))
      .catch(() => alive && setStats({ reports_total: null, reports_resolved: null, reports_in_progress: null, reports_pending: null, resolution_rate: null, unavailable: true }));
    return () => {
      alive = false;
    };
  }, []);
  return stats;
}

/** Decorative leaves at the edges of the dark bands. */
export function Leaves({ side }: { side: "left" | "right" }) {
  return (
    <svg className={`leaves leaves--${side}`} viewBox="0 0 200 320" aria-hidden="true" focusable="false">
      <g fill="#1f7a45" opacity="0.55">
        <path d="M20 300c10-70 50-120 120-150-40 50-70 100-120 150Z" />
        <path d="M0 210c20-60 60-95 130-110-45 40-80 75-130 110Z" opacity="0.8" />
        <path d="M30 120c25-50 70-80 140-80-50 30-90 55-140 80Z" opacity="0.7" />
      </g>
      <g fill="none" stroke="#2a9457" strokeWidth="2" opacity="0.5">
        <path d="M20 300c30-55 70-105 120-150" />
        <path d="M0 210c40-40 80-80 130-110" />
      </g>
    </svg>
  );
}

export function LandingScreen() {
  const { t, lang } = useT();
  const stats = usePublicStats();

  const statTiles = [
    { icon: Users, value: formatNumber(stats?.reports_total, lang), label: t("landing.stat.reports") },
    { icon: CheckCircle, value: formatNumber(stats?.reports_resolved, lang), label: t("landing.stat.resolved") },
    {
      icon: ShieldCheck,
      value: stats?.resolution_rate == null ? "—" : `${Math.round(stats.resolution_rate)}%`,
      label: t("landing.stat.rate"),
    },
    { icon: Zap, value: formatNumber(stats?.reports_in_progress, lang), label: t("landing.stat.inProgress") },
  ];

  const services = [
    { icon: Trash, title: t("service.reporting.title"), body: t("service.reporting.body"), href: "/report" },
    { icon: MapPin, title: t("service.tracking.title"), body: t("service.tracking.body"), href: "/my-reports" },
    { icon: ShieldCheck, title: t("service.fraud.title"), body: t("service.fraud.body"), href: "/#how" },
    { icon: Recycle, title: t("service.recycling.title"), body: t("service.recycling.body"), soon: true },
    { icon: Truck, title: t("service.pickup.title"), body: t("service.pickup.body"), soon: true },
    { icon: CalendarDays, title: t("service.subscription.title"), body: t("service.subscription.body"), soon: true },
  ];

  return (
    <>
      <PublicHeader />
      <main id="main">
        {/* ---------------- Hero ---------------- */}
        <section className="hero on-deep">
          <Leaves side="left" />
          <div className="hero__grid container">
            <div className="hero__copy">
              <span className="eyebrow-pill">
                <Leaf aria-hidden="true" />
                {t("landing.eyebrow")}
              </span>
              <h1 className="hero__title">
                {t("landing.title1")} <span className="accent">{t("landing.title2")}</span>
              </h1>
              <p className="hero__lead">{t("landing.lead")}</p>
              <div className="hero__ctas">
                <Link href="/report" className="btn btn--primary btn--lg">
                  {t("landing.cta")}
                  <ArrowRight aria-hidden="true" />
                </Link>
                <Link href="/#services" className="btn btn--on-deep btn--lg">
                  {t("landing.ourServices")}
                  <ArrowRight aria-hidden="true" className="desktop-only" />
                </Link>
              </div>
              <ul className="feature-pills">
                <li>
                  <Users aria-hidden="true" />
                  {t("landing.pill.free")}
                </li>
                <li>
                  <ShieldCheck aria-hidden="true" />
                  {t("landing.pill.verified")}
                </li>
                <li>
                  <Clock aria-hidden="true" />
                  {t("landing.pill.tracking")}
                </li>
                <li>
                  <Globe aria-hidden="true" />
                  {t("landing.pill.bilingual")}
                </li>
              </ul>
            </div>
            <div className="hero__photo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/hero-crew.jpg" alt={t("landing.heroAlt")} />
            </div>
          </div>
        </section>

        {/* ---------------- Live stats ---------------- */}
        <div className="container">
          <section className="stat-bar" aria-label={t("landing.stat.label")}>
            {statTiles.map(({ icon: Icon, value, label }) => (
              <div className="stat-tile" key={label}>
                <span className="icon-disc icon-disc--deep" style={{ "--size": "64px" } as React.CSSProperties}>
                  <Icon aria-hidden="true" />
                </span>
                <div>
                  <div className="stat-tile__value">{value}</div>
                  <div className="stat-tile__label">{label}</div>
                </div>
              </div>
            ))}
          </section>
        </div>

        <div className="container install-slot">
          <InstallCard />
        </div>

        {/* ---------------- Services ---------------- */}
        <section className="section container" id="services" aria-labelledby="services-title">
          <div className="section-head">
            <span className="badge-mint">{t("landing.why")}</span>
            <h2 id="services-title" className="display-l">
              {t("landing.servicesTitle1")}
              <br />
              <span className="text-brand">{t("landing.servicesTitle2")}</span>
            </h2>
            <p className="body-l">{t("landing.servicesLead")}</p>
          </div>
          <div className="service-grid">
            {services.map(({ icon: Icon, title, body, href, soon }) => {
              const inner = (
                <>
                  <span className={`icon-disc ${soon ? "icon-disc--muted" : "icon-disc--deep"}`} style={{ "--size": "64px" } as React.CSSProperties}>
                    <Icon aria-hidden="true" />
                  </span>
                  <span className="service-card__text">
                    <span className="service-card__title">{title}</span>
                    <span className="service-card__body">{body}</span>
                    {soon ? <span className="soon-pill">{t("common.comingSoon")}</span> : null}
                  </span>
                  {soon ? null : <ChevronRight aria-hidden="true" className="service-card__chev" />}
                </>
              );
              return soon ? (
                <div className="service-card is-soon" key={title}>
                  {inner}
                </div>
              ) : (
                <Link className="service-card" href={href!} key={title}>
                  {inner}
                </Link>
              );
            })}
          </div>
        </section>

        {/* ---------------- How it works ---------------- */}
        <section className="section container" id="how" aria-labelledby="how-title">
          <div className="section-head">
            <h2 id="how-title" className="display-m">
              {t("how.title")}
            </h2>
            <p className="body-l">{t("how.lead")}</p>
          </div>
          <HowItWorks />
        </section>

        {/* ---------------- Commitment ---------------- */}
        <section className="commitment on-deep" id="about" aria-labelledby="about-title">
          <Leaves side="left" />
          <Leaves side="right" />
          <div className="commitment__grid container">
            <div className="commitment__copy">
              <span className="badge-amber">{t("landing.commitment")}</span>
              <h2 id="about-title" className="display-l" style={{ color: "#fff" }}>
                {t("landing.commitTitle1")}
                <br />
                <span className="accent">{t("landing.commitTitle2")}</span>
              </h2>
              <p>{t("landing.commitBody")}</p>
              <Link href="/register" className="btn btn--on-deep desktop-only" style={{ alignSelf: "flex-start" }}>
                {t("landing.join")}
                <ArrowRight aria-hidden="true" />
              </Link>
            </div>
            <div className="commitment__photo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/commitment.jpg" alt={t("landing.commitAlt")} />
              <div className="trust-card">
                <ShieldCheck aria-hidden="true" />
                <span>{t("landing.trust")}</span>
              </div>
            </div>
            <Link href="/register" className="btn btn--block mobile-only commitment__cta">
              {t("landing.join")}
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}

export function HowItWorks() {
  const { t } = useT();
  const steps = [
    { icon: Camera, title: t("how.step1.title"), body: t("how.step1.body") },
    { icon: MapPin, title: t("how.step2.title"), body: t("how.step2.body") },
    { icon: Truck, title: t("how.step3.title"), body: t("how.step3.body") },
  ];
  return (
    <ol className="how">
      {steps.map(({ icon: Icon, title, body }, i) => (
        <li key={title}>
          <span className="icon-disc" style={{ "--size": "76px" } as React.CSSProperties}>
            <Icon aria-hidden="true" />
          </span>
          <div className="how__text">
            <span className="how__title">
              <span className="how__num" aria-hidden="true">
                {i + 1}
              </span>
              {title}
            </span>
            <span className="how__body">{body}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}
