# Knowledge Hub Golden Standard GS-003

**Version 1.0 · 13 November 2026**

The complete operator runbook contains the questions and expected passages for cases involving Private sources. Use that copy for those cases and for the exact fixture ID in case 10.

Ten cases cover unrelated and adjacent requests, direct HTML and PDF retrieval, incomplete evidence, cross-document reasoning, and source eligibility. The expectations below use passages checked in eligible originals corresponding to nine documents in the Golden Standard collection. The uploaded copies are reserved for the exclusion check. Their byte equivalence to the originals has yet to be verified.

## Run the tests

1. Start a fresh chat for each case and select **Knowledge Hub – Governed Evidence Unified**. Use the same model, connector and published Master Table snapshot throughout a round. Record any changes between rounds.
2. For GS-003-01 to GS-003-09, paste the common instructions and then the case question. Paste GS-003-10 by itself. Keep this runbook and its answer key outside the test chat so they cannot supply evidence or influence source selection.
3. Run each case once before changing retrieval. Repeat the same cases in fresh chats on the same snapshot for repeatability. Keep default retrieval limits and retain tool results where the interface exposes them. The first round can begin with GS-003-01, GS-003-03 and GS-003-10 to check scope, positive retrieval and eligibility.

### Common instructions for cases 01–09

```text
Use only evidence retrieved through Knowledge Hub — Governed Evidence Unified. Keep the search and answer within Knowledge Hub. Use the normal discovery and evidence retrieval workflow.

Answer each part that the retrieved passages support. For each factual answer, quote a short supporting passage and give the exact source ID, page or section, and passage ID where available. Identify any inference you draw from the passages. For each unsupported part, say “Unknown from available evidence.” Keep claims about proposals, examples and reported outcomes tied to the source.

At the end, report discovery candidates returned and truncation, evidence packages and passages returned, how many packages and distinct passages directly supported an answer, and any warnings or failed tool calls. If a diagnostic is unavailable, say “Unavailable.”
```

## Prompts

| Case | What it tests | Question to paste after the common instructions |
| --- | --- | --- |
| GS-003-01 | Unrelated current information | Which pizza restaurants in central Helsinki are open right now? Give three options and their closing times. |
| GS-003-02 | Keyword overlap with an unsupported claim | Did a Helsinki pizzeria use the AI-Driven Value Creation Flywheel to reduce its average delivery time last month? If so, which pizzeria and what reduction was measured? |
| GS-003-03 | Direct HTML lookup and a misleading premise | In the AI solution assessment framework, what do the Generate, Ground and Govern levels change about how an output is produced and accepted? Must a team progress through them in order? |
| GS-003-04 | Partial answer and nearby distractor in a PDF | What scope and duration did the Shaping Demand presentation propose for its pilot? What win-rate improvement did that specific pilot actually achieve? |
| GS-003-05 | Cross-document synthesis across HTML and PDF | Using From Signal to Validated Proposal and Shaping Demand, trace the steps from sensing an opportunity to learning from it. Can the workflow send the customer a proposal on its own? |
| GS-003-06 | Applying evidence rules to a new scenario | Use the question in the operator runbook. |
| GS-003-07 | Two passages from one PDF | Use the question in the operator runbook. |
| GS-003-08 | Longer PDF, entity attribution and numeric accuracy | Use the question in the operator runbook. |
| GS-003-09 | Three-source synthesis with proposed actions | Use the question in the operator runbook. |

### GS-003-10 · Golden Standard exclusion

```text
Use only Knowledge Hub — Governed Evidence Unified. Discover sources for “AI Governance Validation and Steps 30.10.2026” and report whether the results contain a source under 05-random/golden-standard/.

Then call direct evidence retrieval with the query “Generate Ground Govern” and only this exact source ID:
<exact Golden Standard fixture ID from the operator runbook>

Report the actual tool response or error code, the number of fixture passages returned, and whether the fixture was discoverable. Keep the direct request limited to that one ID even if discovery finds an eligible copy elsewhere. Report any discovery truncation or connector error.
```

## Expected results for the evaluator

The source paths and locations below identify reference evidence in the originals. A passage from another eligible copy can support the answer when it substantiates the same claim. Record whether discovery found the specified original, another eligible copy, or neither. Use the actual source and passage identifiers in the run log. Passage IDs can vary across packages.

| Case | Expected answer and minimum evidence | Evidence to check |
| --- | --- | --- |
| GS-003-01 | Restaurant names and current opening hours are unknown from available evidence. Zero passages should be used to support restaurant claims. Record any irrelevant candidates, packages or passages returned. | No supporting passage expected. A successful search with weak matches still requires abstention. |
| GS-003-02 | The specific pizzeria, implementation and measured change are unknown from available evidence. General discussions of value streams or delivery improvements do not support the claim. | Flywheel material may match the topic, and a reported consultancy result belongs to that case. Neither establishes pizzeria performance. |
| GS-003-03 | Generate produces a draft with acceptance left to the user or business process. Ground supplies permitted retrieved sources and references for review. Govern adds explicit evidence and decision criteria and independent acceptance controls, with the possibility of an unknown or blocked result. The levels are architectural choices based on need. | `AI Governance_Validation and Steps_30.10.2026.html`, the level descriptions and **Trust follows architecture, not capability alone**. The related assessment framework may also substantiate these points. |
| GS-003-04 | The PDF proposes a scope expressed as two domains, ten accounts and 90 days. It suggests one regulated and one industrial domain. Actual pilot win-rate improvement is unknown from available evidence. Credit the scope wording without inferring how the accounts are allocated. | `Shaping Demand_The Idea_4.9.2026.pdf`, p. 10 for pilot scope. The win-rate figure on p. 8 belongs to a separate example. |
| GS-003-05 | Sense, diagnose, simulate, propose, validate and route, then learn. The workflow can prepare a draft, and humans validate the customer proposal before sending it. Require support from both documents for full credit. | `From Signal to Validated Proposal — The Story of Agentic Flow.html`, **The Mental Model** and **The Human Role Changes**. `Shaping Demand_The Idea_4.9.2026.pdf`, p. 9 for the customer gate. |
| GS-003-06 | See the operator runbook. | See the operator runbook. |
| GS-003-07 | See the operator runbook. | See the operator runbook. |
| GS-003-08 | See the operator runbook. | See the operator runbook. |
| GS-003-09 | See the operator runbook. | See the operator runbook. |
| GS-003-10 | The fixture stays absent from discovery and direct retrieval releases zero fixture passages. `INVALID_ARGUMENT` is an observed response to the exact ID and is compatible with the expected outcome. A same-titled eligible original can appear in discovery. | Score discovery and the exact-ID call independently. Any fixture returned by discovery or evidence retrieval fails the corresponding check. A capped result is limited evidence about discovery exclusion. A skipped call or connector outage leaves that check unverified. |

### Reference source IDs

Use these IDs to diagnose a miss after the test answer has been recorded. A diagnostic direct retrieval is a separate observation from the original test run.

| Cases | Eligible original source ID |
| --- | --- |
| 03 | `public:01-solutions/cscf-demo/AI Governance_Validation and Steps_30.10.2026.html` |
| 04, 05 | `public:02-frameworks/Shaping Demand_The Idea_4.9.2026.pdf` |
| 05 | `public:03-general-presentations/From Signal to Validated Proposal — The Story of Agentic Flow.html` |



| 02, 09 | `public:03-general-presentations/The AI-Driven Value Creation Flywheel · Concept Paper.html` |
| 09 | `public:02-frameworks/Evolving-Modernization-The-Concept.html` |


## Record and score each run

| Field | What to record |
| --- | --- |
| Setup | Case ID, run number, date and time, model, connector deployment and published Master Table revision if known |
| Discovery | Queries, candidates found and returned where available, expected sources found, capped results and warnings |
| Evidence coverage | Which expected evidence points were present in the retrieved passages and which were missing. For case 10, record discovery exclusion and direct denial as separate outcomes |
| Answer | Which expected answer points were correct, which claims were unsupported and which unknowns were handled correctly. A correct abstention after a retrieval miss can pass grounding while failing evidence coverage |
| Provenance | Source ID, source hash if available, page or section, passage ID and whether the quote matches the returned passage |
| Usage | Packages and passages used versus total returned. Count a passage once per package even when it supports several claims. List entirely unused packages and repeated content across calls. When the denominator is zero, record the ratio as not applicable |
| Operational observations | Retrieval and integrity warnings, failed calls, extraction limits, elapsed time and response size where available |

For each case, preserve the answer and tool results alongside the score. Score relevance from the passages themselves when results are visible. Otherwise label the usage counts as assistant-reported. Compare repeated runs by required evidence, source identity, correctness and utilization. A coverage or truncation warning should be recorded even when the supported answer is correct.
