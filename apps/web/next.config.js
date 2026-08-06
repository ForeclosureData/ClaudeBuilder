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
    // With node-linker=hoisted, the generated Prisma Client (including its
    // native query-engine binaries) lands in the repo-root node_modules.
    // Next's serverless output tracing can't discover those binaries via
    // static import analysis alone, so they must be listed explicitly or
    // Netlify's function bundle ends up missing libquery_engine-*.so.node.
    outputFileTracingIncludes: {
      "/**": ["../../node_modules/.prisma/client/**/*"],
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
