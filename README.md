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
