# Agente 4 — Contratos, autenticação e coordenação

Referência: AVL-359, AVL-387, AVL-399, AVL-407 e AVL-413.

Branch de trabalho: `codex/agente-4-contratos-auth-coordenacao`.

Este documento separa implementação, teste, CI, integração, publicação e fluxo autenticado. Nenhum nível é inferido a partir de outro.

## Situação das issues do Agente 4

| Issue | Implementação | Testes locais | CI | PR integrada | Deploy | Fluxo autenticado / aceite | Pendência atual |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AVL-359 | Matriz e catálogo atualizados | `contracts.test.mjs`: 9/9; `product-context.test.mjs`: 9/9 | Não acompanhado nesta sessão | Branch do Agente 4 | Não observado | Não verificado pelo catálogo | 34 fluxos pendentes; `p0Ready=false`; runtime não verificado |
| AVL-387 | Fluxo Auth → empresa e seleção server-side existentes; callback e diretório validam resposta, auto-seleção exige empresa ativa, corpos grandes são cancelados por stream, seleção limpa empresas obsoletas após falha de atualização e callback rejeita empresa pré-selecionada suspensa/arquivada | Cobertura sintética de zero/uma/múltiplas empresas, convites, expiração, retorno interno, resposta inválida no callback/diretório, metadata OIDC com userinfo, corpo acima do limite, descarte de lista obsoleta, empresa pré-selecionada inativa e empresa pré-selecionada ativa; configuração `test:auth` preparada para desktop e Pixel 5; `--list` confirmou 72 casos (36 por projeto); ESLint direcionado aprovado | Não acompanhado nesta sessão | Branch do Agente 4 | Não observado | Banco integrado não validado | Executar a suíte quando servidor/browser forem autorizados; confirmar vínculo e persistência com PostgreSQL isolado e ambiente autorizado |
| AVL-399 | Leitor Ruby com validações de caminho existentes | `product-context.test.mjs`: 9/9; captura completa executada com 51 fluxos e 249 ações | Não acompanhado nesta sessão | Correção já presente no histórico | Snapshot publicado não observado | Execução funcional não observada | Conferir snapshot da versão publicada |
| AVL-407 | Nenhuma implementação técnica, conforme escopo | N/A | N/A | N/A | N/A | Aceite comercial pendente | Levantar escopo do ERP; AVL-406 é o catálogo separado do projeto Lojas |
| AVL-413 | Marco administrativo, sem código próprio | N/A | N/A | N/A | N/A | Aceite do prazo pendente | Consolidar 20 issues, bloqueios, dependências e checklist de entrega |

## Limites de validação

- Captura de contexto não equivale a publicação do portal de contratos. A captura estática mais recente foi gerada no commit `ad0e137c3d8613b2cca47e9aacd396a68206716f`, com SHA de conteúdo `ec2ffd2f7834efc251855941d9cf9e474f63d68b8ce8492bb1497a0f97ea2d9c`, 51 fluxos, 249 ações e 34 grupos pendentes; publicação e execução permanecem não observadas.
- Verificação pública pontual em 06/11/2026: `https://erp.avilaops.com/health/ready` redireciona `307` para autenticação; `https://contrato.avilaops.com/integracoes/mcp` responde `200`; `https://contrato.avilaops.com/mcp` responde `401` sem Bearer. Esses sinais comprovam apenas a presença do gateway público e sua proteção, não saúde autenticada, snapshot publicado ou execução de fluxo.
- Contrato estático não equivale a execução autenticada.
- Teste sintético não equivale a vínculo real no PostgreSQL.
- PR ou branch não equivale a código integrado na versão publicada.
- AVL-407 e AVL-413 não autorizam migrations, build, deploy ou alteração de produção.
- Esta revisão não executa build, não inicia servidor e não acompanha CI/CD.
- A revisão adicional do callback corrigiu a autorização de empresa pré-selecionada: somente vínculo com `status=active` prossegue; a regressão está coberta no inventário sintético, mas a execução Playwright continua não realizada por restrição operacional.

## Coordenação dos demais agentes

Os estados abaixo são os estados atuais do Linear consultados em 2026-11-06. Eles não representam aprovação de implementação, CI, integração ou deploy.

| Agente | Issues e estado no Linear | Branch/worktree | Evidência consolidada nesta revisão |
| --- | --- | --- | --- |
| Agente 1 — Fiscal e CI | AVL-320 `In Review`; AVL-396 `In Review`; AVL-110 `Backlog`; AVL-136 `In Progress`; AVL-358 `In Progress` | `codex/agente-1-fiscal-ci` / `erp-next-agent1-fiscal-ci` | Estado administrativo consultado; não auditado tecnicamente |
| Agente 2 — Comercial e Operação | AVL-432 `In Progress`; AVL-370 `In Review`; AVL-319 `Backlog`; AVL-17 `In Progress`; AVL-369 `In Review` | `codex/agente-2-comercial-operacao` / `erp-next-agent2` | Estado administrativo consultado; não auditado tecnicamente |
| Agente 3 — Preferências e Integrações | AVL-372 `In Progress`; AVL-378 `Todo`; AVL-379 `Backlog`; AVL-380 `Backlog`; AVL-381 `Backlog` | `codex/agente-3-preferencias-integracoes` / `erp-next-agent3-preferencias` | Estado administrativo consultado; não auditado tecnicamente |
| Agente 4 — Contratos, Auth e Coordenação | AVL-359 `In Progress`; AVL-387 `In Progress`; AVL-399 `In Progress`; AVL-407 `Backlog`; AVL-413 `Backlog` | `codex/agente-4-contratos-auth-coordenacao` / `erp-next-agent4` | Parcialmente consolidado acima |

## Pendências contratuais atuais da AVL-359

A lista abaixo é derivada diretamente de `verification/contracts.json`. A presença de uma linha não significa implementação, execução ou aceite.

| ID | Intenção pendente |
| --- | --- |
| `preferences-system` | Exclusões, arquivos, relatórios, etiquetas, transições e campos customizados observados nas capturas do usuário. |
| `preferences-records` | Configurações de clientes, fornecedores, produtos e tipos de contatos. |
| `preferences-supplies` | Configurações de estoque/compras, grupos de tags, tags, grupos de produtos e depósitos operacionais. |
| `preferences-sales-next` | Concluir propostas e PDV após a etapa inicial dos parâmetros de pedidos. |
| `preferences-fiscal-next` | Configurações de NFC-e, inutilizações/correções consolidadas e naturezas de operação. |
| `preferences-finance-next` | Conta digital, Pix, taxas/prazos, importação financeira, caixa e integrações de pagamento. |
| `preferences-services` | NFS-e, ordens de serviço, cobranças e CT-e; preservar os modelos de contrato existentes. |
| `preferences-logistics` | Configuração logística e integrações de transporte. |
| `preferences-accounting` | Substituir a prévia por acesso e exportações contábeis autorizados. |
| `preferences-data` | Produtos, multilojas, composições, campos, balança, preços, contatos, compras, movimentos, fornecedores, vendas e backup. |
| `pending-2` | Categorias de produto, variantes, imagens, tabela/lista de preços, vigência e preço por canal/cliente. |
| `pending-3` | Endereços e contatos no cadastro implementados neste módulo; condições comerciais e seleção de endereço de cobrança/entrega por documento ainda pendentes. |
| `pending-4` | Cadastros de depósitos implementados; transferências e saldos por depósito permanecem pendentes. |
| `pending-5` | Abrir sessão, contar/recontar, apurar diferença, aprovar/fechar. |
| `pending-6` | Ordens por venda, etapas, consumos explícitos e compensações implementados; ficha técnica, reservas industriais e estoque acabado fora do fluxo. |
| `pending-8` | Importação canônica, deduplicação, vínculo e custos por item para rascunho de compra implementados; divergências parciais e aceite real ainda pendentes. |
| `pending-9` | Consultar demanda/recomendação e converter seleção em pedido. |
| `pending-11` | Abrir caixa/sessão, registrar venda, confirmar meios, cancelar/estornar e fechar. |
| `pending-12` | Cancelamento integral e solicitações fiscal/contratual implementados; descontos, frete, devoluções parciais e expedição ainda pendentes. |
| `pending-13` | Conectar catálogo, publicar/atualizar anúncio, importar pedido e sincronizar eventos. |
| `pending-14` | Abrir protocolo, verificar elegibilidade, triar, aprovar, encaminhar OS, reparar/trocar/devolver/encerrar. |
| `pending-16` | Consultar livro/saldo, importar extrato, sugerir/confirmar/desfazer conciliação e transferir. |
| `pending-17` | Selecionar títulos, gerar lote, importar retorno, conciliar e desagrupar conforme regras. |
| `pending-18` | Base por recebimento sem IPI, snapshots, estornos, ajustes e pagamentos declarados implementados; extensões e aceite operacional não comprovados. |
| `pending-19` | Emissão, consulta e eventos SP/homologação implementados com A1, numeração e resultados duráveis; emissão em produção permanece bloqueada. |
| `pending-20` | Habilitar e verificar a distribuição e manifestação implementadas com certificado e CNPJ autorizados. |
| `pending-21` | NFC-e, CT-e, NFS-e, guias e rotinas contábeis. |
| `pending-22` | Selecionar pedido, separar/conferir, cotar, contratar, gerar/baixar etiqueta, postar, rastrear e tratar reversa. |
| `pending-23` | Criar/versionar contrato, abrir/atribuir/executar/encerrar OS, faturar e cobrar. |
| `pending-24` | Criar envelope, enviar, acompanhar, cancelar e arquivar documento assinado. |
| `pending-25` | Consultar indicadores, detalhe, filtros e exportação. |
| `pending-26` | Consultar eventos, marcar leitura e executar somente ações autorizadas explicitamente. |
| `pending-27` | Consultar/alterar configuração por empresa; conectar/revogar, testar conexão e sincronizar. |
| `pending-28` | Pré-validar arquivo, revisar lote, aplicar, consultar resultado e exportar autorizado. |
