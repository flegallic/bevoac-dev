# Bevoac V5.3 - Documentation inventory and duplicate review

## Active V5.3 documents

- `Runbook_Bevoac_V5_3_Production_Ready_Ultime.docx`
- `Comparatif_Runbooks_Bevoac_V4_2_V5_1_V5_2_V5_3.docx`
- `operations/runbook-v5-3-production-ready.md`
- `operations/production-acceptance-v5-3.md`
- `operations/tenant-isolation-v5-3.md`
- `operations/outbox-publisher-v5-3.md`
- `operations/apim-v5-3.md`
- `operations/load-test-multitenant-v5-3.md`
- `operations/terraform-private-network-v5-3.md`
- `operations/release-evidence-v5-3.md`

## Historical documents to keep, but not use as active client runbook

These documents are not useless, but they should be treated as historical references:

- `Runbook_Bevoac_V5_2_Production_Ready_Ultime.docx`
- `Runbook_Bevoac_V5_2_Production_Ready_Complet.docx`
- `operations/runbook-v5-2-production-ready-complet.md`
- `operations/runbook-alignment-v5-1-to-v5-2.md`
- `Comparatif_Runbooks_Bevoac_V4_2_V5_1_V5_2.docx`
- source runbooks under `sources/` or `_source_reference/`.

## Do not delete without approval

Do not delete historical runbooks automatically. Recommended next step: move them to `docs/archive/legacy-v4-v5-2/` in a dedicated documentation cleanup PR, preserving traceability.

## Potential confusion if left at root of docs

If V5.2 documents remain next to V5.3 documents without an archive marker, operators may use an obsolete runbook. This is a documentation risk, not a runtime risk.
