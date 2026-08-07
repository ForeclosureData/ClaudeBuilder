# ForeclosureData Product & UX Roadmap

> Product backlog for later. Do not implement anything in this document
> unless it is already required for backend functionality. The immediate
> engineering priority remains: Hidalgo ingestion reliability, extraction
> accuracy, address/property resolution, county appraisal enrichment,
> publication logic, and automated refresh/archival. Whenever frontend
> work begins later, consult this file first and update it as product
> decisions evolve.

## Core product philosophy

ForeclosureData should help a real estate investor decide within
approximately 10–15 seconds whether a foreclosure is worth investigating.

The product should NOT feel like:
- a county records website
- a legal document database
- enterprise software
- a CRM

It should feel closer to:
- Zillow
- BiggerPockets
- LandGlide
- modern consumer property-search software

The product sells TIME and INFORMATION CLARITY.

Core value proposition:

"Stop reading 700-page foreclosure PDFs."

Alternative positioning:

"Find foreclosure opportunities in minutes, not hours."

"Every foreclosure notice. Organized and searchable."

## Investor-priority information

The most important information should appear first.

Tier 1 / investor decision fields:

1. Property address
2. Foreclosure sale date
3. County
4. Original principal / loan amount
5. Current owner / borrower
6. County Market Value
7. County Appraised Value
8. Estimated Equity, only when responsibly calculable
9. Original source notice

Lender/beneficiary information is enrichment and should NOT normally
block publication.

Trustee information is enrichment.

Legal-document metadata is secondary.

## Publication philosophy

Do not hide an otherwise useful foreclosure record simply because a
secondary enrichment field is missing.

Critical publication fields should eventually center around:

- valid source notice
- valid county
- valid foreclosure sale date
- property address or sufficiently confident property resolution
- no known cancellation
- no critical property-identity conflict

Potentially non-blocking enrichment:

- lender
- beneficiary
- servicer
- trustee phone
- complete appraisal data
- estimated equity
- original principal if unavailable
- property characteristics

Exact publication rules remain a backend/product decision and should
prioritize avoiding false property matches.

## County page

Design the county page around investor opportunity discovery.

Top summary examples:

```
Hidalgo County

283 Active Foreclosures

Next Sale:
September 1, 2026
```

Possible summary metrics later:

- Active foreclosures
- Residential count
- Commercial count
- County value represented
- Average county value
- Average original loan
- Average estimated equity
- Newly added notices
- Recently updated notices

Do not build misleading aggregate statistics when underlying data is
incomplete.

## Foreclosure cards

Desktop and mobile should prioritize property cards over legal-data
tables.

Example structure:

```
123 Main St
McAllen, TX

Sale Date          September 1
County Market Value    $338,000
Original Loan          $245,000
Estimated Equity        ~$93,000
Owner                   John Smith
Property Type      Single Family

[View Details]  [Save]
```

Secondary information should not overwhelm the card.

## Investor filters

Future filtering should include:

- County
- City
- ZIP
- Sale date
- Next auction
- Property type
- Residential
- Commercial
- Land
- County Market Value
- County Appraised Value
- Original loan range
- Estimated equity range
- Owner
- Subdivision
- Address
- Newly added
- Recently updated
- Saved only

Filters should be simple enough for non-technical investors.

## Property detail page

The top of the property page should be an **Investment Snapshot**:

- Address
- Sale date
- Days until sale
- Current owner / borrower
- Original principal
- County Market Value
- County Appraised Value
- Estimated equity if available
- Property type
- Save button
- Source notice link

Below, **Property**:

- Parcel ID
- GEO ID
- Legal description
- Subdivision
- Lot
- Block
- Acreage
- Land value
- Improvement value
- Tax year
- Property characteristics when available

Below, **Foreclosure Details**:

- Recording date
- Trustee
- Lender/beneficiary
- Servicer
- Instrument number
- Original foreclosure notice

The legal document is supporting evidence, not the primary UX.

## Estimated equity

When available:

```
Estimated Equity
$XX,XXX

Based on:
County Market Value: $XXX,XXX
Estimated Remaining Loan Balance: $XXX,XXX
```

Always disclose methodology.

Never imply estimated equity is guaranteed equity, auction profit, or
verified payoff.

## Visual prioritization

Eventually use simple visual cues.

Possible concepts:

- High potential equity
- Moderate potential equity
- Low/unknown potential equity

Do not create misleading red/yellow/green investment recommendations
until the underlying methodology is mature.

Colors should help users scan information, not imply guaranteed
investment quality.

## Opportunity Score — FUTURE

Potential future feature:

```
Opportunity Score
0–100
```

Possible inputs:

- estimated equity
- county value
- loan amount
- property type
- data completeness
- sale-date proximity
- property-resolution confidence

This should NOT be implemented until we define a defensible
methodology.

It must never imply guaranteed investment performance.

## Map view — HIGH-PRIORITY FUTURE FEATURE

Create a Zillow/LandGlide-style map.

Users should eventually be able to see foreclosure properties
geographically.

Potential pin information:

- property address
- sale date
- county value
- original loan
- estimated equity

Clicking a pin opens a property preview.

Map view and list view should stay synchronized.

## Saved properties

Simple heart/save functionality.

Future: **My Watchlist**.

Saved properties should make it easy to follow properties before the
auction.

## Alerts

Future alerts:

- New foreclosure in selected county
- New commercial foreclosure
- Sale date changed
- Sale canceled
- Saved property's auction approaching
- Property address resolved
- County value updated

## Mobile-first design

ForeclosureData should eventually work extremely well while an investor
is driving neighborhoods or evaluating properties in the field.

Mobile property snapshot:

```
Address

Sale:              September 1
Owner:             John Smith
Original Loan:     $212k
County Value:      $338k
Estimated Equity:  $91k

[Map]  [Save]  [Source Notice]
```

Avoid tiny desktop tables on mobile.

## Homepage

Potential headline:

"Find Foreclosures in Seconds, Not Hours."

Supporting copy:

"ForeclosureData turns hundreds of pages of county foreclosure notices
into searchable property opportunities with addresses, sale dates, loan
amounts, county values, and original source documents."

Large county search:

"Search a county…"

No login required to understand the product.

## Free/public preview

Visitors should be allowed to:

- search supported counties
- see that foreclosure inventory exists
- see auction dates
- see limited sample information

Premium information may be locked.

Do not require an account before users understand what the product
does.

## Pricing — NOT FINAL

Current working pricing idea:

- County Plan: $7/month
- Texas Unlimited: $27/month

Monthly and annual billing.

Potential annual pricing:

- County: $70/year
- Texas Unlimited: $270/year

Founding users: first 100 approved users receive 3 months free.

New-user trial: 7 days.

**PRICING IS NOT FINAL.**

Before launch, research LandGlide's current pricing and seriously
consider matching or benchmarking against LandGlide because it targets
a similar property-investor / property-data audience and has
established consumer pricing expectations.

Do NOT change pricing automatically.

Create a future pricing-analysis task comparing:

- LandGlide
- PropStream
- PropertyRadar
- BatchLeads
- DealMachine
- other foreclosure/property-data products

Evaluate:

- monthly price
- annual price
- trial length
- individual vs professional plans
- app-store pricing
- features included

## Future expansion

Initial: Hidalgo County.

Then: additional Texas counties.

Eventually: nationwide.

Potential future datasets:

- foreclosure sales
- tax sales
- REO
- probate
- liens
- distressed commercial
- other public-record property opportunities

Do not let these future categories distract from getting foreclosure
data excellent first.

## Brand direction

Brand: ForeclosureData

Domain: foreclosuredata.net

Visual direction: clean real-estate/data technology brand.

Current preferred general color direction: navy / blue / white / subtle
gray.

User mentioned liking the general color family / feel associated with
BiggerPockets.

Do not directly copy another company's protected brand assets, logo, or
exact design system.

Desired brand characteristics:

- trustworthy
- simple
- data-driven
- investor-focused
- modern
- affordable
- fast

## Later UX success metric

The central UX question should always be:

"Can an investor determine whether this property deserves further
research in 10–15 seconds?"

If the answer is no, simplify.
