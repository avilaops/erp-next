# Plataforma

Esta pasta atende a operação da conta ERP e os serviços usados pelos domínios:
identidade, autorização, empresas, convites, onboarding, auditoria, preferências,
assinatura da conta, estado da aplicação e observabilidade.

`subscriptions/` trata a assinatura do próprio ERP. As finanças comerciais da
empresa pertencem a `domains/finance`; suas configurações ficam em
`domains/finance/settings.rs`. Regras de vendas, estoque e fiscal pertencem a
seus domínios. Não criar um segundo conjunto dessas regras em `platform/`.

Consulte o [mapa completo](../../../../architecture/README.md).
