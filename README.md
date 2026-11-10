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
