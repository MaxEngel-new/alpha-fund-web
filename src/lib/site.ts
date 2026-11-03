export const SITE = {
  name: "Alpha Fund",
  tagline: "Independent quantitative research. Evidence over assumptions.",
  description:
    "An independent quantitative research initiative exploring systematic portfolio construction, machine learning, risk management, and evidence-based investment strategies.",
  url: process.env.SITE_URL ?? "http://localhost:3000",
};

export const DISCLAIMER =
  "Alpha Fund is an independent research project. All published results are for educational and research purposes only and do not constitute investment advice. Historical backtests are exploratory and are not indicative of future performance. No investment returns are guaranteed.";

export const NAV = [
  { href: "/", label: "Overview" },
  { href: "/analytics", label: "Portfolio Analytics" },
  { href: "/research", label: "Research Lab" },
  { href: "/roadmap", label: "Roadmap" },
  { href: "/prospective", label: "Prospective Monitor" },
  { href: "/methodology", label: "Methodology" },
] as const;
