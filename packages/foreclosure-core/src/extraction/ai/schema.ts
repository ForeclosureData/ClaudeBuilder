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

export type AiExtractionFieldName = keyof AiExtractionResponse;

/** Per-field zod schemas, keyed by field name — lets the caller validate each of the 18 fields independently instead of all-or-nothing. */
export const AI_EXTRACTION_FIELD_SCHEMAS: { [K in AiExtractionFieldName]: z.ZodTypeAny } = {
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
};

export const AI_EXTRACTION_FIELD_NAMES = Object.keys(AI_EXTRACTION_FIELD_SCHEMAS) as AiExtractionFieldName[];

const extractedValueJsonSchema = (valueSchema: Record<string, unknown>) => ({
  type: "object",
  properties: {
    value: valueSchema,
    explicitlyStated: { type: "boolean", description: "True only if the value is printed verbatim (allowing minor OCR noise) in the text." },
    confidence: { type: "number", minimum: 0, maximum: 1, description: "Your certainty in this value, 0 to 1." },
    supportingText: { type: ["string", "null"], description: "The short snippet this value was based on, or null if the field is null/empty." },
    pageNumber: { type: ["integer", "null"], description: "1 unless the text clearly indicates a later page." },
  },
  required: ["value", "explicitlyStated", "confidence", "supportingText", "pageNumber"],
});

const stringArrayValue = (description: string) =>
  extractedValueJsonSchema({
    type: "array",
    items: { type: "string" },
    description: `${description} Return an empty array [] if none can be determined -- never omit this key from the response.`,
  });

const stringValue = (description: string) =>
  extractedValueJsonSchema({ type: ["string", "null"], description: `${description} Return null if not determinable -- never omit this key.` });

const numberValue = (description: string) =>
  extractedValueJsonSchema({ type: ["number", "null"], description: `${description} Return null if not determinable -- never omit this key.` });

const BORROWER_GRANTOR_TERMINOLOGY = `Texas trustee's-sale notices refer to the original homeowner/borrower using several interchangeable labels depending on the template: "Borrower", "Grantor(s)", "Trustor(s)", "Mortgagor(s)", or a combined label like "Grantor(s)/Mortgagor(s)". Some notices state this only in narrative prose, e.g. "the Deed of Trust executed by JOHN DOE AND JANE DOE, HUSBAND AND WIFE" or "NAME executed a Deed of Trust". A notice may list one person, a married couple ("HUSBAND AND WIFE"), or multiple unrelated borrowers joined by "AND". Strip marital-status descriptors ("HUSBAND AND WIFE", "AN UNMARRIED MAN", "AN UNMARRIED WOMAN") -- they are not names. Do NOT confuse the borrower/grantor with: the lender/original mortgagee (who made the loan, often introduced via a "Mortgage Electronic Registration Systems, Inc. ... as nominee for X" clause, where X is the mortgagee, not MERS and not the borrower), the current mortgagee/noteholder/beneficiary (who now owns the debt and is foreclosing), the mortgage servicer (administers the loan, rarely the same as the mortgagee), the substitute trustee (conducts the sale on the lender's behalf), the attorney/law firm named in the notice, or the county clerk. borrowerNames and grantorNames refer to the SAME people (the original homeowner(s)) -- populate both identically.`;

/**
 * JSON Schema for the Anthropic tool-use call in extractWithAI.ts. Mirrors
 * `aiExtractionResponseSchema` field-for-field. Giving the model this
 * schema directly (via a tool definition) is the fix for the root cause
 * of the 9/9 fallback failures observed in the fresh 25-notice test: the
 * previous plain-text call never included the schema anywhere in the
 * prompt, so the model had no machine-readable list of required field
 * names and silently omitted the two fields the system prompt happened
 * not to narrate by name (borrowerNames, grantorNames).
 */
export const AI_EXTRACTION_TOOL_NAME = "extract_foreclosure_notice_fields";

export const AI_EXTRACTION_TOOL_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    borrowerNames: stringArrayValue(`The original borrower(s)/homeowner(s) who signed the Deed of Trust. ${BORROWER_GRANTOR_TERMINOLOGY}`),
    grantorNames: stringArrayValue(`Same people as borrowerNames -- the Grantor(s)/Trustor(s)/Mortgagor(s). ${BORROWER_GRANTOR_TERMINOLOGY}`),
    lenderName: stringValue("Equal to currentMortgagee when known, else originalMortgagee, else null."),
    originalMortgagee: stringValue(
      'Who originally made the loan -- often named via a "Mortgage Electronic Registration Systems, Inc. ... as nominee for X" clause (X is the originalMortgagee, not MERS).',
    ),
    currentMortgagee: stringValue("Who currently owns/holds the note and is actually foreclosing. Distinct from originalMortgagee unless the text says they are the same."),
    mortgageServicer: stringValue("Who administers the loan on the current mortgagee's behalf -- often a different company than the mortgagee."),
    originalPrincipalAmount: numberValue("The original loan principal in dollars (not cents). Only from an explicit figure in the text, never estimated."),
    currentPrincipalBalance: numberValue("The current unpaid balance in dollars (not cents). Only from an explicit figure in the text, never calculated or inferred."),
    deedOfTrustDate: stringValue("The date the Deed of Trust was executed/signed."),
    instrumentNumber: stringValue("The recording instrument number."),
    recordingDate: stringValue("The date the Deed of Trust was recorded with the county clerk."),
    propertyAddress: stringValue("The property's street address, only if explicitly stated. Never inferred from a legal description."),
    legalDescription: stringValue("The property's legal description (subdivision/lot/block or metes-and-bounds)."),
    propertyId: stringValue("The county appraisal district property ID or geographic ID, if stated."),
    saleDate: stringValue("The foreclosure sale date."),
    saleTime: stringValue("The foreclosure sale time."),
    saleLocation: stringValue("Where the sale will take place."),
    substituteTrustee: stringArrayValue("The substitute trustee(s) conducting the sale -- distinct from the borrower/grantor and from the lender."),
  },
  required: AI_EXTRACTION_FIELD_NAMES,
};

export const AI_EXTRACTION_SYSTEM_PROMPT = `You extract structured facts from a single Texas foreclosure "Notice of Trustee's Sale" document by calling the ${AI_EXTRACTION_TOOL_NAME} tool exactly once. Follow these rules exactly:
- Call the tool with every field it requires. Unknown is valid -- fabrication is not. If you cannot determine a field, use null for a single value or [] for a name-list field. Never omit a required key.
- Never invent or infer a property address. If none is stated, propertyAddress.value must be null.
- Never calculate or infer currentPrincipalBalance or originalPrincipalAmount unless a dollar figure is explicitly printed in the text. Do not estimate them.
- ${BORROWER_GRANTOR_TERMINOLOGY}
- originalMortgagee, currentMortgagee, and mortgageServicer are three DISTINCT parties -- never assume any two of them are the same entity unless the text says so.
- For every field, set explicitlyStated to true only if the value is printed verbatim (allowing for minor OCR noise) in the text.
- For every field, include the short supportingText snippet you based the value on, or null if the field is null/empty.
- Provide a confidence score (0 to 1) for every field reflecting your certainty, not just whether a value exists.
- pageNumber should be 1 unless the text clearly indicates a later page.`;
