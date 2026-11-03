"use client";

import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface Props {
  rows: { method: string; label: string; worst: number; best: number }[];
  alpha: number;
}

export function InferenceChart({ rows, alpha }: Props) {
  const summary = rows.map((r) => `${r.label}: ${(r.best * 100).toFixed(1)}% to ${(r.worst * 100).toFixed(1)}%`).join("; ");
  return (
    <figure>
      <figcaption className="mb-2 text-sm text-fg-muted">
        Worst-case simulated false-positive rate by test (nominal {alpha * 100}%, dashed line)
      </figcaption>
      <div className="h-64" role="img" aria-label={`Simulated false-positive rates at a nominal ${alpha * 100}%: ${summary}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
            <CartesianGrid stroke="#223049" strokeDasharray="3 6" horizontal={false} />
            <XAxis type="number" tickFormatter={(v: number) => `${Math.round(v * 100)}%`} tick={{ fill: "#7d8aa1", fontSize: 11 }} stroke="#223049" />
            <YAxis type="category" dataKey="label" width={150} tick={{ fill: "#a3afc2", fontSize: 12 }} stroke="#223049" />
            <Tooltip
              cursor={{ fill: "rgba(46,196,182,0.06)" }}
              contentStyle={{ background: "#0a1120", border: "1px solid #223049", borderRadius: 8, fontSize: 12 }}
              formatter={(v) => [`${(Number(v) * 100).toFixed(1)}%`, "worst case"]}
            />
            <ReferenceLine x={alpha} stroke="#e3b866" strokeDasharray="4 4" />
            <Bar dataKey="worst" fill="#7aa2d6" radius={[0, 4, 4, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
