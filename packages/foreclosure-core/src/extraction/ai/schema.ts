import { z } from "zod";

const extractedValue = <T extends z.ZodTypeAny>(inner: T) =>
  z.object({
    value: z.union([inner, z.null()]),
    explicitlyStated: z.boolean(),
    confidence: z.number().min(0).max(1),
    supportingText: z.union([z.string(), z.null()]),
    pageNumber: z.union([z.number().int(), z.null()]),
  });

/**
 * Strict schema the AI model's JSON response must satisfy. Anything that
 * fails this validation is discarded (never written to the database) and
 * the field stays whatever Layer 1 produced — the model is never trusted
 * to invent a shape.
 */
export const aiExtractionResponseSchema = z.object({
  borrowerNames: extractedValue(z.array(z.string())),
  grantorNames: extractedValue(z.array(z.string())),
  lenderName: extractedValue(z.string()),
  originalMortgagee: extractedValue(z.string()),
  currentMortgagee: extractedValue(z.string()),
  mortgageServicer: extractedValue(z.string()),
  originalPrincipalAmount: extractedValue(z.number()),
  currentPrincipalBalance: extractedValue(z.number()),
  deedOfTrustDate: extractedValue(z.string()),
  instrumentNumber: extractedValue(z.string()),
  recordingDate: extractedValue(z.string()),
  propertyAddress: extractedValue(z.string()),
  legalDescription: extractedValue(z.string()),
  propertyId: extractedValue(z.string()),
  saleDate: extractedValue(z.string()),
  saleTime: extractedValue(z.string()),
  saleLocation: extractedValue(z.string()),
  substituteTrustee: extractedValue(z.array(z.string())),
});

export type AiExtractionResponse = z.infer<typeof aiExtractionResponseSchema>;

export const AI_EXTRACTION_SYSTEM_PROMPT = `You extract structured facts from a single Texas foreclosure "Notice of Trustee's Sale" document. Follow these rules exactly:
- Return ONLY JSON matching the provided schema. No prose, no markdown fences.
- Return null for any field not clearly present in the text. Never invent a value.
- Never invent or infer a property address. If none is stated, propertyAddress.value must be null.
- Never calculate or infer currentPrincipalBalance unless a balance figure is explicitly printed in the text. Do not estimate it.
- originalMortgagee, currentMortgagee, and mortgageServicer are three DISTINCT parties -- never assume any two of them are the same entity unless the text says so. originalMortgagee is who made the loan (often named via a "Mortgage Electronic Registration Systems, Inc. ... as nominee for X" clause -- X, not MERS, is the originalMortgagee). currentMortgagee is who currently owns/holds the note and is actually foreclosing. mortgageServicer administers the loan on the current mortgagee's behalf and is often a different company. lenderName should equal currentMortgagee when known, else originalMortgagee, else null.
- For every field, set explicitlyStated to true only if the value is printed verbatim (allowing for minor OCR noise) in the text.
- For every field, include the short supportingText snippet you based the value on, or null if the field is null.
- Provide a confidence score (0 to 1) for every field reflecting your certainty, not just whether a value exists.
- pageNumber should be 1 unless the text clearly indicates a later page.`;
