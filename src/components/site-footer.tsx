import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { analytics } from "@/lib/data";
import { shortDate } from "@/lib/format";
import { DISCLAIMER, NAV, SITE } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-line/70 bg-ink-950/70">
      <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8">
        <div className="flex gap-3 rounded-xl border border-amber/30 bg-amber/[0.05] p-4" role="note" aria-label="Disclaimer">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber" aria-hidden />
          <p className="text-sm leading-relaxed text-fg-muted">{DISCLAIMER}</p>
        </div>
        <div className="mt-8 grid gap-8 sm:grid-cols-[1fr_auto]">
          <div>
            <p className="font-serif text-lg text-fg">{SITE.name}</p>
            <p className="mt-1 max-w-md text-sm text-fg-muted">
              An independent research initiative. Not a hedge fund, investment adviser, broker, or investment-management service.
            </p>
            <p className="mt-3 text-xs text-fg-subtle">
              Data exported {shortDate(analytics.meta.generated_at)} from research code commit {analytics.meta.backend_commit}.
            </p>
          </div>
          <nav aria-label="Footer">
            <ul className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="text-fg-muted hover:text-fg">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </div>
    </footer>
  );
}
