/**
 * Single on/off switch for the investor demo (see apps/web/app/demo/**).
 *
 * When true, the root layout swaps in demo-only chrome (DemoNavbar /
 * DemoFooter instead of the production Navbar / Footer) and skips the
 * production disclaimer banner, mobile bottom nav, and service-worker
 * registration. It does NOT change anything about how any /demo/* page
 * fetches data -- those pages only ever import local fixtures
 * (apps/web/lib/demo/fixtures/**) and never call the database, CAD
 * clients, Anthropic, or billing providers, regardless of this flag.
 *
 * Defaults to false/off. Never enable this in a real deployment --
 * see apps/web/lib/demo/README.md.
 */
export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
