# CloudMaru report design

## Purpose and reading order

Reports are a presentation of a saved consultation, not another generation job. Assess,
Build and Extend use the same report shell and print system. English and Korean are
selected independently of the application cookie. Every report starts with an executive
summary and then, for a full report, provides a detailed appendix.

The executive view is designed for two portrait pages at 100% scale on Letter:
1. Identity, saved date, explicit selected scope, baseline metrics, verdict distribution
   for Assess, and the most material limitations.
2. Priority findings and independent component states for Assess, or saved proposal
   comparison and recommendation for Build/Extend.

The summary intentionally abbreviates descriptive prose and limits the priority table
to five findings. The full selected descriptions, IDs, versions, periods, references,
original amounts, evidence and limits belong in the appendix. Source data is not truncated
or modified. Browser/PDF visual acceptance must confirm pagination; DOM tests cannot prove
physical page fit. Font substitution and printer settings affect pagination.

## Routes and ownership

- `/assessments/[id]/report`: existing pinned assessment and exact roadmap proof reader.
- `/analyses/[id]/report`: saved successful Build record.
- `/extensions/[id]/report`: existing pinned Extend display reader (saved evidence required).

The report follows the saved record's workspace, not whichever workspace is currently
selected. No report service reads a different company's current context to enrich it.
The immutable provenance appendix identifies the owning workspace and saved record.
Reports have no mutation endpoint and do not trigger stale-job recovery, collect Azure
data, call a model, request artifacts, fetch pricing, or recalculate historical prices.
The old Assess Markdown download and its complete saved-evidence document remain intact.

Minimal integration outside the report lane: register the new `reports` domain in both
locale indexes, connect the existing Assess report page, and add a presentation method
sharing the existing verified report read. Saved Build and Extend result views show a
localized "View report" link built by `reportHref` (`src/lib/report/links.ts`). It carries
only the saved record ID, the UI language and the currently selected option (`tier`); it
never names a workspace. The Build preview without a saved ID shows no link.

## Owner identity labels

Each report shows the owning workspace's name and company on the cover and in the
provenance block, next to the immutable owner workspace ID. Lookup semantics:
- The workspace row is read once, by the `workspaceId` stored on the saved record (Assess
  parent, Build analysis, pinned Extend result). The current-workspace cookie is never read,
  so a report opened while another company is selected still shows its own owner.
- The labels are the row's current stored `name` and `company_name`, not a snapshot. If the
  workspace is renamed later, later reports show the new labels; saved evidence (including
  the stored workspace ID) does not change and nothing is written on read.
- A missing row, or a row whose ID differs from the saved one, fails closed as
  "report unavailable"; labels are never guessed from resource IDs or another workspace.
  An unset company is shown as "Not set".
- The same labels are inserted after the workspace ID in the Assess evidence document, so
  the existing Markdown download carries them too (as fenced, inert text).
The synthetic demo seed stores workspace "Synthetic offline demo" and company "Synthetic
examples only · 합성 예제 전용", which therefore appear in demo reports and PDFs.

The Assess summary names the affected resource next to each priority finding. The
full report's Evidence and provenance section includes a table of configuration
relationships from the saved source scan, with a note about collection limits.

## Scope contract

`lang=en|ko`, `scope=summary|full`, comma-separated `sections`, and the
applicable filters are serialized in GET URLs. Defaults are full report and every
section that applies to the report kind (Assess: findings, roadmap, Advisor, cost, changes,
sources, evidence; Build/Extend: proposal, sources, evidence). A section that does not apply
to the kind is rejected like any other invalid value, and the form's hidden section field
only carries applicable sections. Assess supports
`severity` and `pillar`; proposal reports support `tier=all|low|balanced|ha`. Invalid,
repeated, unknown or inapplicable filter values fail before a database read. Section
checkboxes update a single hidden query field so repeated HTTP query keys are not
ambiguous. Language links preserve scope and filters.

The printed scope block states selected sections, exact filters and displayed/total item
counts. Baseline metrics and the verdict chart always use the entire saved finding set;
the chart explicitly says so. Findings and their evidence are filtered together. An empty
selection result does not establish a healthy environment or zero costs. A section-only
report explicitly lists which sections it includes. Selecting references independently
includes pinned catalog references without requiring the full evidence section.

## Evidence and money

- Assess verdicts are saved code verdicts, never model classifications. Rule titles and
  remediation come from the pinned catalog. Unknown is an unresolved evidence gap.
- Coverage, source scan completeness, unavailable/partial/not-requested components and
  reason codes remain visible. Report filtering is distinct from collection completeness.
- Actual billing currencies are displayed separately. No conversion or cross-currency
  sum is introduced. Signed credits and small nonzero values remain intact in evidence.
- Assess executive cost totals use the same `normalizeCostTotalForDisplay` as the result
  view and appendix (aggregate float residue below the saved rows' precision is removed).
  Nonzero amounts below 0.01 keep their saved value in locale fixed-decimal form (up to 17
  significant digits), never scientific notation.
- Extend change rows show quantity with the catalog unit, check reasons use the Extend
  wording, and incremental amounts use the saved cost currency.
- Proposal totals and line amounts come directly from saved results. Two-decimal display
  is formatting only; original amounts remain in the full appendix. No repricing occurs.
- Extend estimates describe only new items and usage increases. Existing resource costs
  are excluded. A partial estimate is a subtotal; an unavailable estimate is not zero.
- Raw observations pass through the existing inventory display redactor. Strings render
  as React text, without HTML/Markdown execution or automatic URL linking. Clickable
  references come only from saved catalog-backed source fields.

## Visual and accessibility system

White paper, dark evergreen ink, a fine green rule and quiet tinted panels form the shared
visual system. Large titles and compact numeric blocks establish hierarchy. Long resource
identifiers stay in the appendix. All tables have captions, column headers and row headers.
The verdict chart has a semantic numeric table, explicit count/denominator text and bars
marked decorative; neither color nor width is required to understand it. Controls have
visible focus and labels. Korean uses the application's existing local font stack.

Print CSS hides the application navigation and controls, removes screen card borders,
repeats table header groups, avoids row splitting and orphaned headings, allows long raw
blocks to paginate, and wraps long IDs/URLs. Print CSS sets Letter portrait (8.5 × 11 in). Old report URLs with a paper parameter still open and print on Letter.

## Validation and parent visual QA handoff

Synthetic unit/route fixtures cover immutable projections, original money, owner binding,
independent references, filtering/denominators, malformed scope, no-data and inert content.
The real PGlite report-service test verifies the new presentation uses the existing proof
reader without changing saved assessment rows or calling external transports.

Required parent QA uses one browser session, no company data or live APIs:
- Assess, Build and Extend, EN and KO, summary and full, on Letter at 100%.
- Render every PDF page to PNG and inspect all pages (PDF skill principle). Text extraction
  alone cannot detect clipping, overlap, broken glyphs or unexpected blank pages.
- Check executive page count, appendix starts, repeated headers, URL/ID wrapping, small
  screens, keyboard focus, filtered/empty and partial/unavailable cost states.
- Compare displayed values to the synthetic saved fixture and confirm no read mutations.

This worker does not drive the browser or produce PDFs; root owns that acceptance step.
