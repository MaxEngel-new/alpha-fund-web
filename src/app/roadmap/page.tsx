import type { Metadata } from "next";
import { CheckCircle2, CircleDot } from "lucide-react";
import { Badge, Callout, Container, PageHeader, Provenance } from "@/components/ui";
import { roadmap } from "@/lib/data";

export const metadata: Metadata = {
  title: "Development Roadmap",
  description: "Sprint-by-sprint development history of the Alpha Fund research platform, including findings and known limitations.",
};

function List({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  if (!items.length) return null;
  return (
    <div>
      <p className={`text-xs font-medium uppercase tracking-wider ${tone}`}>{title}</p>
      <ul className="mt-1.5 space-y-1 text-sm leading-relaxed text-fg-muted">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-fg-subtle" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function RoadmapPage() {
  const sprints = roadmap.data.sprints;
  return (
    <Container>
      <PageHeader eyebrow="Development Roadmap" title="Sixteen sprints, from data pipeline to prospective research">
        What was built, what was learned and what is still limited, in order. Findings include the negative ones.
      </PageHeader>
      <div className="mt-8">
        <Callout title="About the early sprints" tone="blue">{String(roadmap.meta.note)}</Callout>
      </div>
      <ol className="relative mt-10 border-l border-line pl-6 sm:pl-8">
        {sprints.map((s) => {
          const active = s.status !== "complete";
          return (
            <li key={s.sprint} className="mb-10 last:mb-0">
              <span className={`absolute -left-[0.6rem] flex h-5 w-5 items-center justify-center rounded-full bg-ink-900 ${active ? "text-teal" : "text-blue"}`}>
                {active ? <CircleDot className="h-5 w-5" aria-hidden /> : <CheckCircle2 className="h-5 w-5" aria-hidden />}
              </span>
              <div className="rounded-xl border border-line bg-ink-850/80 p-5 sm:p-6">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-fg-subtle">Sprint {s.sprint}</span>
                  <span className="text-xs text-fg-subtle">· {s.date}</span>
                  {active ? <Badge tone="progress">In development</Badge> : null}
                  {s.inferred ? <Badge tone="neutral">Numbering inferred</Badge> : null}
                </div>
                <h2 className="mt-2 font-serif text-xl text-fg">{s.title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-fg-muted">{s.objective}</p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <List title="Delivered" items={s.delivered} tone="text-teal" />
                  <List title="Engineering" items={s.engineering} tone="text-blue" />
                  <List title="Findings" items={s.findings} tone="text-amber" />
                  <List title="Known limitations" items={s.limitations} tone="text-rose" />
                </div>
                <p className="mt-4 font-mono text-[11px] text-fg-subtle">Source: {s.source}</p>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-10">
        <Provenance meta={roadmap.meta} />
      </div>
    </Container>
  );
}
