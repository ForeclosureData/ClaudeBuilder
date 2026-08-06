/**
 * Interface for a county appraisal district data connector. Address
 * resolution compares legal-description fields and owner name against
 * these records — it never assumes the notice's stated mailing address is
 * the property address.
 *
 * Hidalgo's real appraisal-district access method (public export vs. an
 * API vs. scraping) is unresolved — see docs/ARCHITECTURE.md §14. This mock
 * lets the resolver be built and tested against fixtures now.
 */
export interface AppraisalRecord {
  propertyIdNumber: string;
  geographicId: string | null;
  ownerName: string;
  situsAddress: string;
  city: string;
  zipCode: string;
  subdivision: string | null;
  lot: string | null;
  block: string | null;
  acreage: number | null;
  appraisedValueCents: number | null;
}

export interface AppraisalDistrictConnector {
  findByLegalDescription(params: {
    subdivision?: string | null;
    lot?: string | null;
    block?: string | null;
    acreage?: number | null;
  }): Promise<AppraisalRecord[]>;
  findByOwnerName(ownerName: string): Promise<AppraisalRecord[]>;
  findByPropertyId(propertyId: string): Promise<AppraisalRecord | null>;
}

/** Fixture-backed mock connector — fabricated demo records only. */
export class MockAppraisalDistrictConnector implements AppraisalDistrictConnector {
  constructor(private readonly records: AppraisalRecord[]) {}

  async findByLegalDescription(params: {
    subdivision?: string | null;
    lot?: string | null;
    block?: string | null;
    acreage?: number | null;
  }): Promise<AppraisalRecord[]> {
    return this.records.filter((r) => {
      const subdivisionMatches =
        !params.subdivision || normalize(r.subdivision) === normalize(params.subdivision);
      const lotMatches = !params.lot || normalize(r.lot) === normalize(params.lot);
      const blockMatches = !params.block || normalize(r.block) === normalize(params.block);
      return subdivisionMatches && lotMatches && blockMatches;
    });
  }

  async findByOwnerName(ownerName: string): Promise<AppraisalRecord[]> {
    const target = normalize(ownerName);
    return this.records.filter((r) => normalize(r.ownerName).includes(surname(target)));
  }

  async findByPropertyId(propertyId: string): Promise<AppraisalRecord | null> {
    return this.records.find((r) => r.propertyIdNumber === propertyId) ?? null;
  }
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().trim();
}

function surname(fullNameLower: string): string {
  const parts = fullNameLower.split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] ?? fullNameLower;
}
