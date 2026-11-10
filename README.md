# Jori's Own Knowledge Hub

This is the **public-facing** six-category documentation catalog. GitHub is the version-controlled source; Vercel serves the website. Only deliberately public-approved records belong here.

## Categories
1. `solutions/` — Solution-specific documentation
2. `frameworks/` — Reusable methods and frameworks
3. `general-presentations/` — Essays, strategic presentations, research
4. `shared-knowledge/` — Cross-cutting principles and evidence models
5. `random/` — Unclassified exploratory materials
6. `personal/` — **Public-approved** CV, portfolio and professional material only

## Recommended solution convention
`solutions/<solution-id>/{concept,architecture,requirements,verification,roadmap,presentations}/`

Create a subfolder only when there is a real document for it. The category folders in this repository provide guidance; the linked HTML documents may remain on existing independent Vercel deployments.

## Adding a document
1. Confirm the document and *its source URL* are suitable for a public catalog.
2. Add an entry to `catalog/public-documents.json`, specifying title, category, group, description, URL, ISO date, and authority status.
3. Update the JavaScript `docs` array in `index.html` (temporary v1 implementation; future task: fetch the JSON catalog directly).
4. Verify the URL, status, classification, and deployment.
5. For revisions, preserve version provenance, replace outdated links intentionally, and document any retired material.

## Authority model
- `working-reference`: idea or working artifact, not approved.
- `validated`: subject-matter reviewed and validated.
- `authoritative`: explicitly approved source of truth.
- `historical`: superseded/retained for traceability.

No record should become authoritative automatically because it is the newest deployment.

## Hybrid access — critical security boundary
**The public repository and deployment must never contain private HTML, private URLs, private metadata, or access credentials.** Do not use CSS hiding, client-side passwords, or unlinked routes as protection.

A future **separate private GitHub repository and separate Vercel project** must enforce authentication at the deployment boundary (for example Vercel Authentication, after verifying account/plan support), including previews, deployment URLs and assets. Validate authorization with an anonymous request before uploading any sensitive content. Keep a separate private catalog and avoid merging it into the public build.

## Deployment
- Current public Vercel project: `knowledge-hub`
- Current repository: `jorieskolin-creator/Jori-s-Own-Knowledge-Hub`
- The project's Git integration must be connected explicitly in Vercel; updating GitHub does not itself guarantee an auto-deploy until the link is verified.

## Future
Automated, approval-gated import from Vercel; metadata-driven catalog rendering; content retrieval for ChatGPT/Codex with scope and authority checks; broken-link checks; revision history.
