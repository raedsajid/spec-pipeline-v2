# Changes

## 2026-09-30 — product recall and scope consolidation (v4)

- Fixed silent omission of products whose names wrap across PDF lines (e.g. "Y-" / "type strainer"): quote verification now ignores line-break whitespace and hyphenation, and short-quote recovery may use up to three consecutive cited lines. Requirement quote checks use the same comparison.
- Prompt now requires every item in compound "Provide A; B; and C" lists and extraction of Part 2 equipment headings such as "Boiler Blowdown Separators or Tanks:".
- Part 1 scope phrases are folded into the matching Part 2 product (shared item noun plus a shared qualifier) and shown as "Also referenced as". When only the scope phrase was extracted, the Part 2 equipment heading becomes the product with a canonical name (e.g. "Boiler Blowdown Separator / Tank"). Unmatched scope products are kept.
- Folded candidates remain resolvable for existing links; linked rows get a "merged into" warning.
- Bumped extraction cache and imported log version to v4; regenerate the submittal log to pick up the fix. Reviewed rows are preserved.

## 2026-09-29 — standalone product semantics and v3 extraction cache

- Product catalog candidates must now be independently identifiable/procurable/submittable items, not merely material nouns or components mentioned inside another product's construction.
- Added `catalogRole` classification for standalone items, constituent materials, attributes, integral components, generic references and unclear candidates.
- Removed permissive legacy defaults: missing entity/usage classification is conservative unless strong source evidence reclassifies the candidate.
- Added relational source checks for construction materials, material modifiers, integral components, generic/collective scope phrases and action-only references without using a material-name blacklist.
- Bumped product/submittal extraction cache and imported log version to v3 so prior v2 product candidates are not silently reused. Existing reviewed rows are preserved; unreviewed extraction is regenerated/imported.
- Added regression coverage for boiler blowdown tanks, constituent carbon/stainless steel, temperature regulating valves, generic assembled accessories, standalone fiberglass insulation and legacy unknown candidates.

## 2026-09-25 — Product assignment and register navigation

- Clicking a register title opens Specs source view instead of the review popup.
- Save to this submittal updates its selected products and preserves its ID/title, with revision conflict protection and renewed review after changes.
- Reopening Groups & Products restores saved selections, including on existing product-generated rows.
- Newly created product rows use the parent title followed by product names. New rows are marked light green for the current project session.
- Source order uses natural document ordering and source evidence position; derived rows follow their parent. Long titles wrap.
- Creation remains idempotent; only newly inserted rows receive the new-row highlight.

## 2026-09-25 — Resilient product quote validation

- Validate catalog products independently so malformed products do not reject valid submittal requirements.
- Expand short product quotes only from verified, explicitly cited source blocks containing the product name.
- Omit unverifiable products with a completion notice and a persistent Activity entry.
- Report invalid mandatory AI extraction fields as an extraction error instead of a form error.
- Regression coverage reproduces short quotes at product indexes 39, 41 and 42.
- Existing saved batches remain compatible. Refresh and retry generation; no re-upload or database migration is required.

## 2026-09-24 — Product submittal workflow

- Automatic specification reading/OCR and chat indexing, with stage progress.
- Left-side project navigation, register search/filter/sort and selected approved-row export.
- Explicit log generation, sourced product groups, combined/individual draft previews and confirmation.
- Side-by-side submittal/product source review with hover/focus highlights and source scrolling.
- Per-specification chat history/retrieval, pending messages and automatic scrolling.
- Separate v2 generation cache excludes recap checklists and deduplicates exact obligations.
- Additive migration retains existing accounts, PDFs, reviews and legacy chats.


## 2026-09-24 — Optional condition compatibility

- Normalize a missing or `null` requirement condition to empty text before
  downstream validation and storage. This resolves the reported
  `requirements.6.condition` and `requirements.8.condition` failures.
- Preserve supplied condition text and all other requirement fields. Numbers,
  objects, arrays, booleans and conditions over 1,500 characters remain invalid.
- Added regression coverage for a nine-record batch with null conditions at
  indexes 6 and 8, absent conditions, and invalid values.

No database migration, cache reset, or re-upload is needed. Refresh BuildERP and
choose **Continue extraction** to retry the failed batch. Previously completed
batches and document reviews are retained.

The source archive includes the complete frontend, backend, migrations, build
scripts, dependency lockfile, tests and documentation. It excludes installed
dependencies, build output, API keys, runtime secrets and uploaded user data.
The backend targets Cloudflare Workers with D1 and R2; other hosting platforms
need corresponding infrastructure changes. See README.md for configuration.

## 2026-09-28 — Compact workspace, editing and continuous source view

- Replaced the submittal review/approval popup with an edit sidebar containing title, type, requirement, condition and product-group checkboxes. Saves use revision checks and document-owned product validation.
- Selected rows can be exported as drafts without an approval step; historical approved exports retain their validation.
- Specifications now use compact list rows and an Upload PDFs button, without the drop banner, PDF icons or redundant action links. The progress header and project summary appear only on Specifications; the duplicated project title/subtitle is removed.
- Chat starts with “Chat with a specification”, renders Markdown, uses the main page scrollbar and includes a question-jump menu.
- Specs source view loads one PDF document and displays continuous pages with nearby-page rendering and source highlighting, without previous/next page controls.
- Type checking, 19 domain tests and API regression checks passed. Browser preview was unavailable in the execution environment, so visual interaction verification remains outstanding.

## 2026-09-28 — specification grouping and product titles
- Combined product submittals retain their parent title; individual product titles remain unchanged. Recognizable old combined titles are corrected on read without overwriting custom titles.
- Resolve section numbers from standalone PDF headings, rejecting narrative cross-references. Apply the correction to saved evidence, register rows and exports without reprocessing PDFs.
- Add minimal collapsible specification dividers with file names and visible item counts.

## 2026-09-29 — structural ownership and product classification
- Adapted layout/marker ideas from the supplied Python parser into the Worker-compatible TypeScript parser. Decimal measurements no longer reset article ownership; evidence carries article, title, paragraph/item paths, typography and uncertainty.
- Recompute structure for cached evidence without changing source IDs, original PDFs or private edits. Product groups and clauses come from source evidence, never model group labels.
- Added candidate type, usage status and conditions. Exclude manufacturers, standards, prohibited and unclear candidates; retain exclusion reasons and existing links for inspection/removal.
- Retained legacy candidate IDs and linked rows; new candidates require explicit classification. Synthetic regression and API tests cover the update; real SCA PDF corpus validation remains needed.

## 2026-09-29 — Vercel migration

- Switched production build/runtime from vinext/Cloudflare Workers to native Next.js on Vercel.
- Replaced D1 bindings with a Turso/libSQL compatibility adapter while retaining the existing SQLite queries.
- Replaced R2 bindings with the S3-compatible R2 API.
- Added direct signed R2 uploads so 10 MB PDFs do not pass through Vercel Function request bodies.
- Changed authenticated PDF delivery to short-lived signed R2 redirects.
- Added automatic schema initialization and v2 compatibility migration.
- Added Vercel/R2/Turso environment and deployment documentation.
