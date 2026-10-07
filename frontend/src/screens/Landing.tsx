"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { formatNumber } from "@/lib/format";
import { springDefault, springFast } from "@/lib/motion";
import type { PublicStats, ReportStatus } from "@/lib/types";
import { PublicFooter, PublicHeader } from "@/components/public";
import { InstallCard } from "@/components/pwa";
import { ParallaxSection } from "@/components/ParallaxSection";
import { Reveal } from "@/components/Reveal";
import {
  ArrowRight,
  CalendarDays,
  Camera,
  Clock,
  Globe,
  Leaf,
  MapPin,
  Recycle,
  ShieldCheck,
  Trash,
  Truck,
  Users,
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
  const rate = stats?.resolution_rate == null ? null : Math.round(stats.resolution_rate);

  const features = [
    { icon: Users, title: t("landing.pill.free"), body: t("landing.pill.free.body") },
    { icon: ShieldCheck, title: t("landing.pill.verified"), body: t("landing.pill.verified.body") },
    { icon: Clock, title: t("landing.pill.tracking"), body: t("landing.pill.tracking.body") },
    { icon: Globe, title: t("landing.pill.bilingual"), body: t("landing.pill.bilingual.body") },
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
        {/* ---------------- Bento hero ---------------- */}
        <section className="bento container" id="top" aria-labelledby="hero-title">
          <div className="enter tile bento__intro" style={{ "--d": "0ms" } as React.CSSProperties}>
            <span className="eyebrow-chip">
              <span className="live-dot" aria-hidden="true" />
              {t("landing.eyebrow")}
            </span>
            <h1 id="hero-title" className="hero__title">
              {t("landing.title1")} <span className="accent">{t("landing.title2")}</span>
            </h1>
            <p className="hero__lead">{t("landing.lead")}</p>
            <div className="hero__ctas">
              <Link href="/report" className="btn btn--primary btn--lg">
                <Camera aria-hidden="true" />
                {t("landing.cta")}
              </Link>
              <Link href="/#services" className="btn btn--tonal btn--lg">
                {t("landing.ourServices")}
                <ArrowRight aria-hidden="true" />
              </Link>
            </div>
          </div>

          <div className="enter tile tile--media bento__photo" style={{ "--d": "60ms" } as React.CSSProperties}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/hero-crew.jpg" alt={t("landing.heroAlt")} />
            <span className="float-chip">
              <span className="live-dot" aria-hidden="true" />
              <strong>{formatNumber(stats?.reports_in_progress, lang)}</strong> {t("landing.stat.inProgress")}
            </span>
          </div>

          <div className="enter tile bento__network" style={{ "--d": "120ms" } as React.CSSProperties}>
            <span className="eyebrow-mono">{t("landing.network")}</span>
            <div className="avatar-stack" aria-hidden="true">
              <span className="avatar">
                <Camera size={18} />
              </span>
              <span className="avatar">
                <MapPin size={18} />
              </span>
              <span className="avatar">
                <Truck size={18} />
              </span>
              <span className="avatar avatar-stack__count">{formatNumber(stats?.reports_total, lang)}</span>
            </div>
            <p>{t("landing.networkBody", { count: formatNumber(stats?.reports_total, lang) })}</p>
          </div>

          <div className="enter tile bento__rate" style={{ "--d": "160ms" } as React.CSSProperties}>
            <span className="bento__big">
              {rate === null ? "—" : rate}
              {rate === null ? null : <small>%</small>}
            </span>
            <span className="bento__big-label">
              <strong>{t("landing.stat.rate")}</strong>
              <span>{t("landing.rateNote")}</span>
            </span>
          </div>

          <div className="enter tile tile--media bento__band" style={{ "--d": "200ms" } as React.CSSProperties}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/commitment.jpg" alt={t("landing.commitAlt")} />
            <div className="bento__band-copy">
              <span className="bento__band-title">{t("landing.commitTitle1")}</span>
              <Link href="/register" className="btn btn--primary btn--sm">
                <Leaf aria-hidden="true" />
                {t("landing.join")}
              </Link>
            </div>
          </div>

          <div className="bento__features">
            {features.map(({ icon: Icon, title, body }, i) => (
              <div key={title} className="enter tile feature-tile" style={{ "--d": `${100 + i * 50}ms` } as React.CSSProperties}>
                <span className="feature-tile__icon">
                  <Icon aria-hidden="true" />
                </span>
                <span className="feature-tile__title">{title}</span>
                <span className="feature-tile__body">{body}</span>
              </div>
            ))}
          </div>
        </section>

        <div className="container install-slot">
          <InstallCard />
        </div>

        {/* ---------------- Live dashboard ---------------- */}
        <section className="container section" aria-labelledby="dash-title">
          <Reveal className="tile dash" dir="up">
            <LiveDashboard stats={stats} />
          </Reveal>
        </section>

        {/* ---------------- Services ---------------- */}
        <section className="section container" id="services" aria-labelledby="services-title">
          <Reveal className="section-head" dir="up">
            <span className="eyebrow-mono">{t("landing.why")}</span>
            <h2 id="services-title" className="display-l">
              {t("landing.servicesTitle1")} <span className="text-brand">{t("landing.servicesTitle2")}</span>
            </h2>
            <p className="body-l">{t("landing.servicesLead")}</p>
          </Reveal>
          <div className="service-grid">
            {services.map(({ icon: Icon, title, body, href, soon }, i) => {
              const inner = (
                <>
                  <span className={`icon-disc ${soon ? "icon-disc--muted" : ""}`} style={{ "--size": "56px" } as React.CSSProperties}>
                    <Icon aria-hidden="true" />
                  </span>
                  <span className="service-card__text">
                    <span className="service-card__title">{title}</span>
                    <span className="service-card__body">{body}</span>
                  </span>
                  {soon ? (
                    <span className="soon-pill">{t("common.comingSoon")}</span>
                  ) : (
                    <span className="service-card__go" aria-hidden="true">
                      <ArrowRight />
                    </span>
                  )}
                </>
              );
              return (
                <Reveal key={title} dir="up" delay={(i % 3) * 0.06}>
                  {soon ? (
                    <div className="service-card is-soon">{inner}</div>
                  ) : (
                    <Link className="service-card" href={href!}>
                      {inner}
                    </Link>
                  )}
                </Reveal>
              );
            })}
          </div>
        </section>

        {/* ---------------- How it works ---------------- */}
        <section className="section container" id="how" aria-labelledby="how-title">
          <Reveal className="section-head" dir="up">
            <span className="eyebrow-mono">{t("nav.reportGuide")}</span>
            <h2 id="how-title" className="display-l">
              {t("how.title")}
            </h2>
            <p className="body-l">{t("how.lead")}</p>
          </Reveal>
          <HowItWorks />
        </section>

        {/* ---------------- Parallax showcase ---------------- */}
        <div className="container showcase-wrap">
          <ParallaxSection
            bgImage="/images/hero-crew.jpg"
            bgAlt=""
            bleedPercent={35}
            bgSpeed={14}
            fgShift={28}
            minHeight="500px"
            className="showcase-parallax on-deep"
          >
            <div className="showcase">
              <span className="eyebrow-chip eyebrow-chip--glass">
                <Leaf aria-hidden="true" />
                {t("landing.showcase.eyebrow")}
              </span>
              <h2 className="showcase__title">
                {t("landing.showcase.title1")} <span className="accent">{t("landing.showcase.title2")}</span>
              </h2>
              <p className="showcase__body">{t("landing.showcase.body")}</p>
              <div className="showcase__ctas">
                <Link href="/report" className="btn btn--primary btn--lg">
                  <Camera aria-hidden="true" />
                  {t("home.cta")}
                </Link>
                <Link href="/register" className="btn btn--on-deep btn--lg">
                  {t("landing.join")}
                  <ArrowRight aria-hidden="true" />
                </Link>
              </div>
            </div>
          </ParallaxSection>
        </div>

        {/* ---------------- Commitment ---------------- */}
        <section className="container section" id="about" aria-labelledby="about-title">
          <div className="commitment on-deep">
            <Leaves side="right" />
            <div className="commitment__grid">
              <Reveal className="commitment__copy" dir="left">
                <span className="badge-amber">{t("landing.commitment")}</span>
                <h2 id="about-title" className="display-l" style={{ color: "#fff" }}>
                  {t("landing.commitTitle1")} <span className="accent">{t("landing.commitTitle2")}</span>
                </h2>
                <p>{t("landing.commitBody")}</p>
                <Link href="/register" className="btn btn--primary btn--lg">
                  {t("landing.join")}
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Reveal>
              <Reveal className="commitment__photo" dir="right" delay={0.1}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/images/commitment.jpg" alt={t("landing.commitAlt")} />
                <div className="trust-card">
                  <ShieldCheck aria-hidden="true" />
                  <span>{t("landing.trust")}</span>
                </div>
              </Reveal>
            </div>
          </div>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}

// ---------------------------------------------------------------------------
// Live dashboard: the public figures, one status at a time. The tab
// indicator slides between tabs on a shared-layout spring.
// ---------------------------------------------------------------------------
type DashTab = "ALL" | ReportStatus;

function LiveDashboard({ stats }: { stats: PublicStats | null }) {
  const { t, lang } = useT();
  const reduce = useReducedMotion();
  const [tab, setTab] = useState<DashTab>("ALL");

  const total = stats?.reports_total ?? null;
  const counts: Record<ReportStatus, number | null> = {
    PENDING: stats?.reports_pending ?? null,
    IN_PROGRESS: stats?.reports_in_progress ?? null,
    DONE: stats?.reports_resolved ?? null,
  };
  const share = (n: number | null) => (n == null || !total ? 0 : Math.round((n / total) * 100));

  const tabs: { id: DashTab; label: string }[] = [
    { id: "ALL", label: t("landing.dash.overview") },
    { id: "PENDING", label: t("status.PENDING") },
    { id: "IN_PROGRESS", label: t("status.IN_PROGRESS") },
    { id: "DONE", label: t("status.DONE") },
  ];
  const body: Record<ReportStatus, string> = {
    PENDING: t("landing.dash.pendingBody"),
    IN_PROGRESS: t("landing.dash.progressBody"),
    DONE: t("landing.dash.doneBody"),
  };
  const statuses: ReportStatus[] = ["PENDING", "IN_PROGRESS", "DONE"];

  return (
    <>
      <div className="dash__head">
        <div className="stack" style={{ "--gap": "10px" } as React.CSSProperties}>
          <span className="eyebrow-mono">{t("landing.dash.eyebrow")}</span>
          <h2 id="dash-title" className="dash__title">
            {t("landing.dash.title")}
          </h2>
        </div>
        <p className="dash__note">{stats?.unavailable ? t("landing.dash.unavailable") : t("landing.dash.note")}</p>
      </div>

      <LayoutGroup id="dash-tabs">
        <div className="tabs" role="tablist" aria-label={t("landing.stat.label")}>
          {tabs.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`dash-tab-${id}`}
              aria-selected={tab === id}
              aria-controls="dash-panel"
              className="tabs__tab"
              onClick={() => setTab(id)}
            >
              {tab === id ? (
                <motion.span className="tabs__indicator" layoutId="dash-indicator" transition={reduce ? { duration: 0 } : springFast} />
              ) : null}
              <span className="tabs__label">{label}</span>
            </button>
          ))}
        </div>
      </LayoutGroup>

      <div className="dash__panel" role="tabpanel" id="dash-panel" aria-labelledby={`dash-tab-${tab}`}>
        {tab === "ALL" ? (
          <motion.div
            key="all"
            className="dash__overview"
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={springDefault}
          >
            <div className="dash__total">
              <span className="dash__number">{formatNumber(total, lang)}</span>
              <span className="muted">{t("landing.dash.total")}</span>
            </div>
            <div className="stack-bar" aria-hidden="true">
              {statuses.map((s) => (
                <motion.span
                  key={s}
                  className={`stack-bar__seg stack-bar__seg--${s}`}
                  initial={reduce ? false : { width: 0 }}
                  animate={{ width: `${share(counts[s])}%` }}
                  transition={springDefault}
                />
              ))}
            </div>
            <ul className="dash__legend">
              {statuses.map((s) => (
                <li key={s}>
                  <span className={`legend-dot legend-dot--${s}`} aria-hidden="true" />
                  <span>{t(`status.${s}`)}</span>
                  <strong className="mono">{formatNumber(counts[s], lang)}</strong>
                </li>
              ))}
            </ul>
          </motion.div>
        ) : (
          <motion.div
            key={tab}
            className="dash__status"
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={springDefault}
          >
            <div className="dash__total">
              <span className="dash__number">{formatNumber(counts[tab], lang)}</span>
              <span className={`chip chip--${tab} chip--lg`}>{t(`status.${tab}`)}</span>
            </div>
            <p className="body-l">{body[tab]}</p>
            <div className="meter" aria-hidden="true">
              <motion.span
                className={`meter__fill stack-bar__seg--${tab}`}
                initial={reduce ? false : { width: 0 }}
                animate={{ width: `${share(counts[tab])}%` }}
                transition={springDefault}
              />
            </div>
            <span className="mono muted">{t("landing.dash.share", { percent: share(counts[tab]) })}</span>
          </motion.div>
        )}
      </div>
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
        <li key={title} className="how__item">
          <Reveal dir="up" delay={i * 0.1} className="how__card">
            <span className="how__num" aria-hidden="true">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="how__disc icon-disc" style={{ "--size": "56px" } as React.CSSProperties}>
              <Icon aria-hidden="true" />
            </span>
            <span className="how__title">{title}</span>
            <span className="how__body">{body}</span>
          </Reveal>
        </li>
      ))}
    </ol>
  );
}
