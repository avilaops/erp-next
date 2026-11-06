# Agente 4 — Contratos, autenticação e coordenação

Referência: AVL-359, AVL-387, AVL-399, AVL-407 e AVL-413.

Branch de trabalho: `codex/agente-4-contratos-auth-coordenacao`.

Este documento separa implementação, teste, CI, integração, publicação e fluxo autenticado. Nenhum nível é inferido a partir de outro.

## Situação das issues do Agente 4

| Issue | Implementação | Testes locais | CI | PR integrada | Deploy | Fluxo autenticado / aceite | Pendência atual |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AVL-359 | Matriz e catálogo atualizados | Verificador documental registrado | Não acompanhado nesta sessão | Branch do Agente 4 | Não observado | Não verificado pelo catálogo | 34 fluxos pendentes; `p0Ready=false`; runtime não verificado |
| AVL-387 | Fluxo Auth → empresa e seleção server-side existentes | Cobertura sintética de zero/uma/múltiplas empresas, convites, expiração e retorno interno registrada | Não acompanhado nesta sessão | Branch do Agente 4 | Não observado | Banco integrado não validado | Confirmar vínculo e persistência com PostgreSQL isolado e ambiente autorizado |
| AVL-399 | Leitor Ruby com validações de caminho existentes | Captura do arquivo Ruby e teste de segurança registrados; teste da captura completa incluído nesta revisão | Não acompanhado nesta sessão | Correção já presente no histórico | Snapshot publicado não observado | Execução funcional não observada | Confirmar captura completa e snapshot da versão publicada |
| AVL-407 | Nenhuma implementação técnica, conforme escopo | N/A | N/A | N/A | N/A | Aceite comercial pendente | Levantar escopo, responsáveis e aceite de Godoi |
| AVL-413 | Marco administrativo, sem código próprio | N/A | N/A | N/A | N/A | Aceite do prazo pendente | Consolidar 20 issues, bloqueios, dependências e checklist de entrega |

## Limites de validação

- Captura de contexto não equivale a publicação do portal de contratos.
- Contrato estático não equivale a execução autenticada.
- Teste sintético não equivale a vínculo real no PostgreSQL.
- PR ou branch não equivale a código integrado na versão publicada.
- AVL-407 e AVL-413 não autorizam migrations, build, deploy ou alteração de produção.
- Esta revisão não executa build, não inicia servidor e não acompanha CI/CD.

## Coordenação dos demais agentes

Os status dos Agentes 1, 2 e 3 precisam ser preenchidos a partir das evidências próprias de cada branch e issue. Nenhum estado é inferido neste documento.

| Agente | Issues | Evidência consolidada nesta revisão |
| --- | --- | --- |
| Agente 1 — Fiscal e CI | AVL-320, AVL-396, AVL-110, AVL-136, AVL-358 | Não auditado nesta revisão |
| Agente 2 — Comercial e Operação | AVL-432, AVL-370, AVL-319, AVL-17, AVL-369 | Não auditado nesta revisão |
| Agente 3 — Preferências e Integrações | AVL-372, AVL-378, AVL-379, AVL-380, AVL-381 | Não auditado nesta revisão |
| Agente 4 — Contratos, Auth e Coordenação | AVL-359, AVL-387, AVL-399, AVL-407, AVL-413 | Parcialmente consolidado acima |
