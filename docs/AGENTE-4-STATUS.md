# Agente 4 — Contratos, autenticação e coordenação

Referência: AVL-359, AVL-387, AVL-399, AVL-407 e AVL-413.

Branch de trabalho: `codex/agente-4-contratos-auth-coordenacao`.

Este documento separa implementação, teste, CI, integração, publicação e fluxo autenticado. Nenhum nível é inferido a partir de outro.

## Situação das issues do Agente 4

| Issue | Implementação | Testes locais | CI | PR integrada | Deploy | Fluxo autenticado / aceite | Pendência atual |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AVL-359 | Matriz e catálogo atualizados | `contracts.test.mjs`: 9/9; `product-context.test.mjs`: 9/9 | Não acompanhado nesta sessão | Branch do Agente 4 | Não observado | Não verificado pelo catálogo | 34 fluxos pendentes; `p0Ready=false`; runtime não verificado |
| AVL-387 | Fluxo Auth → empresa e seleção server-side existentes | Cobertura sintética de zero/uma/múltiplas empresas, convites, expiração e retorno interno registrada | Não acompanhado nesta sessão | Branch do Agente 4 | Não observado | Banco integrado não validado | Confirmar vínculo e persistência com PostgreSQL isolado e ambiente autorizado |
| AVL-399 | Leitor Ruby com validações de caminho existentes | `product-context.test.mjs`: 9/9; captura completa executada com 51 fluxos e 249 ações | Não acompanhado nesta sessão | Correção já presente no histórico | Snapshot publicado não observado | Execução funcional não observada | Conferir snapshot da versão publicada |
| AVL-407 | Nenhuma implementação técnica, conforme escopo | N/A | N/A | N/A | N/A | Aceite comercial pendente | Levantar escopo do ERP; AVL-406 é o catálogo separado do projeto Lojas |
| AVL-413 | Marco administrativo, sem código próprio | N/A | N/A | N/A | N/A | Aceite do prazo pendente | Consolidar 20 issues, bloqueios, dependências e checklist de entrega |

## Limites de validação

- Captura de contexto não equivale a publicação do portal de contratos.
- Contrato estático não equivale a execução autenticada.
- Teste sintético não equivale a vínculo real no PostgreSQL.
- PR ou branch não equivale a código integrado na versão publicada.
- AVL-407 e AVL-413 não autorizam migrations, build, deploy ou alteração de produção.
- Esta revisão não executa build, não inicia servidor e não acompanha CI/CD.

## Coordenação dos demais agentes

Os estados abaixo são os estados atuais do Linear consultados em 2026-11-06. Eles não representam aprovação de implementação, CI, integração ou deploy.

| Agente | Issues e estado no Linear | Branch/worktree | Evidência consolidada nesta revisão |
| --- | --- | --- | --- |
| Agente 1 — Fiscal e CI | AVL-320 `In Review`; AVL-396 `In Review`; AVL-110 `Backlog`; AVL-136 `In Progress`; AVL-358 `In Progress` | `codex/agente-1-fiscal-ci` / `erp-next-agent1-fiscal-ci` | Estado administrativo consultado; não auditado tecnicamente |
| Agente 2 — Comercial e Operação | AVL-432 `In Progress`; AVL-370 `In Review`; AVL-319 `Backlog`; AVL-17 `In Progress`; AVL-369 `In Review` | `codex/agente-2-comercial-operacao` / `erp-next-agent2` | Estado administrativo consultado; não auditado tecnicamente |
| Agente 3 — Preferências e Integrações | AVL-372 `In Progress`; AVL-378 `Todo`; AVL-379 `Backlog`; AVL-380 `Backlog`; AVL-381 `Backlog` | `codex/agente-3-preferencias-integracoes` / `erp-next-agent3-preferencias` | Estado administrativo consultado; não auditado tecnicamente |
| Agente 4 — Contratos, Auth e Coordenação | AVL-359 `In Progress`; AVL-387 `Todo`; AVL-399 `Todo`; AVL-407 `Backlog`; AVL-413 `Backlog` | `codex/agente-4-contratos-auth-coordenacao` / `erp-next-agent4` | Parcialmente consolidado acima |
