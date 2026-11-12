# Integrações e chaves de serviço

[Todas as telas](../../../README.md) · [Preferências](../README.md)

Consultar as integrações e gerenciar as credenciais de serviço disponíveis.

**Onde acessar:** `/preferencias/integracoes`.

## O que aparece na tela

- Integração e estado
- Chaves e permissões da integração com lojas

## O que você pode fazer

- Consultar a configuração de cada provedor
- Criar ou revogar chaves autorizadas

## Regras e limites

A presença de um provedor no catálogo não comprova que ele esteja conectado. Confira o estado e as ações da própria integração.

## Referências para manutenção

Guia conferido no código de 12/11/2026. As ações dependem das permissões e da configuração da empresa. Relatos técnicos antigos descrevem a etapa em que foram escritos.

- [INTEGRACAO-LOJAS-NOTAS-RECEBIDAS](referencias/INTEGRACAO-LOJAS-NOTAS-RECEBIDAS.md)
- [integrations-catalog](../../../../apps/web/src/features/integrations/integrations-catalog.tsx)
- [service-keys](../../../../apps/web/src/features/integrations/service-keys.tsx)
