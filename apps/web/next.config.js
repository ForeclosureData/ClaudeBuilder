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
    // @napi-rs/canvas ships a native .node binary and pdfjs-dist ships a
    // .wasm file (both used only by the Hidalgo PDF-splitting adapter) --
    // webpack can't parse either as a JS module, so they must be excluded
    // from bundling the same way Prisma's native engine is below.
    serverComponentsExternalPackages: ["@prisma/client", "prisma", "@napi-rs/canvas", "pdfjs-dist", "pdf-lib"],
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
    // actually applies varies by build environment. The same applies to
    // @napi-rs/canvas's platform-specific native binary and pdfjs-dist's
    // wasm/ directory (only reachable via a runtime require.resolve(), which
    // static tracing can't follow either).
    outputFileTracingIncludes: {
      "/**": [
        "../../node_modules/.prisma/client/libquery_engine-*.so.node",
        "../../node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client/libquery_engine-*.so.node",
        "../../node_modules/@napi-rs/canvas-linux-x64-gnu/*.node",
        "../../node_modules/.pnpm/@napi-rs+canvas-linux-x64-gnu@*/node_modules/@napi-rs/canvas-linux-x64-gnu/*.node",
        "../../node_modules/pdfjs-dist/wasm/*",
        "../../node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/wasm/*",
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
