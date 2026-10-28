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
