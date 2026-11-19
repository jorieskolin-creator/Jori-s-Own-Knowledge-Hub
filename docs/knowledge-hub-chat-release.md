# Knowledge Hub Chat release review

## Release decision

Chat is available with the configured Chat password. Production answers and Word reports use approved Public sources. Private evidence, PDF uploads, and Gemini fallback remain outside the current release.

## Implemented controls

| Boundary | Control |
| --- | --- |
| Sign-in | The Full_Access_Chat password produces a dedicated, short-lived signed session. Private Blob stores opaque revocation and quota state through origin reads and conditional writes. The Chat session is rejected by existing document, guest, admin and Master Table endpoints. The existing Public viewer keeps its current behavior. |
| Retrieval | Only current Approved sources in the published Master Table are eligible. The Public scope excludes Personal before ranking. The Chat path rechecks publication and source ETags at retrieval, before model use and before answer or report release. Report and Chat citations show pseudonymous source labels and locations. |
| Input and output | Local identifier checks precede provider calls. The configured moderation provider checks requests before retrieval, then assesses screened passages and the generated response. The model verifier checks claim support and disclosure. Reproduce-document requests, long verbatim overlap and cumulative per-source copying are restricted. |
| PDF | The upload feature remains disabled in production. The implementation limits uploads to two PDFs subject to a 4 MB multipart limit, 40 pages each, and extraction quotas. A child process without ambient credentials parses text in memory and is killed on completion, error, deadline, or cancellation. Neither original files nor extracted text enter the Hub catalogue or persistence. Image-only pages are reported as a limitation. |
| Word | A generated Office document is rendered locally through WebAssembly and counted before the same authenticated HTTP request can download it. The reference-renderer maximum is 25 pages. A renderer or policy failure prevents delivery. External links and original source attachments are outside the export template. |
| Usage | Atomic rate and concurrency controls apply before retrieval and model calls. One shared daily pre-charge budget covers worst-case request costs. The default reservation is $0.50 per accepted request against a $5.00 daily limit, including failed requests. Recalibrate against the verified provider routes before widening access. |

## Server configuration

| Setting | Purpose |
| --- | --- |
| FULL_ACCESS_CHAT_PASSWORD | Existing password used to sign in to Chat. |
| SESSION_SECRET | Existing Knowledge Hub secret used to sign sessions. |
| KNOWLEDGE_HUB_API_KEY | Existing key used for OpenAI moderation and answering over approved Public evidence. |


## Verification and activation sequence

1. Check branch build and clean dependency audit. Run npm test. Use the synthetic fixtures to verify sign-in, rejected document routes, provider failover, PDF cleanup, output policy, and the Word 24/25/26-page boundary.
2. In an isolated environment, check host headers, Private Blob conditional-write behavior, logout revocation, child process restrictions, Word WASM assets and uncached download responses. Verify repeated and concurrent requests from different sessions.
3. Verify both providers using only synthetic prompts, including OpenAI moderation, the fallback refusal behavior and structured responses. Record the actual account, endpoint, permitted data classes, operational limits, training settings, cache controls and retention terms. The existing presence of a key does not substantiate those settings.
4. Run the full Chat Golden Standard with the expected outcomes in the operator runbook and seeded synthetic access cases. In Chat, check citation labels and locators instead of exposing original paths or source IDs. Verify expected abstentions and partial answers along with positive retrieval and answer quality.
5. Review outbound payloads, response headers, logs, tracing, failure paths, use across sessions, and exports. Include language-specific identifier misses and indirect identifiers in the privacy review. Treat the local pattern detector and model verification as complementary checks and establish whether the actual Private corpus meets the disclosure threshold before authorising it. Verify deployed PDF isolation before enabling attachments.
6. Fix and retest material failures. Record remaining limitations and the approval decision. Review changes to the current production scope before expanding access. Run the existing viewer and MCP checks after release.

## Reference material

- [OpenAI account data controls](https://developers.openai.com/api/docs/guides/your-data)
- [Google Developer API terms](https://ai.google.dev/gemini-api/terms) and [Google Cloud retention controls](https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/zero-data-retention)
- [Vercel Functions limits](https://vercel.com/docs/functions/limitations) and [OWASP file upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
