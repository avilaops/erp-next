# Arquitetura inicial

## Decisões

1. O ERP é um monólito modular. Serviços independentes só surgem com evidência operacional.
2. Toda operação empresarial carrega um `tenant_id` validado na API e reforçado pelo PostgreSQL.
3. Auth Ávila Ops prova identidade; o ERP controla empresa, associação, papéis e permissões.
4. Movimentos financeiros, fiscais e de estoque usam cancelamento ou estorno, nunca exclusão destrutiva.
5. Eventos externos são gravados na mesma transação do domínio usando outbox.
6. Integrações precisam de chave de idempotência e reconciliação para efeitos de resultado desconhecido.

## Limites dos domínios

| Domínio | Responsabilidade inicial |
| --- | --- |
| Plataforma | Empresas, identidade, associação, permissões, auditoria e outbox |
| Cadastros | Produtos, pessoas, vendedores, funcionários e tabelas auxiliares |
| Comercial | Propostas, pedidos, PDV, anúncios e loja virtual |
| Estoque | Saldos derivados, movimentos, depósitos, compras e produção |
| Financeiro | Obrigações, liquidações, conciliação, caixa e comissões |
| Fiscal | NF-e, NFC-e, CT-e, NFS-e, eventos e monitoramento |
| Logística | Expedição, etiquetas, postagem e reversa |
| Serviços | Contratos, ordens, medições e cobranças |

## Primeiro fluxo vertical

O primeiro fluxo funcional será pedido de venda com reserva de estoque. Ele deve provar contexto de empresa, autorização, transação, auditoria e outbox antes de expandirmos o catálogo de telas.

