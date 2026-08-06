export default function DisclaimersPage() {
  return (
    <div className="container-page max-w-3xl py-16">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Disclaimers</h1>
      <div className="mt-6 space-y-4 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
        <p>
          ForeclosureData is an information and research platform. It is not a law firm, title
          company, or financial advisor, and nothing on this site is legal, financial, title, or
          investment advice.
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Information comes from public records and automated extraction from scanned and PDF documents.</li>
          <li>Data may be incomplete, delayed, or incorrect. Automated extraction and OCR are not perfect.</li>
          <li>
            You must independently verify foreclosure status, title, liens, current loan balance,
            occupancy, and auction details before relying on any record — including with the county
            clerk, the trustee, and a title company.
          </li>
          <li>Estimated remaining balances are calculations based on stated assumptions, not payoff statements. They do not reflect fees, advances, missed payments, taxes, or insurance.</li>
          <li>Estimated equity is not guaranteed and is only as accurate as the appraised/market value and balance estimate it is based on.</li>
          <li>A listed foreclosure sale may be postponed, canceled, or replaced by an amended notice at any time, including on the sale date itself.</li>
          <li>We do not provide legal, financial, title, or investment advice. Consult qualified professionals before purchasing property.</li>
          <li>We do not claim any data is real-time; each record shows when it was last verified.</li>
        </ul>
        <p>
          Found something wrong? Use the &ldquo;Report incorrect information&rdquo; action on any
          property record — every report is reviewed.
        </p>
      </div>
    </div>
  );
}
