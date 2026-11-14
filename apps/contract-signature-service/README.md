# Contratos • Serviço privado de validação

Em implementação conforme
[especificação](../../docs/superpowers/specs/2026-11-14-contract-validator-service-design.md)
e [plano](../../docs/superpowers/plans/2026-11-14-contract-validator-service.md).
Não publicar endpoints nem habilitar assinaturas pessoais antes dos gates.

O núcleo 0.2.0 continua isolado. Coleta restrita de evidências, worker Linux
sem rede, gateway privado e bundle reproduzível compõem este serviço.
Não possui acesso a banco, DocuSeal, vault fiscal ou chaves dos titulares.

Executar testes na raiz:

```powershell
uv run --frozen --project apps/contract-signature-service python -m unittest discover -s apps/contract-signature-service/tests -p 'test_*.py'
```

Cada consulta HTTP deve executar em subprocesso supervisionado de até 3 s,
incluindo DNS e corpo. Timeouts de socket por inatividade não substituem esse
limite. As regras de destinos são locais e nunca vêm de um PDF recebido.
