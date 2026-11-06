# AVL-319, garantias e assistência técnica

O backend registra políticas por empresa, protocolos vinculáveis a cliente, pedido,
produto, série e lote, timeline append-only, transições de atendimento e uma ordem
de serviço por protocolo. Todas as gravações usam RLS, revisão, Idempotency-Key,
auditoria e outbox.

Esta etapa não inventa CFOP, não emite documento fiscal, não movimenta peças ou
produtos em estoque e não registra transferência bancária. RMA, logística reversa,
quarentena, peças, crédito e reembolso exigem contratos próprios antes de gerar
efeitos transacionais nesses domínios.
