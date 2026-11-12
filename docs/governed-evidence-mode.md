# Knowledge Hub — Governed Evidence Consumption Mode

**Status:** review branch, not automatically enabled on existing connections.

## Purpose and security boundary

This mode verifies **Knowledge Hub's own evidence acquisition** rather than allowing a connected AI client to independently read full source documents. Its entrypoint is a separate read-only MCP connection with a **server-enforced tool allowlist**. Documents are read and deterministically parsed internally by Knowledge Hub, but the connected model receives *only selected Evidence Package passages* plus source/quality metadata.

It does not make the generative model factually correct and cannot prevent the model from using prior knowledge or other connected tools. To evaluate this boundary, enable **only the governed Knowledge Hub connection** for the test and ask for an answer based exclusively on the released packages. Connecting the legacy document-reading endpoint in parallel invalidates the guarantee that all source text came through the evidence package.

## MCP endpoints

| Use case | Endpoint | Access |
|---|---|---|
| Public governed evidence | `https://jori-knowledge-hub.vercel.app/api/mcp-governed` | Read-only Public Blob |
| Private governed evidence | `https://jori-knowledge-hub.vercel.app/api/mcp-governed-private` | OAuth, Private Blob |
| Existing Public direct reading | `https://jori-knowledge-hub.vercel.app/api/mcp` | Unchanged |
| Existing Private direct reading | `https://jori-knowledge-hub.vercel.app/api/mcp-private` | Unchanged OAuth |

The governed Private endpoint has its **own OAuth resource audience** (`.../api/mcp-governed-private`). A token issued for this audience is rejected at the legacy Private endpoint and vice versa. OAuth protected-resource discovery is exposed at `/.well-known/oauth-protected-resource/api/mcp-governed-private`.

When connecting the new Private MCP, authorize via your existing Knowledge Hub administrator session. The consent page identifies the connection as **Governed Evidence**, not full-document reading. If an external client does not transmit the OAuth `resource` parameter for the new endpoint, authorization must fail closed; do not switch to a broad token.

## Operations available

- `list_documents` and `search_documents`: **metadata only** to find exact source IDs. Governed mode omits direct source Blob URLs.
- `get_document_metadata`: metadata only, without source URLs.
- `discover_sources`: bounded Master Table/metadata candidate discovery. Free-text review notes are omitted. Catalog descriptions are **not** evidence.
- `retrieve_evidence`: requires 1–4 known authorized IDs and query; returns one governed delivery envelope.
- `retrieve_topic_evidence`: discovers up to four candidates and returns the same governed delivery envelope with discovery limitations.
- `verify_coverage`: recomputes retrieval quality and source coverage without releasing passages.

The following operations **do not exist** in the governed tools list and are **rejected server-side even if directly invoked by their names**: `get_document`, `get_document_structure`, `search_content`.

This separation applies to **both Public and Private** endpoints, without creating a new AI model or rewriting the underlying evidence acquisition.

## Evidence delivery decisions

The `api/_governed_evidence.js` module recomputes the deterministic retrieval-integrity gate before releasing any selected passages.

| `delivery_status` | Released passage text? | Meaning |
|---|---|---|
| `RELEASED` | Yes | Retrieval integrity checks passed. Does not establish factual or semantic completeness. |
| `RELEASED_WITH_WARNINGS` | Yes | Provenance checks passed, but one or more bounded/partial extraction limitations apply. |
| `NO_SUPPORTING_EVIDENCE` | No | The requested source scope yielded no lexical support. Not a verified absence. |
| `NO_SOURCE_CANDIDATES` | No | Discovery did not find sources. Not a verified absence. |
| `BLOCKED` | **No** | Integrity failed, contract incompatible, or quality decision inconsistent. No passage text is released. |

Each released Evidence Package preserves its existing `schema_version: 1`, `source_coverage[].original_file_sha256`, `passages[].source_sha256` and `passages[].passage_sha256`, section/page, offsets, extraction diagnostics and `retrieval_quality`. A delivery envelope includes the release policy and makes source-text access semantics explicit.

**Important:** the gate is an evidence retrieval/integrity control, not a certified customer-data privacy clearance, legal assessment, content truth test, or semantic completeness test. No claim of verified absence is made.

## Controlled acceptance test before the Master Table is complete

1. Connect **only** the new Governed Evidence Private MCP in a fresh session. Confirm the tool list has **seven** operations and no full-document reader.
2. Find the source ID using `search_documents` or `discover_sources`. An incomplete Master Table is acceptable because explicit-ID retrieval does not require its summaries.
3. Use `retrieve_evidence` on the exact document ID with an architectural question whose correct passages you already know.
4. Check the returned `governed_mode`, `delivery_status`, Evidence Package version, source SHA-256, passage SHA-256, passage locations and warnings.
5. Answer using **only the released passages**. If the packet is bounded or incomplete, issue another **targeted `retrieve_evidence` call** using the same governed connection. No `get_document` fallback exists.
6. Run a deliberate negative question. Expect `NO_SUPPORTING_EVIDENCE`, no passages and `verified_absence: false`.
7. Attempt a call by name to `get_document` or `search_content`. It must be rejected, even with a valid governed OAuth token.
8. Try an old Private MCP token at the new Private endpoint and a new governed token at the old endpoint. Both must be rejected.

### Suggested first test prompt

> Use **only Jori's Knowledge Hub — Governed Evidence (Private)**. Find the FinOps Engine Customer Evidence Acquisition Pipeline source and acquire an Evidence Package about the pre-GenAI Gap Analyzer, its implementation status and the separate post-GenAI semantic expansion. State the exact source IDs, passage IDs, source/passage SHA-256 hashes, section locators, delivery status, quality gate and limitations. Cite only the released Evidence Package passages. If these passages do not establish a claim, say that it is unverified. Do not retrieve complete documents or use other connectors.

## Limitations and next validation

- The lightweight extractor remains lexical. A relevant passage phrased with different vocabulary can be missed; **do not infer absence**.
- Packet output is bounded. A `WARN` may mean that more targeted evidence acquisition is needed.
- The Master Table is optional for explicit-ID retrieval but useful for automatic topic discovery.
- No background model-evaluation process is introduced here. The consumer remains responsible for grounded reasoning and source-correct citation.
- The existing standard MCP endpoints deliberately retain direct reading. Use an isolated governed connection when the outcome must be attributable exclusively to Evidence Packages.
- Before publishing these changes, run tests, inspect the Private OAuth consent and audience, and perform a live positive and negative retrieval in the preview environment.

## Unified governed evidence endpoint — Public + Private

**Preferred integration for one complete authorized Knowledge Hub connection:**

`https://jori-knowledge-hub.vercel.app/api/mcp-governed-unified`

Connection display name: **Jori's Knowledge Hub — Governed Evidence (Unified)**. Authentication: **OAuth**, using the existing Knowledge Hub administrator sign-in. The protected resource is `https://jori-knowledge-hub.vercel.app/api/mcp-governed-unified` and discovery is `/.well-known/oauth-protected-resource/api/mcp-governed-unified`.

This is a third governed MCP endpoint, added without replacing the existing Public-only and Private-only governed endpoints. Existing general-purpose document-reading endpoints also remain operational.

- The unified service requires successful inventory access to **both** Blob stores. It never treats a failed Private inventory as a Public-only success.
- All discovered and retrieved source objects retain their `public:` or `private:` source IDs and `access` classification.
- `retrieve_evidence` accepts up to four explicit source IDs in **any authorized mixture of Public and Private** and combines them into one versioned Evidence Package. Every passage maintains the correct original-byte SHA-256, passage SHA-256, section/page and source identifier.
- `discover_sources` ranks current candidates from both collections using the existing Master Table and metadata fallback. It deliberately reports `discovery_complete: false` because lexical ranking cannot certify recall. `retrieve_topic_evidence` acquires from at most four best-ranked authorized candidates, reports other candidates unexamined and preserves warnings.
- Direct document-reading and raw URLs are unavailable. The endpoint exposes the seven governed tools only.
- A dedicated OAuth access-token audience ensures that its token **cannot access** the legacy unrestricted Private MCP or Private-only governed MCP. Those endpoints' tokens do not authorize unified access.
- Successful integrity checks are not assertions of factual truth, policy compliance, privacy clearance, complete semantic recall or verified absence.

**Initial acceptance, even with the Master Table incomplete:** connect only the new Unified endpoint, search for a known Public and a known Private document, then run `retrieve_evidence` using both exact IDs and a shared query. Confirm two distinct sources, source-specific SHA-256 hashes, passage locators and the governing retrieval quality. Repeat with a nonsense query: expect `NO_SUPPORTING_EVIDENCE`, no passages, and `verified_absence: false`. Confirm calls to `get_document` and `search_content` are rejected.

**Deployment note:** these endpoints and OAuth routes become available only after the feature branch is merged and deployed. GitHub automated tests and a successful build do not replace a live OAuth and Public/Private Blob acceptance test.
