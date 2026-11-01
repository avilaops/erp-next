# Devoluções e continuidade fiscal

Solicitação: implementar no ERP Next as capacidades de devolução/cancelamento,
emissão/eventos NF-e e distribuição/aproveitamento de recebidas identificadas na
comparação com o ERP legado. Ticket: AVL-396. Base: `8c0f7db`.

## Decisões

- Preservar Rust/Axum/SQLx, PostgreSQL e o BFF Next existentes.
- Reversões são compensações append-only na mesma transação das alterações de
  estado, revisão, auditoria, outbox e idempotência. Não apagar movimentos.
- Cancelar venda concluída exige motivo e permissões de estoque e financeiro;
  recompõe estoque e reverte recebimentos declarados, cancelando o título.
  Reverter recebimento de compra exige saldo físico disponível e reconciliação
  do título/pagamentos. Bloquear novas baixas de títulos cancelados.
- Domínios de comissão e produção ainda não existem no Next. Registrar efeitos
  de cancelamento na outbox sem inventar liquidação nesses domínios.
- Reutilizar o motor XML/assinatura/XSD/SOAP do legado em serviço interno Node,
  com autenticação, destinos SEFAZ fixos, limites de tamanho e respostas sem
  segredos. A API Rust permanece dona dos estados e certificados criptografados.
- Persistir preparação assinada antes de transmitir. Timeout não significa
  rejeição: consultar/reconciliar antes de reenviar e nunca renumerar a tentativa.
- Implementar autorização, consulta, cancelamento, CC-e e inutilização no
  recorte NF-e 55/SP em homologação já coberto pelo legado. Produção continua
  bloqueada até homologação operacional separada, sem emissão real nesta sessão.
- Distribuição conserva NSU e documentos por empresa/ambiente, respeita intervalo
  após 137/656 e não avança cursor sem persistir o lote. Manifestação conserva
  solicitação e resultado, sem declarar sucesso por timeout.
- Conversão de recebida exige fornecedor/produtos explicitamente mapeados;
  preserva XML e custos por item e cria compra em rascunho. Recebimento físico e
  contas a pagar continuam na cadeia normal; importar nota não movimenta estoque.
- Expor operações reais pela API/BFF e documentar contratos e configuração.
  Não migrar banco, publicar, enviar notas ou alterar produção nesta sessão.

## Validação

PostgreSQL 18 isolado, papel sem BYPASSRLS, testes HTTP de permissões, empresa,
idempotência, revisão, concorrência e rollback. Adaptador externo exercitado com
transporte de teste e XMLs sintéticos. Verificações Rust e web pertinentes.
