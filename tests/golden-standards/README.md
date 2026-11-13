# Knowledge Hub Golden Standards

Store reviewed test cases, expected evidence, and run observations here so they can be versioned alongside retrieval and approval code. The existing [automated retrieval tests](../retrieval-golden-standard.test.js) cover the evidence package contract. These case files define acceptance criteria for the live connector and can later be used by an automated runner.

| Case | Coverage |
| --- | --- |
| [GS-001 · Juniper Harbor](./GS-001-juniper-harbor.json) | Draft, staged and published approval, Obsolete exclusion, two-source reasoning, PDF reading order and retrieval precision |
| [GS-003 · Connector expected results](./GS-003-connector-expected-results.json) | Versioned inputs and expected outcomes for the ten admin UI checks |
| [GS-003 · Answer-level runbook](./GS-003-knowledge-hub-test-prompts.md) | Prompts and expected answer behavior for manual review |

## Compare GS-003 connector results

Each run records the version of the expected results, the deployment, and the published Master Table revision. Update the version when reviewing a change to the expected behavior, queries, or accepted exceptions. Candidate counts, truncation, and returned passage counts on positive cases are diagnostics.

| Status | Rule |
| --- | --- |
| OK | Zero cases with unaccepted differences. Up to one explicitly accepted, non-critical exception can be shown. |
| Warning | One to three cases with unaccepted differences, or a published snapshot change during the run. |
| Severe problems | Four or more cases with unaccepted differences, or any fixture eligibility or evidence integrity failure. |

Count each affected case once. An accepted exception must identify the case, check, and exact expected and actual values. GS-003 v1 has zero accepted exceptions. GS-003-01 expects zero passages for the out-of-scope query.

## Replay GS-001

1. Use the fictional Juniper Harbor Policy and Exercise PDFs. Their Knowledge Hub IDs, expected sentences, and page numbers are in the case file. For a fresh replay, start with only the Policy published as Approved. Use a controlled environment or dedicated test copies if the existing published table needs to remain available. Record the actual source IDs and SHA-256 values when using copies.
2. Apply the Master Table state in each run and use the same prompt in a fresh chat with the same model and Unified Governed Evidence connector. In Run 3, save the entry without publishing the Master Table. Record the published snapshot and the working row status separately.
3. Search for the service name and request each expected source by exact ID as separate checks. Save the discovery and retrieval responses before scoring the answer. Record the tool operation, query, mode, connector version or deployment when available, model, time, source IDs, page or section locators, raw passages, source and passage hashes, integrity status, warnings, and truncation.
4. Repeat an identical retrieval request against the same snapshot and source version. Compare source hashes, passage hashes, locators, and passage order. For the ranking comparison, use the exact service-name query and the broad query recorded in the case file with the same snapshot and retrieval limits.

## Score the run

- **Eligibility** passes when focused discovery and exact-ID retrieval follow the expected published state. An excluded ID must release zero passages. Record the actual connector error separately.
- **Answer support** passes when every expected claim has the required source evidence and every expected unknown stays unknown. A comparison requires both facts. Master Table metadata can guide discovery. Assess support against the source passages and record the reviewer.
- **Recall** is the fraction of expected evidence facts present in returned passages. **Useful-passage ratio** is the number of returned passages directly supporting an answer divided by all returned passages. Count repeated citations of one passage once. Track packages used separately. An unavailable denominator is unknown.
- **Quote fidelity** compares the answer's quoted wording with the raw passage, allowing only whitespace normalization. Review PDF reading order separately by comparing the raw passage with the visible source. A correct answer can still have a quote-fidelity or extraction defect.
- **Integrity and coverage** are tracked separately from answer support and source eligibility. Keep the connector's warnings and review source and passage hashes. A human reviewer decides factual correctness and evidence sufficiency. Privacy and model-egress decisions remain separate from these retrieval scores.

The historical runs were reconstructed from the reported summaries. Any missing raw responses, hashes, warnings, or counts remain unrecorded. The live diagnostic included in the case is a separate measurement. Candidate counts and passage budgets are diagnostics for this test corpus.

Use additional cases to cover a previously published source that is removed or replaced at the same path, administrative access to an Obsolete source, anti-pattern evidence, unsupported claims, mixed Public/Private sources, long sources, and partial or missing extraction. Compare retrieval changes against the baseline before considering larger evidence-output limits.
