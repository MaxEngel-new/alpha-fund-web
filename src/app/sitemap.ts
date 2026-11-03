import type { MetadataRoute } from "next";
import { analytics } from "@/lib/data";
import { NAV, SITE } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = analytics.meta.generated_at;
  return NAV.map((item) => ({
    url: new URL(item.href, SITE.url).toString(),
    lastModified,
    changeFrequency: "monthly",
    priority: item.href === "/" ? 1 : 0.7,
  }));
}
