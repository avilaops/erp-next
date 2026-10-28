# SDD ledger — plan: docs/superpowers/plans/2026-10-28-fiscal-lojas.md

2026-10-28: usuário aprovou plano e execução direta.
Branch isolada remota: codex/avl-360-fiscal-vertical-design-20261028; PR13 existente.
Base documental e633491; base atual main713e007; PR4 permanece aberto.
Nenhum teste/build local nem banco/produção utilizado.

Pre-flight: T1→T2: fichas descrevem futura importação; T2 fornece apenas política pura e alias.
Pre-flight: T2→T4: ReceivedMetadata deve manter centavos exatos e dados originais; sem gravação em T2.
Pre-flight: T3→T5: ServiceIdentity é separada de OIDC; ainda bloqueadas pela P0.
Ruling: usar branch remota e commits GitHub como workspace/ledger, sem clone/worktree local — conector suficiente e teste local proibido — custo: scripts locais de bookkeeping substituídos por registro versionado.
Ruling: atualizar branch com main713e007 preservando ambos os históricos — main já integrou AVL343/OpenAPI e limites de CI — custo: revisar os novos checks herdados, sem ampliar pipeline.
Ruling: catálogo PR4 só será alterado após integração — não duplicar implementação pendente — custo: T1 permanece definição complementar fora do catálogo até essa dependência fechar.

T1: fichas complementares escritas; atualização do catálogo bloqueada por PR4.
T2: testes sendo preparados para RED em GitHub CI.
T3–T6: bloqueadas; AVL359 p0Ready=false,28 famílias pendentes.

T1 verification: inventory40657702330 passed; PR4 catalog integration remains pending.
T2 RED: de152575, CI40657876380. Rust72 passed/4 failed:
received_metadata_is_exact, received_requires_exact_recipient (unimplemented policy);
health_alias_uses_readiness, health_alias_returns_ready_for_existing_database (401 before alias).
Formatting differences in tests also observed and corrected.
Ruling: inherit main's bounded jobs unchanged — existing CI is now split by AVL343 — cost: workflow elapsed time includes dependencies/queue, each job retains its existing limit.
T2 GREEN implementation submitted for CI; not yet declared passed.

2026-10-28: usuário autorizou automatizar merge e exclusão da branch.
T2 initial GREEN: CI40658296271 rust job76 passed/0 failed, web/browser succeeded.
Ruling: add one operational cleanup workflow scoped to merged PR13 and its exact branch — explicitly requested by user, not a validation-job expansion — cost: contents:write confined to post-merge cleanup without checkout; branch is preserved if its SHA differs from merged head.
Native repository allow_auto_merge=false/delete_branch_on_merge=false observed.

Final review by independent reviewer (fiscal_code_review): no critical/minor findings;
three Important findings (scalar truncation, CPF14 tag, non-ISO datetime separator).
RED reproduced in1e47847/CI40658911555:76 passed/3 failed, all named regressions.
Fix pass: reject comment/PI content in every scalar including inherited fields;
require actual dest/CNPJ; require lexical T separator before date parser.
Final: Ruling: T3/T5 old-token/CNPJ, T4 receipts/atomicity, T5 PDF-corruption and T6 UI-switch criteria are explicitly not implemented — P0 gate prevents them — cost: no operational fiscal integration yet.
Final: Ruling: XSD/XMLDSig/MCP/SEFAZ attestation remains separate — this is structural inspection only — cost: no fiscal-authenticity claim from pure tests.
Final: Ruling: PR4 catalog integration remains pending — preserve unmerged work — cost: complementary fichas not yet centrally validated.
Final: Ruling: accept standard GET-ref→DELETE-ref cleanup race after merged-branch SHA check — user authorized deletion; do not push to merged branch — cost: a concurrent push in that interval could be deleted, with commits still recoverable from PR/history.
Final: Ruling: merge requires CI+inventory for final head, not previous success — cost: queued checks can postpone merge.
No deferred minors.

Task 2: complete (de152575..5edf182; GitHub CI40659258353):
79 Rust tests passed,0 failed/ignored in13.40s; rust-build/rust-lint/web/web-lint/
contract-tests/web-browser succeeded. Inventory40659258296 succeeded.
Final: fixed scalar truncation — received_refuses_split_scalar_content RED→GREEN.
Final: fixed CPF14 masquerading as CNPJ — received_requires_cnpj_element_not_just_matching_digits RED→GREEN.
Final: fixed datetime separator — received_requires_iso_datetime_separator RED→GREEN.
Each fix belongs to the single final fix pass; whole Rust suite79/79 green.
Full workflow gate/baseline/contracts still pending at this record; latest final-SHA
CI+inventory success remains a mandatory condition before automated merge.

Task 1: complementary action fichas complete; PR4 central-catalog integration pending.
T3–T6: blocked by AVL359; no model, migration, grant, persistence/service token,
received-note API, XML/PDF downloads or production work implemented here.
T7: partial review/evidence complete; operational homologation not authorized.

Merge/cleanup authorization: user explicitly requested automatic merge and branch
deletion. Hourly condition watch created, scoped only PR13 and exact reviewed SHA
published by AVL360_MERGE_READY PR comment. It must require final-SHA CI+inventory,
honor required checks/reviews, merge squash, verify cleanup workflow and branch
absence, then pause itself. Native auto_merge/delete settings remain false;
no global settings changed. No validation job or timeout added by this branch.
