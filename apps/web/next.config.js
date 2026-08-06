/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@foreclosuredata/api-client",
    "@foreclosuredata/auth",
    "@foreclosuredata/config",
    "@foreclosuredata/database",
    "@foreclosuredata/foreclosure-core",
    "@foreclosuredata/types",
    "@foreclosuredata/validation",
  ],
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "prisma"],
    // Next's serverless output tracing can't discover Prisma's native
    // query-engine binaries via static import analysis alone, so they must
    // be listed explicitly or Netlify's function bundle ends up missing
    // libquery_engine-*.so.node. The middle `**` matches both a hoisted
    // pnpm layout (node_modules/.prisma/client) and pnpm's default nested
    // virtual store (node_modules/.pnpm/@prisma+client@.../node_modules/
    // .prisma/client) -- which layout actually applies varies by build
    // environment and isn't worth pinning down, so match either.
    outputFileTracingIncludes: {
      "/**": ["../../node_modules/**/.prisma/client/**/*"],
    },
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
    ];
  },
};

module.exports = nextConfig;
