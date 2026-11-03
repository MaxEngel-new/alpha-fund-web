import type { Metadata } from "next";
import { InferenceChart } from "@/components/charts/inference-chart";
import { Badge, Callout, Card, Container, PageHeader, Provenance, Section, TableWrap, td, tdNum, th, verdictTone } from "@/components/ui";
import { research } from "@/lib/data";
import { num } from "@/lib/format";

export const metadata: Metadata = {
  title: "Research Lab",
  description: "Feature engineering, purged walk-forward machine learning, overlap-robust hypothesis testing and every research result, including rejected hypotheses.",
};

const PIPELINE = [
  { step: "Features", text: "Trailing technical and cross-sectional features computed only from data available at each date." },
  { step: "Targets", text: "Forward relative returns and cross-sectional ranks, each with a declared horizon used for purging." },
  { step: "Purged walk-forward", text: "Each fold trains on the past only, drops the last horizon of training rows, and tests on unseen data." },
  { step: "Models", text: "Naive baselines first; then linear and logistic models, XGBoost and LightGBM, refit in every fold." },
  { step: "Inference", text: "Overlap-robust tests on the out-of-sample series, corrected for multiple testing." },
  { step: "Verdict", text: "Evidence-based rules: significance required, a minimum effect, and a cap for biased universes." },
];

const MODELS = [
  { name: "Naive mean / most frequent class", role: "Baselines every model is compared against" },
  { name: "Linear and logistic regression", role: "Transparent reference models" },
  { name: "XGBoost", role: "Gradient-boosted trees; early stopping on in-fold validation data only" },
  { name: "LightGBM", role: "Gradient-boosted trees with histogram splits; same validation discipline" },
];

const METHODS: Record<string, string> = {
  naive_t: "Naive t-test",
  "newey_west_h-1": "Newey-West (h−1 lags)",
  hansen_hodrick: "Hansen-Hodrick",
  batch_means: "Batch means",
  combined: "Combined (used)",
};

function pValue(p: number | null): string {
  if (p === null) return "—";
  return p < 0.001 ? "<0.001" : num(p, 3);
}

export default function ResearchPage() {
  const r = research.data;
  const scenarios = r.inference_simulation.scenarios;
  const inferenceRows = Object.entries(METHODS).map(([method, label]) => {
    const values = scenarios.map((s) => Number(s[method])).filter((v) => !Number.isNaN(v));
    return { method, label, worst: Math.max(...values), best: Math.min(...values) };
  });
  const combined = inferenceRows.find((x) => x.method === "combined")!;
  const aSeries = Object.entries(r.hypotheses).filter(([id]) => id.startsWith("A"));
  const featureNames = Object.keys(r.features);

  return (
    <Container>
      <PageHeader eyebrow="Research Lab" title="How ideas are tested, and what happened to them">
        A disciplined pipeline from features to verdicts. The headline result is negative: no tested idea has been validated, and
        every pre-registered replication on the expanded universe failed.
      </PageHeader>

      <Section id="pipeline" title="Research pipeline" kicker="Method">
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PIPELINE.map((p, i) => (
            <li key={p.step}>
              <Card className="h-full">
                <p className="font-mono text-xs text-teal">0{i + 1}</p>
                <h3 className="mt-1 font-medium text-fg">{p.step}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{p.text}</p>
              </Card>
            </li>
          ))}
        </ol>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section id="features" title="Feature engineering" kicker="Inputs">
          <p className="text-sm leading-relaxed text-fg-muted">
            Feature families in the expanded-universe configuration. All are trailing windows ending at the decision date; 12-1
            momentum, total return and volatility use dividend-adjusted prices, and relative strength is measured against SPY.
          </p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {featureNames.map((f) => (
              <li key={f} className="rounded-md border border-line bg-ink-850 px-2.5 py-1 font-mono text-xs text-fg-muted">{f}</li>
            ))}
          </ul>
        </Section>
        <Section id="models" title="Models" kicker="Machine learning">
          <ul className="space-y-3">
            {MODELS.map((m) => (
              <li key={m.name} className="rounded-lg border border-line bg-ink-850/80 px-4 py-3">
                <p className="text-sm font-medium text-fg">{m.name}</p>
                <p className="text-sm text-fg-muted">{m.role}</p>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <Section id="walk-forward" title="Purged walk-forward validation" kicker="No look-ahead">
        <Card>
          <div role="img" aria-label="Three walk-forward folds: each trains on an expanding past window, drops a purge gap, then tests on the following year" className="space-y-2">
            {[0, 1, 2].map((fold) => (
              <div key={fold} className="flex items-center gap-2 text-xs">
                <span className="w-14 shrink-0 text-fg-subtle">Fold {fold + 1}</span>
                <div className="flex h-6 flex-1 overflow-hidden rounded">
                  <div className="bg-blue-soft/70" style={{ width: `${40 + fold * 15}%` }} />
                  <div className="w-[3%] bg-[repeating-linear-gradient(45deg,#27344f,#27344f_3px,#121b30_3px,#121b30_6px)]" />
                  <div className="w-[12%] bg-teal/80" />
                  <div className="flex-1 bg-ink-800" />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-4 text-xs text-fg-muted">
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-blue-soft/70" /> Training (past only)</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-ink-600" /> Purge gap (target horizon)</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-teal/80" /> Out-of-sample test</span>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-fg-muted">
            A fresh model is built in every fold. Training rows whose forward-return labels would overlap the test period are
            dropped, and hyperparameter search uses validation data carved from the training slice only.
          </p>
        </Card>
      </Section>

      <Section id="inference" title="Statistical testing" kicker="Overlapping returns and multiple tests">
        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <Card>
            <InferenceChart rows={inferenceRows} alpha={r.inference_simulation.alpha} />
          </Card>
          <div className="space-y-4 text-sm leading-relaxed text-fg-muted">
            <p>
              Forward returns over 5 or 20 days overlap from one day to the next, so ordinary t-tests drastically overstate
              significance. A simulation with {r.inference_simulation.reps.toLocaleString("en-US")} replications per scenario measured
              how often each test rejects a true null.
            </p>
            <p>
              The textbook Newey-West correction was oversized in every scenario. The combined test used in the research
              (Hansen-Hodrick standard errors plus a batch-means check) ranged from{" "}
              <span className="font-mono text-fg">{(combined.best * 100).toFixed(1)}%</span> to{" "}
              <span className="font-mono text-fg">{(combined.worst * 100).toFixed(1)}%</span> at a nominal 5%: approximate,
              not guaranteed, error control.
            </p>
            <p>Across the primary hypotheses, p-values are adjusted with the Holm method; exploratory screens use Benjamini-Hochberg.</p>
          </div>
        </div>
      </Section>

      <Section id="findings" title="Pre-registered replications (B001–B005)" kicker="Findings">
        <Callout title="Nothing validated" tone="blue">
          Each hypothesis was fixed before testing: a discovery window ({research.meta.period}) and a later replication window.
          All five failed. These are labelled exploratory because the universe is survivorship-biased, which caps any verdict.
        </Callout>
        <div className="mt-5">
          <TableWrap caption="Pre-registered hypotheses B001 to B005 with discovery and replication evidence">
            <thead>
              <tr>
                <th scope="col" className={th}>ID</th>
                <th scope="col" className={th}>Hypothesis</th>
                <th scope="col" className={th}>Metric</th>
                <th scope="col" className={`${th} text-right`}>Discovery (95% CI)</th>
                <th scope="col" className={`${th} text-right`}>Holm p</th>
                <th scope="col" className={`${th} text-right`}>Replication (p)</th>
                <th scope="col" className={th}>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(r.primary).map(([id, p]) => (
                <tr key={id}>
                  <th scope="row" className={`${td} font-mono font-normal text-fg`}>{id}</th>
                  <td className={`${td} max-w-xs`}>
                    {r.hypotheses[id]?.statement}
                    <span className="mt-1 block text-xs text-fg-subtle">{p.reasons[0]}</span>
                  </td>
                  <td className={td}>{p.metric}</td>
                  <td className={tdNum}>
                    {num(p.discovery.estimate, p.metric === "Rank IC" ? 4 : 2)}{" "}
                    <span className="text-fg-subtle">
                      ({num(p.discovery.ci[0], p.metric === "Rank IC" ? 3 : 2)}, {num(p.discovery.ci[1], p.metric === "Rank IC" ? 3 : 2)})
                    </span>
                  </td>
                  <td className={tdNum}>{pValue(p.discovery.holm_p)}</td>
                  <td className={tdNum}>
                    {num(p.replication.estimate, p.metric === "Rank IC" ? 4 : 2)} <span className="text-fg-subtle">({pValue(p.replication.p)})</span>
                  </td>
                  <td className={td}><Badge tone={verdictTone(p.verdict)}>{p.verdict}</Badge></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-fg-muted">
          B003–B005 are machine-learning long/short portfolios run in a margin-research account with illustrative financing and
          borrow costs. Before costs they showed a small, insignificant edge; after costs they lost money in both windows. A
          significant p-value there confirms a negative Sharpe ratio, not an edge.
        </p>
      </Section>

      <Section id="history" title="Earlier hypotheses (A001–A005)" kicker="On a 3-stock universe">
        <TableWrap caption="Earlier hypotheses A001 to A005 and their revisions">
          <thead>
            <tr>
              <th scope="col" className={th}>ID</th>
              <th scope="col" className={th}>Hypothesis</th>
              <th scope="col" className={`${th} text-right`}>Out-of-sample result</th>
              <th scope="col" className={th}>Verdict</th>
              <th scope="col" className={th}>Revision</th>
            </tr>
          </thead>
          <tbody>
            {aSeries.map(([id, h]) => (
              <tr key={id}>
                <th scope="row" className={`${td} font-mono font-normal text-fg`}>{id}</th>
                <td className={`${td} max-w-sm`}>
                  {h.statement}
                  {h.notes?.map((n) => (
                    <span key={n} className="mt-1 block text-xs text-amber">{n.replace(/^Sprint 11: /, "")}</span>
                  ))}
                </td>
                <td className={tdNum}>{h.metric} {num(h.value, 3)}</td>
                <td className={td}><Badge tone={verdictTone(h.verdict)}>{h.verdict}</Badge></td>
                <td className={`${td} text-xs`}>{h.revision ? `${h.revision.from} → ${h.revision.to}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        <p className="mt-3 text-sm leading-relaxed text-fg-muted">
          A001 and A002 were first recorded as promising. After the accounting corrections and an overlap-adjusted significance
          test they were revised to inconclusive, with the change kept in each record&apos;s audit trail. On 106 stocks the A001
          signal was not replicated (B001: rank IC −0.012, inconclusive). A003–A005 were tested under the original simulator,
          before the accounting corrections; the notes below each say how that affects them.
        </p>
      </Section>

      <Section id="leads" title="Exploratory leads" kicker="Not evidence">
        <p className="mb-4 max-w-3xl text-sm leading-relaxed text-fg-muted">
          Eight further signals, each with its expected sign specified in advance, tested in both windows as an exploratory screen
          (Benjamini-Hochberg adjustment, outside the confirmatory family). None replicates convincingly. They are leads only:
          any follow-up must be a new pre-registered hypothesis on data not yet examined.
        </p>
        <TableWrap caption="Exploratory signal screen in the discovery window">
          <thead>
            <tr>
              <th scope="col" className={th}>Feature</th>
              <th scope="col" className={`${th} text-right`}>Horizon (days)</th>
              <th scope="col" className={`${th} text-right`}>Rank IC</th>
              <th scope="col" className={`${th} text-right`}>Unadjusted p</th>
            </tr>
          </thead>
          <tbody>
            {r.exploratory_leads.map((l) => (
              <tr key={l.feature}>
                <th scope="row" className={`${td} font-mono font-normal text-fg`}>{l.feature}</th>
                <td className={tdNum}>{l.horizon}</td>
                <td className={tdNum}>{num(l.estimate, 4, true)}</td>
                <td className={tdNum}>{num(l.p, 3)}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Section>

      <Provenance meta={research.meta} />
    </Container>
  );
}
