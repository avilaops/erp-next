# Contract signature validator core

Em desenvolvimento. Núcleo isolado de validação, sem função de assinatura, rede, banco ou acesso ao portal. Não habilita o fluxo produtivo nem declara homologação ICP-Brasil individual.

Especificação: [assinatura individual](../../docs/telas/servicos/contratos/referencias/ASSINATURA-ICP-INDIVIDUAL.md). Fixtures criptográficas são sintéticas, explicitamente NÃO ICP, e permanecem fora dos pacotes de distribuição.

O núcleo já contém identidade estrutural, cadeia/revogação offline e verificação incremental do PDF. O perfil inicial admite somente um novo campo de assinatura invisível e mantém campos existentes, controles MDP e conteúdo. Timestamp presente fica `unsupported` até haver política e corpus próprios; ausência nunca é apresentada como tempo qualificado ou LTV. O certificado de conta do portal permanece técnico, inclusive quando contém CPF.

Serviço restrito, obtenção online de revogação, isolamento de execução, ERP/portal, pacote/release e homologação pessoal continuam pendentes. Não expor o núcleo diretamente a uploads antes desses gates.

Executar na raiz do repositório:

```powershell
uv run --frozen --project apps/contract-signature-validator python -m unittest discover -s apps/contract-signature-validator/tests -p 'test_*.py'
```
