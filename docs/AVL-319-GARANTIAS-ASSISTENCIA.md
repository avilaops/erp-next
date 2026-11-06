# AVL-319, garantias e assistência técnica

O backend registra políticas por empresa, protocolos vinculáveis a cliente, pedido,
produto, série e lote, timeline append-only, transições de atendimento e uma ordem
de serviço por protocolo. Todas as gravações usam RLS, revisão, Idempotency-Key,
auditoria e outbox.

Também estão implementados os registros de peças utilizadas, decisões de aprovação
por alçada, RMA com transições de status e quarentena com movimentação autorizada
no livro de estoque. A triagem agora também persiste fila, responsável ativo e
vencimento de SLA com revisão, idempotência e timeline. Esses registros preservam snapshots e histórico, mas não
afirmam efeitos que o contrato ainda não suporta.

Limites explícitos do contrato atual: não inventar CFOP, não emitir documento
fiscal, não registrar transferência bancária, não executar logística reversa física,
não efetivar troca/devolução/crédito/reembolso e não lançar custo de recuperação
no financeiro sem contratos dos domínios fiscal, logística e financeiro. O RMA é
um controle operacional de solicitação e acompanhamento; a quarentena é a única
ação desta frente que movimenta estoque.

Ainda pendentes para o aceite integral de AVL-319: anexos/evidências, SLA e fila
com responsável, matriz completa de elegibilidade por canal/fornecedor/marca/
categoria, efeitos transacionais de reparo/troca/devolução/crédito/reembolso,
logística reversa física, assinaturas/termos, eventos específicos para n8n e
indicadores conciliados com fontes de origem. Sem esses contratos, a aplicação
deve expor estado ausente ou indisponível, nunca um indicador fictício.
