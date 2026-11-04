# Recebimento, manifestação e conciliação de NF-e

**Tickets:** AVL-91, AVL-94, AVL-97.

**Objetivo:** completar o fluxo existente de distribuição canônica, manifestação
explícita e vínculo de XML a compras, preservando estoque/financeiro até o
recebimento físico confirmado pelo operador.

**Arquitetura:** Rust/Axum/SQLx mantém autorização, RLS, transações e auditoria.
Next.js apresenta prévia e comandos pelo BFF existente. Reutilizar os livros
de compras, recebimentos, estoque e contas a pagar. Nenhum produto/fornecedor
é cadastrado automaticamente. Nenhum crédito tributário é inferido.

## Escopo e decisões

- Eventos completos distribuídos pela SEFAZ fornecem evidência correlacionada
  por ambiente, chave, autor, tipo, sequência e protocolo. Resumos de evento
  continuam preservados, sem inferir o conteúdo que não carregam.
- O monitor reconcilia manifestações pendentes/incertas no mesmo commit do
  lote e cursor; nunca retransmite para descobrir o resultado.
- Manifestação aceita XML completo ou resumo autorizado e recusa documentos
  com cancelamento conhecido. Ciência após manifestação conclusiva é recusada.
- Conciliação com compra existente exige prévia e revisão atual. Divergências
  de fornecedor, produto, unidade, quantidade ou custo impedem o vínculo;
  diferenças de NCM são informadas sem alterar classificação tributária.
- O vínculo é documental e idempotente. Recebimento parcial usa o comando
  existente de compras, limitado ao documento vinculado. Cancelamento fiscal
  posterior bloqueia novos recebimentos, preservando histórico e permitindo
  estorno explícito pelo fluxo já existente.
- Preservar a restrição existente de uma NF-e por compra nesta entrega.
  Múltiplas NF-e por pedido e segunda ocorrência do mesmo tipo de manifestação
  exigem evolução específica do esquema; não ficam implicitamente habilitadas.
- A autorização de deploy de 03/11/2026 foi substituída em 04/11/2026 pela
  instrução de resolver e integrar os PRs sem publicar no servidor. O deploy
  fica para uma etapa posterior. Consulta real e transmissão de manifestações
  continuam dependentes de comandos explícitos do operador.

## Plano e verificação

- [ ] AVL-91/94: testes de evento distribuído, reconciliação e cancelamento;
  implementação da evidência e integração atômica no monitor.
- [ ] AVL-94: testes e implementação de elegibilidade de XML completo,
  cancelamento conhecido e transição de ciência após conclusão.
- [ ] AVL-97: prévia e vínculo de compra existente com revisão/idempotência,
  NCM e componentes de custo; limites de recebimento e cancelamento posterior.
- [ ] Interface: seleção da compra, mapeamento e prévia de divergências,
  confirmação documental separada do recebimento físico; BFF e OpenAPI.
- [ ] Verificação: Rust com PostgreSQL isolado, lint/typecheck web, navegador
  nos tamanhos existentes, arquitetura e revisão do diff. Registrar limites.

## Progresso

- Base: `396826c`; branch `codex/avl-91-94-97-recebimento-nfe`.
- Alterações locais preexistentes em documentação e catálogo foram preservadas.
- As três issues foram movidas de In Review para In Progress.
- A ferramenta Linear `get_agent_context` devolveu `Tool not found`;
  o código e as descrições atuais dos tickets orientam o trabalho.
- Release isolada em `/home/avops/projetos/erp-nfe-release-20261103`, sobre
  `ff06134`, preservando as entregas publicadas posteriormente à base inicial.
