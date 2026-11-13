# Golden Standard fixture corpus

The 15 synthetic documents in [corpus-v1.json](corpus-v1.json) support nine repeatable requests. Two documents are deliberate distractors. The manifest records the required source files and expected answers. Juniper Harbor (GS-001) remains the separate lifecycle case in PR #9.

Generate the 15 upload files with `python3 tests/golden-standards/generate-corpus.py /tmp/knowledge-hub-fixtures`. The generator requires ReportLab.

## Production exclusion check

1. In the Knowledge Hub admin UI, select **Random → Golden Standard**. Run **Create Folder Structure** to create the private Blob prefix if needed.
2. Upload the generated documents to **Private → 05-random/golden-standard/**. Run **Update the Master Table**. The path assigns the fixed **Golden Standard** status and the status control is read-only. Keep the prompts and expected results in this repository.
3. Verify the fixture files open in the administrator viewer and can be filtered by **Golden Standard** in the Master Table. Use normal Unified Governed Evidence to search for a distinctive fixture name, then request its exact fixture ID. Discovery must return no fixture, and direct retrieval must release no fixture passages. Check both before and after publishing the table.

## Positive retrieval baseline

Run the nine prompts in an isolated Knowledge Hub deployment connected to separate test Blob stores and its own Master Table. Upload test copies into normal category paths, such as `03-general-presentations/`, and approve and publish them in that test table. Use the Public test store for the manifest entry marked `test_access: public` and Private for the others. Connect to the test deployment's Unified connector. The test copies exercise the same normal retrieval and approval path against a controlled corpus. The production fixture prefix remains ineligible even if a snapshot erroneously labels a fixture Approved.

For each case capture the deployment, snapshot, model, raw tool responses, source and passage hashes, cited passage IDs, warnings, and the answer. Mark whether each required evidence fact was retrieved, whether each answer claim is supported, and whether quotes match the raw passage. Record useful passages divided by returned passages, candidate counts, and truncation separately. Treat an extraction or coverage warning as its own observation. For GS-002-08 and GS-002-09 retain the raw passage or extraction diagnostics to verify reading order and coverage. Repeat on the same source versions before establishing the baseline. Preserve the connector's default output limits for the comparison.
