import Link from "next/link";
import { ArrowRight, Beaker, BookOpenCheck, CircleDashed, FlaskConical, GitCommitVertical, Scale, ShieldCheck } from "lucide-react";
import { Badge, Callout, Card, Container, Provenance, Section, Stat } from "@/components/ui";
import { platform, research, roadmap } from "@/lib/data";
import { loadProspective } from "@/lib/prospective-data";
import { DISCLAIMER, SITE } from "@/lib/site";

const PRINCIPLES = [
  { icon: BookOpenCheck, title: "Pre-register, then test", text: "Hypotheses, windows and metrics are fixed before results are seen. Re-tests on examined data are labelled exploratory." },
  { icon: Scale, title: "Costs and constraints first", text: "Every backtest published here pays transaction costs and runs in a cash-only account unless margin research is explicitly labelled." },
  { icon: FlaskConical, title: "Negative results are results", text: "Rejected and inconclusive hypotheses are published alongside everything else, with the evidence behind each verdict." },
  { icon: ShieldCheck, title: "Prove the timing", text: "A decision counts as prospective only when its timestamps show it was recorded before it could be acted on." },
];

export default function OverviewPage() {
  const p = platform.data;
  const primary = Object.values(research.data.primary);
  const rejected = primary.filter((r) => r.verdict === "Reject").length;
  const inconclusive = primary.filter((r) => r.verdict === "Inconclusive").length;
  const recent = roadmap.data.sprints.filter((s) => s.status === "complete").slice(-3).reverse();
  const { dataset: prospectiveDataset, preview: prospectivePreview } = loadProspective();
  const prospective = prospectiveDataset.data;
  const recorded = prospective.status === "decisions_recorded" ? prospective.record : undefined;
  const nextWindow = prospective.windows[0];

  return (
    <Container>
      <section className="pb-10 pt-16 sm:pt-24">
        <Badge tone="progress">Research only · No investment services</Badge>
        <h1 className="mt-5 max-w-4xl font-serif text-4xl leading-[1.1] text-fg sm:text-6xl">{SITE.tagline}</h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-fg-muted">{SITE.description}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/research" className="inline-flex items-center gap-2 rounded-lg bg-teal px-4 py-2.5 text-sm font-medium text-ink-950 hover:bg-teal/90">
            Explore the research <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <Link href="/methodology" className="inline-flex items-center gap-2 rounded-lg border border-line px-4 py-2.5 text-sm text-fg hover:bg-ink-800">
            Read the methodology
          </Link>
        </div>
      </section>

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Development sprints" value={String(p.sprints_complete)} hint="complete; the website is sprint 17" />
        <Stat label="Automated tests" value={p.tests_passing.toLocaleString("en-US")} hint="passing at the latest research commit" />
        <Stat label="Research universe" value={`${p.universe.usable} stocks`} hint={`plus ${p.universe.benchmark} as benchmark`} />
        <Stat label="Pre-registered replications" value={`0 of ${primary.length} passed`} hint={`${rejected} rejected, ${inconclusive} inconclusive`} />
      </dl>

      <Section title="Research philosophy" kicker="Mission">
        <p className="max-w-3xl leading-relaxed text-fg-muted">
          Alpha Fund asks one question as honestly as it can: does a systematic idea earn risk-adjusted returns out of sample,
          after costs, compared with simply holding the market? So far the answer for every idea tested is no, or not yet
          demonstrated. The platform is built to make that answer trustworthy.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {PRINCIPLES.map(({ icon: Icon, title, text }) => (
            <Card key={title}>
              <Icon className="h-5 w-5 text-teal" aria-hidden />
              <h3 className="mt-3 font-medium text-fg">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{text}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="Platform capabilities" kicker="Engineering">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {p.capabilities.map((c) => (
            <Card key={c.title} className="p-5">
              <h3 className="text-sm font-medium text-fg">{c.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-fg-muted">{c.text}</p>
            </Card>
          ))}
        </div>
      </Section>

      <div className="grid gap-6 py-6 lg:grid-cols-2">
        <Card>
          <div className="flex items-center gap-2">
            <Beaker className="h-5 w-5 text-blue" aria-hidden />
            <h2 className="font-serif text-xl text-fg">Research universe</h2>
          </div>
          <dl className="mt-4 grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
            <dt className="text-fg-subtle">Universe</dt>
            <dd className="text-fg-muted">{p.universe.candidates} large U.S. stocks ({p.universe.usable} usable)</dd>
            <dt className="text-fg-subtle">Source</dt>
            <dd className="text-fg-muted">{p.universe.source}</dd>
            <dt className="text-fg-subtle">History</dt>
            <dd className="text-fg-muted">{p.universe.history}</dd>
            <dt className="text-fg-subtle">Excluded</dt>
            <dd className="text-fg-muted">
              {Object.entries(p.universe.excluded).map(([s, why]) => (
                <span key={s} className="block">
                  <span className="font-mono text-fg">{s}</span>: {why}
                </span>
              ))}
            </dd>
          </dl>
          <div className="mt-4">
            <Badge tone="exploratory">Survivorship-biased: current constituents only</Badge>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-2">
            <CircleDashed className="h-5 w-5 text-teal" aria-hidden />
            <h2 className="font-serif text-xl text-fg">Prospective research</h2>
            {prospectivePreview ? <Badge tone="exploratory">Unapproved preview</Badge> : null}
          </div>
          {recorded ? (
            <>
              <p className="mt-4 text-sm leading-relaxed text-fg-muted">
                Four pre-registered portfolios are recorded before each month-end decision can be acted on. The first{" "}
                {recorded.decisions} decisions, for {recorded.decision_sessions[0]}, are recorded. No simulated fills or investment
                performance exist yet.
              </p>
              <p className="mt-4 rounded-lg border border-line bg-ink-900 px-4 py-3 text-sm text-fg">Awaiting first performance observation.</p>
            </>
          ) : (
            <>
              <p className="mt-4 text-sm leading-relaxed text-fg-muted">
                Four pre-registered portfolios will be recorded before each month-end decision can be acted on. Nothing has been
                recorded yet.
              </p>
              <p className="mt-4 rounded-lg border border-line bg-ink-900 px-4 py-3 text-sm text-fg">Awaiting first prospective observation.</p>
            </>
          )}
          {nextWindow ? (
            <p className="mt-3 text-sm text-fg-muted">
              {recorded ? "Next" : "First"} recording window: <span className="text-fg">{nextWindow.opens}</span> to{" "}
              <span className="text-fg">{nextWindow.closes}</span>.
            </p>
          ) : null}
          <Link href="/prospective" className="mt-4 inline-flex items-center gap-1.5 text-sm text-teal hover:underline">
            Prospective monitor <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </Card>
      </div>

      <Section title="Recent milestones" kicker="Development">
        <ol className="grid gap-4 lg:grid-cols-3">
          {recent.map((s) => (
            <li key={s.sprint}>
              <Card className="h-full">
                <p className="flex items-center gap-2 text-xs text-fg-subtle">
                  <GitCommitVertical className="h-4 w-4 text-teal" aria-hidden /> Sprint {s.sprint} · {s.date}
                </p>
                <h3 className="mt-2 font-medium text-fg">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{s.objective}</p>
              </Card>
            </li>
          ))}
        </ol>
        <Link href="/roadmap" className="mt-5 inline-flex items-center gap-1.5 text-sm text-teal hover:underline">
          Full development roadmap <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </Section>

      <Callout title="Important" tone="amber">{DISCLAIMER}</Callout>
      <div className="mt-6">
        <Provenance meta={platform.meta} />
      </div>
    </Container>
  );
}
