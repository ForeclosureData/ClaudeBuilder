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
    // mupdf ships a single WASM blob (10MB) that webpack can't parse as a
    // JS module and shouldn't try to bundle — exclude it the same way
    // Prisma's native query engine is below. (Replaces an earlier
    // pdfjs-dist + @napi-rs/canvas rendering path that rendered correctly
    // in local testing but produced blank pages in the actual deployed
    // Lambda — see pdfRender.ts.)
    serverComponentsExternalPackages: ["@prisma/client", "prisma", "mupdf", "pdf-lib"],
    // Next's serverless output tracing can't discover Prisma's native
    // query-engine binaries via static import analysis alone, so they must
    // be listed explicitly or Netlify's function bundle ends up missing
    // libquery_engine-*.so.node. Only the binaries themselves are matched
    // (not `**/*`, which previously also swept up .prisma/client/index.d.ts
    // -- a TypeScript-only ambient declaration file with no runtime values,
    // which esbuild then failed to parse as JS while bundling the function).
    // Two patterns cover both a hoisted pnpm layout (node_modules/.prisma/
    // client) and pnpm's default nested virtual store (node_modules/.pnpm/
    // @prisma+client@<version>/node_modules/.prisma/client) -- which layout
    // actually applies varies by build environment. mupdf's dist/ folder
    // (its wasm blob + loader) is traced the same way for the same reason.
    outputFileTracingIncludes: {
      "/**": [
        "../../node_modules/.prisma/client/libquery_engine-*.so.node",
        "../../node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client/libquery_engine-*.so.node",
        "../../node_modules/mupdf/dist/*",
        "../../node_modules/.pnpm/mupdf@*/node_modules/mupdf/dist/*",
      ],
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
