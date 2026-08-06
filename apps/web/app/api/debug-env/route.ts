import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

/**
 * TEMPORARY diagnostic route for debugging the Netlify deploy's Prisma
 * engine resolution — reports real filesystem/env state instead of the
 * opaque generic 500 page. Remove once the underlying issue is fixed.
 */
export async function GET() {
  const info: Record<string, unknown> = {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    hasDirectUrl: Boolean(process.env.DIRECT_URL),
    NETLIFY: process.env.NETLIFY ?? null,
    AWS_LAMBDA_FUNCTION_NAME: process.env.AWS_LAMBDA_FUNCTION_NAME ?? null,
    cwd: process.cwd(),
    dirname: __dirname,
  };

  const candidatePaths = [
    "/var/task",
    "/var/task/node_modules",
    "/var/task/node_modules/.prisma/client",
    "/var/task/node_modules/@prisma/client",
    "/var/task/apps/web/.next/server",
    "/var/task/apps/web/.prisma/client",
    path.join(process.cwd(), "node_modules/.prisma/client"),
    path.join(__dirname, "node_modules/.prisma/client"),
  ];
  info.candidateDirs = candidatePaths.map((p) => {
    try {
      return { path: p, exists: true, files: fs.readdirSync(p).slice(0, 50) };
    } catch (e) {
      return { path: p, exists: false, error: String(e) };
    }
  });

  try {
    const { prisma } = await import("@foreclosuredata/database");
    const count = await prisma.county.count();
    info.dbQuery = { ok: true, count };
  } catch (e) {
    info.dbQuery = { ok: false, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }

  return NextResponse.json(info);
}
