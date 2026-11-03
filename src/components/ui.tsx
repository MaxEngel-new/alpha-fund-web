import Link from "next/link";
import type { ReactNode } from "react";
import { FileText, Info } from "lucide-react";
import type { DatasetMeta } from "@/lib/data";
import { shortDate } from "@/lib/format";

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-5 sm:px-8 ${className}`}>{children}</div>;
}

export function PageHeader({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <header className="border-b border-line/70 pb-10 pt-14 sm:pt-20">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-teal">{eyebrow}</p>
      <h1 className="mt-3 max-w-3xl font-serif text-4xl leading-tight text-fg sm:text-5xl">{title}</h1>
      {children ? <div className="mt-5 max-w-3xl text-lg leading-relaxed text-fg-muted">{children}</div> : null}
    </header>
  );
}

export function Section({ id, title, kicker, children }: { id?: string; title: string; kicker?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 py-12" aria-labelledby={id ? `${id}-title` : undefined}>
      {kicker ? <p className="text-xs font-medium uppercase tracking-[0.18em] text-fg-subtle">{kicker}</p> : null}
      <h2 id={id ? `${id}-title` : undefined} className="mt-1 font-serif text-2xl text-fg sm:text-3xl">
        {title}
      </h2>
      <div className="mt-6">{children}</div>
    </section>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-line bg-ink-850/80 p-5 sm:p-6 ${className}`}>{children}</div>;
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-ink-850/80 p-5">
      <dt className="text-xs uppercase tracking-wider text-fg-subtle">{label}</dt>
      <dd className="mt-2 font-mono text-2xl text-fg tabular">{value}</dd>
      {hint ? <dd className="mt-1 text-sm text-fg-muted">{hint}</dd> : null}
    </div>
  );
}

const BADGE_STYLES: Record<string, string> = {
  exploratory: "border-amber/40 bg-amber/10 text-amber",
  reject: "border-rose/40 bg-rose/10 text-rose",
  inconclusive: "border-blue/40 bg-blue/10 text-blue",
  prospective: "border-teal/40 bg-teal/10 text-teal",
  neutral: "border-line bg-ink-800 text-fg-muted",
  progress: "border-teal/40 bg-teal/10 text-teal",
};

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof BADGE_STYLES; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${BADGE_STYLES[tone]}`}>
      {children}
    </span>
  );
}

export function verdictTone(verdict: string): keyof typeof BADGE_STYLES {
  const v = verdict.toLowerCase();
  if (v.startsWith("reject")) return "reject";
  if (v.startsWith("inconclusive")) return "inconclusive";
  return "neutral";
}

export function Callout({ title, children, tone = "amber" }: { title: string; children: ReactNode; tone?: "amber" | "teal" | "blue" }) {
  const colors = { amber: "border-amber/40 bg-amber/[0.06]", teal: "border-teal/40 bg-teal/[0.06]", blue: "border-blue/40 bg-blue/[0.06]" };
  const icon = { amber: "text-amber", teal: "text-teal", blue: "text-blue" };
  return (
    <div className={`flex gap-3 rounded-xl border p-4 sm:p-5 ${colors[tone]}`} role="note">
      <Info className={`mt-0.5 h-5 w-5 shrink-0 ${icon[tone]}`} aria-hidden />
      <div>
        <p className="font-medium text-fg">{title}</p>
        <div className="mt-1 text-sm leading-relaxed text-fg-muted">{children}</div>
      </div>
    </div>
  );
}

export function Provenance({ meta }: { meta: DatasetMeta }) {
  return (
    <details className="group rounded-xl border border-line bg-ink-950/60 p-4 text-sm text-fg-muted">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-fg">
        <FileText className="h-4 w-4 text-teal" aria-hidden />
        Data provenance
        <span className="ml-auto text-xs text-fg-subtle group-open:hidden">Show</span>
        <span className="ml-auto hidden text-xs text-fg-subtle group-open:inline">Hide</span>
      </summary>
      <dl className="mt-3 grid gap-2 sm:grid-cols-[11rem_1fr]">
        <dt className="text-fg-subtle">Classification</dt>
        <dd>{meta.classification}</dd>
        <dt className="text-fg-subtle">Period</dt>
        <dd>{meta.period}</dd>
        <dt className="text-fg-subtle">Source reports</dt>
        <dd className="font-mono text-xs leading-relaxed">{meta.source_report.join(", ")}</dd>
        <dt className="text-fg-subtle">Generated</dt>
        <dd className="font-mono text-xs">{shortDate(meta.generated_at)} (UTC), research code commit {meta.backend_commit}</dd>
        <dt className="text-fg-subtle">Methodology</dt>
        <dd>
          <Link className="text-teal underline-offset-4 hover:underline" href={meta.methodology_ref}>
            {meta.methodology_ref}
          </Link>
        </dd>
      </dl>
    </details>
  );
}

export function TableWrap({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export const th = "border-b border-line bg-ink-800/80 px-3 py-2.5 text-xs font-medium uppercase tracking-wider text-fg-subtle";
export const td = "border-b border-line/60 px-3 py-2.5 text-fg-muted";
export const tdNum = "border-b border-line/60 px-3 py-2.5 text-right font-mono text-fg tabular";
