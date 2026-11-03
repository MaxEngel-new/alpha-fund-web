import Link from "next/link";
import { Container } from "@/components/ui";

export default function NotFound() {
  return (
    <Container className="py-24">
      <p className="text-xs uppercase tracking-[0.2em] text-teal">404</p>
      <h1 className="mt-3 font-serif text-4xl text-fg">Page not found</h1>
      <p className="mt-3 text-fg-muted">The page you were looking for does not exist.</p>
      <Link href="/" className="mt-6 inline-block text-teal hover:underline">Back to the overview</Link>
    </Container>
  );
}
