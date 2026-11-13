# Contract signature validator core

Em desenvolvimento. Núcleo isolado de validação, sem função de assinatura, rede, banco ou acesso ao portal. Não habilita o fluxo produtivo nem declara homologação ICP-Brasil individual.

Especificação: [assinatura individual](../../docs/telas/servicos/contratos/referencias/ASSINATURA-ICP-INDIVIDUAL.md). Fixtures criptográficas são sintéticas, explicitamente NÃO ICP, e permanecem fora dos pacotes de distribuição.

Executar na raiz do repositório:

```powershell
uv run --frozen --project apps/contract-signature-validator python -m unittest discover -s apps/contract-signature-validator/tests -p 'test_*.py'
```
