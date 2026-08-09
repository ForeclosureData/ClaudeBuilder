/**
 * ONE-OFF diagnostic (not part of production code): calls the current
 * Anthropic tool-use extraction exactly once against HID-117888's stored
 * rawText and prints the RAW (unvalidated) tool_use.input verbatim, so the
 * "why did every one of 18 fields fail validation" mystery from the
 * second fresh-25 batch can be diagnosed from real data instead of
 * guessed at. Deleted after use -- see docs/DEPLOYMENT.md for what this
 * found.
 */
import { prisma } from "@foreclosuredata/database";
import { AI_EXTRACTION_SYSTEM_PROMPT, AI_EXTRACTION_TOOL_INPUT_SCHEMA, AI_EXTRACTION_TOOL_NAME } from "@foreclosuredata/foreclosure-core/src/extraction/ai/schema";

async function main() {
  const doc = await prisma.sourceDocument.findFirst({ where: { countyFilingNumber: "117888" }, select: { rawText: true } });
  if (!doc?.rawText) throw new Error("HID-117888 rawText not found");

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    max_tokens: 4096,
    model: process.env.AI_EXTRACTION_MODEL ?? "claude-sonnet-5",
    system: AI_EXTRACTION_SYSTEM_PROMPT,
    tools: [{ name: AI_EXTRACTION_TOOL_NAME, description: "Records the structured fields extracted from the foreclosure notice.", input_schema: AI_EXTRACTION_TOOL_INPUT_SCHEMA }],
    tool_choice: { type: "tool", name: AI_EXTRACTION_TOOL_NAME },
    messages: [{ role: "user", content: doc.rawText }],
  });

  console.log("=== stop_reason ===");
  console.log(response.stop_reason);
  console.log("=== usage ===");
  console.log(JSON.stringify(response.usage));
  console.log("=== full content blocks ===");
  console.log(JSON.stringify(response.content, null, 2));

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("FATAL:", err instanceof Error ? err.message : String(err));
  await prisma.$disconnect();
  process.exitCode = 1;
});
