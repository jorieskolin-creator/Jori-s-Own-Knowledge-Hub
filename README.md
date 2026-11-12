# Jori's Own Knowledge Hub

Live site: https://jori-knowledge-hub.vercel.app/

## Application status (v1.1)
- Six categories with on-demand HTML discovery from Public and Private Vercel Blob stores.
- Server-side admin login using `ADMIN_PASSWORD`, signed HttpOnly session using `SESSION_SECRET`, logout and session expiry.
- Public documents open from their direct Blob URL.
- Private documents are listed only to administrators, and served via `/api/private-document` after admin or guest authentication (`GUEST_PASSWORD`).
- Admin `Refresh Documents` scans both stores when the hub is opened and on demand.
- Admin `Create Folder Structure` writes `.folder` placeholders for 6 categories and 7 Solutions folders to both stores once each store grants access. Placeholders are filtered from the HTML catalog.

## Blob structure — both stores

```
01-solutions/
  scanner/
  solution-assurance-concept/
  finops-engine/
  lz-assessment-engine/
  rfp-and-simulator/
  ai-transformation-engine/
  cscf-demo/
02-frameworks/
03-general-presentations/
04-shared-knowledge/
05-random/
06-personal/
```

Vercel Blob folders are virtual pathname prefixes, not persistent empty directories.

## Configuration
Vercel Production sensitive environment variables:
- `ADMIN_PASSWORD`
- `GUEST_PASSWORD`
- `SESSION_SECRET` (random >=32 characters)

Public store: `store_6mg9Vu2ypJJMAwV3` (already connected).
Private store: `store_YAAwH6FewcrImhA1` (**must be connected** to the `knowledge-hub` Vercel project via Storage > KnowledgeHub-Private > Projects > Connect project). If it is not linked, the API reports a warning instead of exposing contents. The code passes explicit store IDs to the Blob SDK using Vercel-managed OIDC credentials. Redeploy after connecting the store.

### Initial setup
1. Verify `ADMIN_PASSWORD`, `GUEST_PASSWORD`, and `SESSION_SECRET` exist in Production.
2. Connect **KnowledgeHub-Private** to the existing Vercel project and ensure both stores are accessible with the deployed function's credentials.
3. Redeploy `main`.
4. Sign in at the live site. Select **Create Folder Structure** to write `.folder` placeholders.
5. Upload an HTML document into each selected pathname in the appropriate store.
6. Select **Refresh Documents** to verify indexing. Private document links go through the guest password page.

## Important security limitations
- This is an initial implementation, not a completed security audit. Verify direct unauthenticated requests to `/api/documents` and `/api/private-document` are rejected, and validate all domains/preview deployments. An admin-login lock is not a substitute for platform access controls on the underlying storage.
- **The login endpoint does not yet have durable brute-force rate limiting.** Add Vercel WAF/rate-limit rules before relying on it for sensitive data.
- The public GitHub repository includes only public source/configuration, not passwords or private file metadata.
- Private Blob URLs cannot be fetched publicly. Private HTML is delivered with a restrictive sandbox CSP; interactive functionality that relies on same-origin privileges may not work.
- The legacy static catalog entries are links to previously published URLs and are not managed by Blob locking.
- Copying a public document to Private Blob does **not** revoke the original public link. Delete the old public object and verify its URL is no longer serving content. Cached/downloaded copies may remain.
- Public category `06-personal` is public; include only deliberately shareable personal material.
- The UI's folder action requires a valid administrator session; it cannot create objects before Blob authorization is properly configured.

## Future improvements
Durable rate limiting, security verification, UI category-subfolders, richer metadata, content-validation, consistent document version IDs, and automatic alerts when an old public URL is still active.


## HTML and PDF shareable viewing (v1.2)
- Files ending in `.html`, `.htm`, or `.pdf` are discoverable in the six folder categories.
- Blob-backed document cards open `/view.html?access=public|private&pathname=<blob-path>` rather than linking to the raw storage download.
- `/api/view` streams the file with `Content-Disposition: inline`; PDFs are served as `application/pdf`, HTML as `text/html`.
- Public document viewing does not require the admin password. Private viewing requires the guest password (or a current admin session).
- Uploaded HTML is rendered with a restrictive Content-Security-Policy `sandbox` and an iframe without `allow-same-origin`. This is essential: untrusted user-authored HTML must not access Knowledge Hub's admin-session origin.
- Browser-native PDF display works in supporting browsers; readers may still choose to download. PDF viewers vary by device.
- **Known limitation:** HTML presentations that load relative assets (CSS, JS, fonts, images) or depend on an unsandboxed document origin may need asset rewriting or independent deployment. Test each document after adding.
- **Known limitation:** Protected links are session-cookie based; copying a rendered document URL to a different browser requires its guest password.
- Never use an old public Blob or independent deployment URL to test protection. Such links must be deleted or restricted separately.

## Document visibility rule
Blob discovery indexes only HTML, HTM and PDF documents located inside one of the six designated category prefixes (`01-solutions/` through `06-personal/`). Files uploaded to a store's root or outside these prefixes are deliberately **not shown** in Knowledge Hub; move the file into a category folder to publish it in the catalog. The `05-random/` category is intentional and never a fallback for unclassified root files. Legacy curated links in `catalog/public-documents.json` are independent catalog entries.

## Solution Assurance folder naming update
The current Solutions navigation uses `solution-assurance-concept/` and no longer includes `solution-assurance-engine/`. Historical files stored under `solution-assurance-documentation-support/` are displayed in Solution Assurance Concept for backward compatibility. Existing Blob files or `.folder` placeholder objects are **not deleted or moved** by changing this repository; reorganize existing Blob paths manually when needed.

## Consolidated Solution Assurance navigation
The single **Solution Assurance Concept** folder in the Knowledge Hub UI consolidates documents stored in all three Blob prefixes under `01-solutions/`: `solution-assurance-engine/`, `solution-assurance-documentation-support/`, and `solution-assurance-concept/`. No files are moved or duplicated. Original `pathname` and access level are preserved for later domain-specific consumers. The folder initializer creates only the current `solution-assurance-concept/` prefix; historical prefixes remain valid for discovery.

## MCP retrieval endpoint (initial public-only release)
A read-only, stateless JSON-RPC / MCP endpoint is deployed at `/api/mcp` using HTTP POST and protocol version `2025-03-26`. Available tools: `list_documents`, `search_documents` (metadata search), `get_document_metadata`, and `get_document` (HTML text extraction). PDF documents are discoverable but currently provide metadata only through `get_document`.

**Security boundary:** This endpoint is deliberately anonymous and exposes **only Public Blob** files inside the six recognized category prefixes. Private Blob files, including their names and paths, are never returned by this endpoint. The authenticated Knowledge Hub website continues to use its separate APIs and can display Private Blob files after login. Root-level Blob files are excluded. All three Solution Assurance Blob folders retain their independent paths while their `display_group` is `Solution Assurance Concept`.

Do **not** extend anonymous tools to Private Blob data. To make Private documents accessible through ChatGPT, build a proper OAuth 2.1-protected MCP service and authorize the connection; a sole-user ChatGPT account is not an authentication mechanism for a publicly reachable endpoint. ChatGPT custom MCP connections may require a supported workspace plan, while Codex can use the same HTTP endpoint as a separate MCP client.

This Public endpoint remains anonymous and unchanged. PDF text extraction and semantic/full-text indexing are still future work. The separate Private MCP OAuth implementation is described below.

## Private MCP OAuth connection (first release; requires live authorization test)
**Endpoint:** `https://jori-knowledge-hub.vercel.app/api/mcp-private`

The Private endpoint exposes the same four read-only tools, restricted to the **Private Blob store** and recognized category folders. It does not return document content or metadata from private storage to unauthenticated tool calls. The Public MCP endpoint `/api/mcp` is unchanged.

The Knowledge Hub acts as its own OAuth authorization server, using the existing administrator login cookie as proof of identity. OAuth discovery and endpoints:
- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-authorization-server`
- `/oauth/register` (dynamic client registration; public clients and PKCE)
- `/oauth/authorize` (admin-session consent)
- `/oauth/token` (authorization code with PKCE and refresh-token rotation)

The server uses its existing `SESSION_SECRET` for signing, and writes authorization codes and one-time replay markers to reserved, **private** Blob prefixes (not indexed as documents). Access tokens are valid for one hour; refresh tokens are valid for 30 days. ChatGPT's registered redirect URI must match an allowed ChatGPT callback. The endpoint never accepts a Vercel Blob read-write token from the ChatGPT client.

### ChatGPT setup
1. Ensure you can log in to the existing Knowledge Hub website as administrator.
2. In ChatGPT select **Add custom MCP server**. Set the name to `Jori's Knowledge Hub — Private` and the URL to `https://jori-knowledge-hub.vercel.app/api/mcp-private`.
3. Choose **OAuth**, use **Dynamic Client Registration (DCR)** rather than manually entering client credentials, and request scope `documents:read`. The optional `offline_access` scope is advertised for client refresh support. Use token endpoint client authentication **none**, as the flow uses PKCE.
4. When the Knowledge Hub authorization page opens, sign in to the Knowledge Hub administrator interface in another tab if needed, return to the consent page, refresh, and select **Authorize read-only access**.
5. Verify list, search, and document read operations. Also test that unauthorized requests cannot list private document metadata and that root-level files remain excluded.

### Security and operational limitations
- **Live ChatGPT OAuth exchange and Private Blob read/write have not yet been end-to-end confirmed.** Vercel's successful deployment does not establish that the consent/token exchange succeeds. Do not treat the connector as security-audited until authorization tests pass.
- This is a deliberately small self-hosted authorization implementation, not a substitute for a professionally maintained identity provider for multi-user use.
- There is currently no per-client administrator revocation UI; tokens expire, and rotating `SESSION_SECRET` revokes all Knowledge Hub sessions and OAuth tokens.
- The existing admin-password login lacks persistent distributed rate limiting; apply appropriate protections before storing highly sensitive materials.
- HTML documents are available as extracted text (up to 60,000 characters); PDF content is currently metadata-only.
- OAuth-state blobs use expiry and replay markers; maintain and monitor Blob usage and storage permissions.
- The `tests/oauth.test.js` security regression tests run using `npm test` and the GitHub Actions workflow `.github/workflows/mcp-tests.yml`.

### OAuth consent repair (2026-11-11)
A reported `Authorization request expired or invalid` on approving the ChatGPT Private connection prompted two repairs: the consent GET now preserves a valid CSRF cookie rather than rotating it on every refresh (which previously broke concurrent/reloaded forms), and the OAuth form decoder handles URL-encoded text, JSON and Buffer inputs. The POST response distinguishes missing form, expired/invalid signature, missing/mismatched CSRF cookie and missing approval, without emitting secrets. Tests cover cookie stability and parsing. Authorization still requires a valid admin session, signed request, explicit consent and matching CSRF cookie. These changes do not bypass OAuth or expose Private documents anonymously. Recreate a fresh ChatGPT authorization attempt after deployment. The full browser approval plus Blob token exchange still requires an end-to-end interactive test.

### OAuth consent repair: missing temporary cookie (2026-11-11)
Following a live browser error `Authorization security cookie missing`, the consent flow no longer depends on a separate `__Host-kh_mcp_csrf` cookie. The signed, expiring consent payload now binds to the hash of the already-authenticated admin session cookie. The approval POST independently checks the current admin session, the signed payload and explicit approval, plus same-origin browser request headers where provided. Any admin session change causes approval to fail safely and requires restarting authorization. This preserves CSRF protection without a second cookie that was not reliably returned by the browser. Tests were updated for session binding and cross-origin rejection. Existing consent pages from the previous deployment cannot be reused; start a fresh ChatGPT OAuth authorization request. A successful production OAuth code/token exchange must still be verified interactively.

## PDF retrieval through both MCP connections (2026-11-11)
The Public and OAuth-protected Private MCP `get_document` tools now extract text **on demand** from categorized PDFs in their respective Blob stores using one shared `api/_pdf.js` implementation. The implementation uses `pdf2json` (pure JavaScript; no native canvas) and does **not** save extracted text, add OCR results, or write documents back to Blob.

- Optional `page_start` and `page_end` are 1-based inclusive integers. Without arguments, the first five pages are returned. A request is limited to 10 pages.
- Each result provides `total_pages`, `requested_pages`, `pages: [{page,text,extraction,truncated}]`, an aggregated `text` with page markers, `ocr_required_pages`, an `extraction` status and `truncated` flag.
- PDF size limit: 8 MiB. Time limit: 20 seconds of parser operation. Output text limit: 45,000 characters per request. Large PDFs must be retrieved in page ranges; pages without selectable text are marked `ocr-required`. **No OCR is performed.**
- The original Blob pathname, Public/Private access classification and folder source remain intact. Root-level PDF files are still excluded from MCP discovery.
- No upload, create, update, delete or storage mutation tools exist in either MCP. **Knowledge Hub documents are maintained manually in Vercel Blob by the owner; ChatGPT connections only retrieve information.** The OAuth server's short-lived internal authorization-code and replay-control storage is separate from document management.
- Live integration validation: confirmed extracted page text from Public `AI Transformation Assessment Engine_12.6.2026.pdf` (6 pages total) and Private `Secure Software Development Process_V1.0A.pdf` (27 pages total). Both returned page-numbered text through existing ChatGPT MCP connections.
- Note: the ChatGPT custom connectors may cache their original tool schemas. Default first-five-page PDF extraction works immediately, but explicitly setting `page_start`/`page_end` may require refreshing the connector's tool discovery. 

## Knowledge Acquisition Engine — step 1 (2026-11-11)
First bounded implementation package, **without AI or Golden Standards**: a read-only `get_document_structure` MCP operation was added to both Public and Private connectors. For PDFs, the existing on-demand parser now examines every page of a supported file and returns a compact page manifest, page count, per-page extracted-character counts and previews, explicit pages without a text layer, text-layer coverage and a separately calculated extraction-completeness flag. The full text is not returned by structure inspection. For HTML, it returns ordered heading metadata and a document-level inspection summary. The legacy `get_document` operation is unchanged and continues to return bounded text.
Safety boundaries: Public / Private scopes are unchanged; Private inspection still requires OAuth; no document mutations or persisted derived indexes; 8 MiB PDF file limit and 20-second parse timeout remain; scanned/graphic content is not declared fully understood simply because text extraction succeeded.
Next package: deterministic section index and full-text search, followed by evidence packages and quality gates. No Golden Standards were created.

## Knowledge Acquisition Engine — Step 2: bounded lexical content search (2026-11-11)

Both MCP endpoints now expose read-only \`search_content\` in addition to \`search_documents\` (which remains **metadata only**). This is a deterministic, on-demand section/page index. It does not require AI, embeddings, a vector database, persistent indexing, or storage mutations.

**Request:** \`{ "query": "evidence acquisition", "ids": ["private:01-solutions/.../file.pdf"], "limit": 10 }\` with 1–4 authorized IDs belonging exclusively to the invoking MCP's own storage scope.

**Processing:** Full available text is extracted from selected PDFs (including pages after page five) within PDF size/time bounds and from HTML documents with heading-aware segmentation. Text is divided into bounded overlapping passages, ranked by exact phrase, query terms and heading matches. Returned matches include ID, pathname, title, page or HTML heading/section, offsets, deterministic score, matched terms, and a short original excerpt. A score is **not** a confidence or a semantic relevance guarantee.

**Coverage contract:** \`documents\` records per-document indexed segments, examined PDF pages, OCR gaps, extraction completeness and limitations. \`selected_scope_examined\`, \`source_extraction_complete\`, \`result_set_complete\`, \`matches_truncated\`, and \`failures\` are separate indicators; no absence/completeness assertion is implied. Unselected catalog documents are never silently considered searched. Each call is bounded to 4 documents, 20 returned matches, ~900 characters per passage and a 24-second total processing budget (with a shorter PDF parser budget when appropriate). The current approach is intentionally scoped to **explicitly selected IDs**, not automated whole-library search; cross-catalog discovery is a later planned capability.

**Security:** Private search is behind the same OAuth guard as other Private MCP retrieval tools; Public search never resolves Private IDs. Source texts and derived segments are processed ephemerally and are not written back to the Blob stores. The owner remains responsible for all document additions and edits directly in Vercel.

**Validation:** Unit tests cover late-document terms, heading association, deterministic ranking, query validation, PDF extraction, source provenance, and OAuth enforcement. Live use of the new MCP operation requires tool schema refresh by the ChatGPT connector; deployment READY alone does not verify invocation.

## Knowledge Acquisition Engine — Step 3: evidence packages (2026-11-11)

Both read-only MCP endpoints expose `retrieve_evidence`:
`{"query":"evidence acquisition and verification","ids":["private:01-solutions/.../file.html"],"mode":"focused"}`.

Modes: `focused` (6 passages / 10k characters), `comparative` (10 / 18k), and `comprehensive` (16 / 28k). A request explicitly selects up to four authorized documents; it is NOT an automatic whole-library search. Extraction is on demand, with a 24-second request budget and file parser limits. PDF pages and HTML sections are mapped to bounded source-text passages, ranked deterministically by lexical matches, expanded with local context, and selected with per-source quotas and a first-pass cross-document balancing rule. No generative summarization, external AI calls, persistent indexes, OCR, or source writes are introduced.

Each package includes original passage text, page/section identifier, source title and path, matched terms, a deterministic score, truncation flags, inspected-source manifest, extraction coverage, failure details and explicit limitations. The status distinguishes `MATCHES_FOUND`, `NO_LEXICAL_MATCH`, and `PARTIAL_EXTRACTION`. The field `evidence_sufficiency` always reads `NOT_ASSESSED`; lexical retrieval must not assert semantic exhaustiveness or verified absence. Missing documents are rejected before any Blob content retrieval; Private calls require existing OAuth authorization. The existing `get_document`, `get_document_structure`, and `search_content` operations remain available.

No Golden Standards have been created. Next: Step 4 deterministic quality gates for retrieval (coverage, citation and handling of unresolved gaps), without conflating them with domain-specific assessment authority.

## Knowledge Acquisition Engine — Step 4: deterministic retrieval quality gates (2026-11-11)

A shared code-level `api/_quality_gate.js` now evaluates every `retrieve_evidence` response before it is sent by either MCP endpoint. The gate is **retrieval integrity only**, not a FinOps, Landing Zone, Solution Assurance, legal, or business-decision gate.

- `retrieval_quality.status` is `PASS` when the explicitly selected sources are processed, source location invariants pass, and no technical limitations besides the inherent semantic limitation are present; `WARN` for missing lexical matches, bounded/truncated passages, or extraction gaps; `BLOCK` for failed selected-source inspection, invalid passage provenance, inconsistent source scope, or manifest integrity defects.
- Every passage includes `source_verified` and a SHA-256 digest of its returned text + source locator. These are *in-process structural integrity markers*, not cryptographic proof of truth or a cross-request guarantee that a source is immutable.
- The report includes separate `source_scope`, `extraction`, `passage_provenance`, `bounded_output`, and `relevance_completeness` gates, actionable blocking reasons, warnings, a policy version, `evidence_sufficiency: NOT_ASSESSED`, and `verified_absence: false`.
- Lexical search can miss semantically relevant statements, diagrams and scanned pages. Accordingly `relevance_completeness` remains `NOT_VERIFIED` even when technical retrieval integrity is `PASS`.
- Strict Public/Private store isolation, OAuth protection, read-only document processing, and the absence of external AI providers remain unchanged.
- Focused automated regression tests were added for valid source anchoring, modified passages, missing documents, output limits and no-match uncertainty. **Golden Standards deliberately remain out of scope.**

### Step 4 compact verification endpoint
Both Public and Private MCP now additionally expose `verify_coverage` with the same `query`, `ids`, and `mode` arguments as `retrieve_evidence`. It independently re-examines the authorized source set through the same processing path and returns only the quality gate, per-document inspection manifest, gap/failure details and result counts—not passages. This is a source processing integrity check, not semantic recall, legal assurance, domain-scoring approval or verified absence. It remains read-only and the Private operation requires OAuth.


## Step 4.5 — Master Table administration and source discovery (2026-11-11)

An Admin-maintained Master Table is now part of the application. The separately reviewed initial HTML catalog will be converted to JSON and imported later; no initial data is assumed yet.

**Admin interface:** After Admin login, two new controls appear beside Refresh Documents.

- **Update the Master Table:** Reconcile all categorized Public and Private Blob documents into a protected index without replacing existing human edits. New Private documents get only deterministic source fields. New Public documents get deterministic fields, then the UI asks for permission before sequential Public-only AI enrichment. The only AI trigger is an explicit Admin click.
- **Master Table:** Search/filter entries; edit title, document type, summary, key terms, themes, sections and related documents. Save Entry stages edits in the working index. Each document has an independent Approved / Draft / Obsolete lifecycle status; Save & approve Master Table publishes a complete discovery snapshot. Source files are never deleted by changing lifecycle status. Delete removes the index entry, not the original document. Import reviewed JSON accepts either an array of records or an object with a records array, and fills only entries whose descriptive fields remain empty.

**Storage and access:** Source code is in api/_master_table.js and the Admin API in api/master-table.js. The index is stored as _knowledge-system/master-table-v1.json in the PRIVATE Blob store, outside the six document folder categories. The Admin API requires the signed Admin session and same-origin checks for writes. Conditional Blob writes use ifMatch/ETag to prevent stale editing sessions from overwriting newer data. Public and Private descriptions are separated by access scope.

**Public AI enrichment:** api/_master_enrich.js reads Public source text only and uses the OpenAI Responses API with GPT-6.1 Terra and server-side KNOWLEDGE_HUB_API_KEY. The model is instructed to treat source text as untrusted material, return schema-constrained JSON, summarize faithfully in 120–135 words, and extract specific keyword phrases/themes. The validation rejects invalid word counts and insufficient terms instead of manufacturing entries. The model request has store:false. A 350,000-character input budget is marked PARTIAL if reached. AI failures preserve existing entries; existing human edits are not automatically overwritten. Public classification is not itself proof that a particular document is safe to transmit to a remote service; Admin initiation should follow any applicable data restrictions.

**Private content is never transmitted to AI** by this workflow. Its descriptions remain empty until the Admin chooses to edit and save them.

**Source reconciliation:** Existing descriptions persist. Missing Blob sources are marked unavailable for discovery and can be manually removed from the index. Changed-source signatures are flagged for review. Signatures currently represent source ID, upload timestamp and file size rather than a full cryptographic file-content hash.

**MCP integration:** Both Public and Private MCP endpoints now additionally advertise the read-only operations discover_sources and retrieve_topic_evidence. Discovery ranks titles, Master Table summaries, key terms and themes only for Approved records in the last published table; unindexed sources do not enter normal MCP discovery. Automatic retrieval selects up to four highest-ranked authorized candidates and invokes the existing evidence package and retrieval quality gates. It reports candidates left unexamined and does not claim verified absence or semantic completeness. Private MCP remains OAuth-protected; Public MCP filters to Public records.

**Operational limitations:** Initial human-reviewed Master Table not imported yet. Authenticated Admin storage CRUD and live AI enrichment still require acceptance tests in the browser using your authorized session; there is no safe way to perform these production actions without it. The Admin login currently lacks durable brute-force protection; production WAF/rate limiting is recommended. Golden Standards remain deferred.

**Credential safety note (2026-11-11):** A credential value beginning with sk_live_ is typically a Stripe live secret key, not an OpenAI API key. Master Table AI enrichment now rejects Stripe-format keys before any provider request. Replace the environment variable with an OpenAI API key authorized for GPT-6.1 Terra; never paste the full value into chat or the repository. If a real Stripe key was used or exposed, handle it under your provider's rotation policy.


## Master Table Format 1.0 — Reviewed HTML compatibility (2026-11-11)

This is an **additive extension** of the existing Master Table operational schema (JSON schema_version remains 1). It matches the five-entry reviewed HTML format, including independent limitations and review provenance. No source document or persisted Master Table data is migrated or imported by the deployment itself.

Schemas:
- `schemas/master-table-v1.schema.json` — complete persisted index record.
- `schemas/master-table-import-v1.schema.json` — reviewed initial catalog import (JSON array or object containing `records`). An import row must match an existing source document's exact Public/Private `id`; only editable descriptive fields are imported.

Review fields:
- `review_notes` — admin-editable description of source scope, unsupported claims, diagrams and exceptions.
- `review_status` — administrator-selected `Approved`, `Draft`, or `Obsolete` on each document. New deterministic-only entries default to `Draft`. A separate table-level publication action controls when status and description edits become available to governed discovery.
- `review_version` — optional human label, e.g. `v1.0`.
- `last_reviewed` — ISO 8601 timestamp set automatically on manual Save; imported source review date can be preserved when provided as ISO 8601.
- `text_extraction` — `NOT_ASSESSED`, `COMPLETE`, `PARTIAL` or `FAILED`; does not imply diagrams were examined.
- `visual_inspection` — `NOT_ASSESSED`, `COMPLETE` or `PARTIAL`; independent of text extraction.
- `source_metadata_title` — immutable source catalog title, separate from editable `title`.
- `source_hash` — nullable, reserved for a genuine hash of original file bytes. **Do not substitute `source_signature`** (a metadata-derived upload-time/size signature) for an original file hash.

Source title, source timestamp, source scope, pathname, source signature and content hash are controlled by application source metadata, not trusted from imported JSON. Existing stored records lacking these new fields are read with backward-compatible defaults. The legacy `extraction_status` is maintained for older clients.

Public GPT-6.1 Terra enrichment now records text extraction, unassessed visual inspection and deterministic processing caveats in Review Notes; generated metadata is not automatically labeled as human-reviewed. The Admin Save Entry operation does not change its lifecycle status unless explicitly selected; a separate whole-table approval is necessary to publish staged changes.

Import safety: human-reviewed JSON (including explicit per-document review statuses) may replace **AI-only** fields, but previously manually saved entries (including deliberately empty entries) are preserved. This lets the completed reviewed HTML catalog supersede auto-generated Public descriptions without overwriting later manual revisions. No external source contents are included in the import, and Private material never enters the Public AI workflow.

MCP discovery uses only the last approved Master Table snapshot and returns review notes (bounded) and separate text/visual extraction status for approved descriptions. Obsolete and Draft sources are excluded from normal MCP discovery and evidence retrieval, including explicit IDs. These are catalog qualifications, **not independent evidence or proof of full document comprehension**. Actual findings remain grounded in the original source retrieval and quality gates.

The initial 5-entry HTML remains a review artifact only. The full table will be imported only after the user supplies the complete reviewed HTML and its conversion to the import schema.

## Evidence and contract hardening — review branch (2026-11-12)

This focused change is intentionally additive and keeps the two existing read-only MCP endpoints and the operational Master Table schema version. It is a review-stage change, not a production claim.

**Original source hash vs. passage hash.** Evidence acquisition now hashes the complete original HTML or PDF bytes *while the source is processed*. In each Evidence Package, `source_coverage[].original_file_sha256` and `passages[].source_sha256` refer to the same actual source-byte hash. `passages[].passage_sha256` is a separate SHA-256 over the passage's document ID, page or section, starting offset and selected text. The previous `source_sha256` passage-digest meaning was misleading. The retrieval-integrity policy is now `retrieval-integrity-v2`, and truncated passages preserve correct end offsets. This is a change in field semantics for any client that depended on the previous implementation. The gate checks the internal acquisition manifest and digest consistency but does not independently fetch a second copy of the original file.

**Evidence Package contract.** The schema is `schemas/evidence-package-v1.schema.json`, with output `schema_version: 1`. It covers selected-scope counts, extraction limitations, exact source and passage locators, both hashes, integrity decisions and `evidence_sufficiency: NOT_ASSESSED`. It deliberately does not assert semantic completeness, verified absence, legal assurance or factual truth. Future consumers can validate this JSON Schema before use; the existing runtime integrity gate remains the active check.

**Source relationships.** Free-text `related_documents` remain descriptive. A separate, optional `related_source_refs` field stores exact source identifiers with their current **metadata-derived** `source_signature`. Admin editing validates target existence, freshness and access. The Admin view flags `CURRENT`, `STALE_VERSION`, `MISSING` and `UNAVAILABLE` links. A Public record cannot link to a Private source. This is a version-binding and referential-integrity feature, **not** proof of original-file content identity. The existing nullable Master Table `source_hash` remains unpopulated until independently verified original-byte hashes can be persisted.

**Model-directed transfer.** The existing **Public-only Master Table AI enrichment** now requires an explicit, time-bounded, source-ID and metadata-version-scoped administrator approval for the fixed purpose `master_table_discovery_enrichment` and recipient `openai.responses`. The server rejects requests without matching approval before contacting the model. The administrator confirmation explicitly states that Public storage alone is not privacy clearance. This gate does not scan content for secrets or personal information and never claims to. It also does not authorize other kinds of model transfer.

**Important authorization boundary.** Existing MCP Public/Private retrieval tools return source text to an authorized connected client (including ChatGPT or Codex). Their access permissions are not separate task-specific model-egress permissions. This change does **not** silently block or govern how those external clients use the retrieved text. A future independent model-context export should require its own consumer-purpose, recipient and privacy/egress approval if that stricter boundary is needed. The two should not be conflated.

**Regression evidence.** The new `tests/retrieval-golden-standard.test.js` provides seven synthetic retrieval cases: positive relevant source, no lexical match vs. absence, missing source, altered hashes, repeatability, truncated offset and contract fields. Additional tests cover source relationships, stale versions and fail-closed Public AI approval. GitHub Actions runs `npm test` on pull requests to `main`. A green test run confirms these automated tests, not production deployment, real-customer privacy review or exhaustive source-format correctness.

**Manual acceptance before merging:** Review the Evidence Package payload contract with any external consumers; check Master Table source links and their stale-state UI; confirm explicit Public enrichment approval; verify Public and Private MCP retrieval remain compatible; review deployment access and egress rules. No broad evidence-acquisition rewrite, vector index, model-context service or visual interpretation engine is introduced here.

## Governed Evidence Consumption Mode (2026-11-12)

To test Knowledge Hub as an independent **source of governed evidence**, use the separate MCP endpoints `/api/mcp-governed` (Public) and `/api/mcp-governed-private` (Private, OAuth). These expose **only metadata discovery, Evidence Packages, and integrity/coverage operations**. Direct `get_document`, `search_content` and `get_document_structure` calls are rejected server-side. The Private endpoint requires its own narrowly scoped OAuth resource audience.

The existing `/api/mcp` and `/api/mcp-private` endpoints retain unrestricted **authorized** document reading for normal use. For a valid evidence-only acceptance test, connect only the governed endpoint. The model must be instructed to use released Evidence Package passages exclusively, and to report unsupported claims rather than reading the document independently.

Read [the governed evidence mode guide](docs/governed-evidence-mode.md) for tool contracts, delivery decisions, consumer isolation and repeatable acceptance tests. This route reuses the existing bounded deterministic retrieval kernel. It does not claim semantic completeness, privacy clearance or verification of absence.

## Unified Governed Evidence MCP — Public and Private

**Preferred single-connection endpoint:** `https://jori-knowledge-hub.vercel.app/api/mcp-governed-unified`.

Create a custom MCP connection named **Jori's Knowledge Hub — Governed Evidence (Unified)** with **OAuth** and use the existing administrator login. The connection is bound to a new, exact resource audience and cannot use its token on the unrestricted Private document reader. Both Public and Private document inventories must be available, and each evidence passage retains its Public/Private source ID.

The endpoint advertises seven metadata, discovery and Evidence Package operations. It cannot return full-document contents, raw source URLs, unverified Master Table summaries as factual evidence, or passage text from integrity-BLOCKed packages. The earlier Public-only and Private-only governed endpoints, and ordinary document-reading endpoints, remain supported for their original purposes.

**Acceptance:** In a fresh conversation select only this unified connector, find one Public and one Private source ID, then call `retrieve_evidence` with both IDs. Verify the Evidence Package's per-source original-byte SHA-256, passage SHA-256, locators, status and limitations. Test an unsupported query and attempt `get_document` to confirm no direct reading or false absence. The Master Table must contain the selected documents as Approved entries in its last published snapshot; it need not be complete for unrelated documents.

See [governed evidence mode](docs/governed-evidence-mode.md) for full setup and test instructions.

**Privacy limitation:** Retrieval-integrity checks are **not** a recipient-specific sensitive-data egress/privacy clearance. Private passages may still contain information that should not be sent to particular external models. Apply applicable data-handling policies to stored material and connected model/consumer. The unified connector limits the material **available through this connection**; it cannot prevent a consuming application from using a separately connected unrestricted source.

## Direct HTML reading limit: 120,000 characters

The Public and Private standard MCP `get_document` operations now return up to **120,000 extracted HTML text characters** (previously 60,000). `truncated: true` continues to signal when the direct reading is incomplete. The original HTML source-file size limit remains 6 MB. Documents longer than 120,000 extracted characters still require another method or bounded, targeted retrieval; this change does **not** implement pagination for HTML direct reading.

**This cap is not used by Evidence Package acquisition:** `retrieve_evidence` and `retrieve_topic_evidence` parse/index the source internally up to their file size, extraction/timeout and retrieval windows, then return selected passages subject to the bounded Evidence Package budgets (focused 10,000; comparative 18,000; comprehensive 28,000 passage characters). Complete source indexing does not guarantee semantic recall or that all matching passages will be returned. `WARN` signals bounded or partial coverage, and `PASS` does not establish factual truth or complete domain evidence.

**Master Table enrichment has a separate processing route:** Public-only, explicitly administrator-authorized enrichment extracts source text internally with a 350,000-character model-input budget. It does not use normal MCP retrieval and remains an administrative authoring operation. Private Master Table entries remain manual; after strict Approved-only enforcement, unapproved Private documents cannot be read through standard MCP for creating their initial summaries.

**PDF direct reading is separate:** it retains a 45,000-character output budget and a maximum of 10 explicitly selected pages per call. Full-document PDF evidence search processes text layers from all available pages under its own 8 MB and time limits, but scanned pages and images are not OCR-interpreted automatically. To summarize longer PDFs, retrieve relevant pages or source passages and explicitly record incomplete coverage.

See `tests/document-text-limit.test.js` and the long-source regression test in `tests/quality-gate.test.js`.

## Master Table document lifecycle and whole-table approval (2026-11-12)

**Document status** and **Master Table publication** are independent.

- **Approved (document):** the current document's descriptive entry has been reviewed and may be used for candidate discovery once the Master Table snapshot is published.
- **Draft (document):** a work-in-progress or unreviewed description. It is excluded from normal MCP catalog, discovery and evidence retrieval until Approved and included in an approved Master Table publication.
- **Obsolete (document):** historical/retired material, retained in its original Public or Private Blob location and the administrative Master Table for later review or comparison. Normal MCP retrieval is blocked even by explicit ID; no original document is deleted.
- **Save entry (stage changes):** persists a working record and sets the whole Master Table to **Draft**. It preserves the last approved discovery snapshot.
- **Save & approve Master Table:** requires an authenticated administrator action and a current ETag, and atomically snapshots all working records as the published discovery index. The document statuses remain exactly as selected; approving the table does **not** mark every document Approved.

**Storage compatibility:** The existing schema remains v1, with additive `publication` and `published_records` fields. Legacy Master Tables are treated as a last-published snapshot on first read so existing discovery is not inadvertently wiped out when the workflow changes. The index remains in the protected Blob store; access classification of the original sources is unchanged. A newly saved entry, an import, an AI enrichment, a delete or a source inventory reconciliation does not silently approve/publish the working table.

**Important boundary:** Approval publication controls normal MCP discovery, document reading, content searching and Evidence Package acquisition. Administrator review of historical documents happens outside normal MCP evidence interfaces. Approved status is a human lifecycle decision and does not certify factual correctness or safety for model transfer.

## Approved-only source eligibility for all Knowledge Hub MCP connections

**Rule: Only documents explicitly marked `Approved` in the last published Master Table are eligible for normal MCP source discovery, direct source reading, content search, coverage checks and Evidence Package generation.** This is a deterministic server-side rule, not a ChatGPT prompt instruction.

Eligibility requires all of the following simultaneously:

1. The document ID is present in the **last approved/published Master Table snapshot**, not merely a working edit.
2. Its `review_status` is exactly `Approved`.
3. Its source still exists and is available, is in its original Public/Private access scope, is not flagged `source_changed`, and the approved metadata-version signature still matches current Blob inventory metadata.
4. Source re-authorization occurs immediately before content is opened, preventing status changes between discovery and source extraction from silently bypassing approval.

**Draft**, **Obsolete**, **unindexed**, **missing**, **changed** or **unavailable** sources do not enter ordinary evidence or search. Attempts to retrieve them **by exact source ID** also fail, including `get_document`, `get_document_structure`, `search_content`, `retrieve_evidence`, `verify_coverage`, `retrieve_topic_evidence`, and the unified governed MCP. Previous discovery title/path fallback for unapproved/unindexed documents has been removed.

This applies to all five existing MCP entrypoints: Public, Private, governed Public, governed Private and governed unified Public+Private. The Public+Private combined inventory is filtered using the same published status contract.

**Document preservation and authoring:** Non-Approved source files are **not deleted** or reclassified in Blob. They remain visible to the authenticated administrator in the Master Table editor and can be inspected via the owner's administrative/document-management workflow for drafting, historical comparison, and deliberate re-approval. The normal MCP evidence interfaces do **not** have a historical-review bypass. In particular, if creating new Private Master Table summaries relied on reading Draft documents through standard MCP `get_document`, that direct-reading workflow is now unavailable; use the authorized document-management route or provide source files directly for authoring until a separately scoped administrative-review connector is implemented.

**Publication timing:** Saving the document status `Approved` is not sufficient. After finishing review, the administrator must select **Save & approve Master Table**. Conversely, a working edit marking a previously published Approved source Obsolete does not revoke the prior approved snapshot until the Master Table is published; for urgent revocation, publish the updated table immediately. Source mutation invalidates a previously approved source signature even before the next table publication.

**Safety limitation:** This controls **normal MCP source eligibility**, not what other external websites or separately configured connectors can show. Public Blob files and the ordinary Knowledge Hub website are not made inaccessible by this rule. `Approved` is a human lifecycle decision, not a substitute for recipient-specific data-egress/privacy gates, factual verification, or semantic evidence sufficiency.

Regression coverage: `tests/approved-policy.test.js`, `tests/master-table-lifecycle.test.js`, and `tests/master-table.test.js`.
