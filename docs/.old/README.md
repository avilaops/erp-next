# API do ERP Next

Esta pasta é a fonte de verdade dos contratos HTTP do ERP Next. A documentação
separa o que está disponível no código do que ainda é projeto. Essa distinção é
obrigatória: uma rota só entra no OpenAPI executável depois de existir no router,
ter validação definida e possuir testes de contrato.

## Estado atual

| Artefato | Finalidade | Estado |
| --- | --- | --- |
| [`openapi.json`](./openapi.json) | Contrato OpenAPI 3.0.3 derivado da API Axum | Implementado |
| [`conventions.md`](./conventions.md) | Regras transversais para novos endpoints | Decisão arquitetural |
| [`domains.md`](./domains.md) | Catálogo e ordem dos contratos por domínio | Planejado |

O contrato implementado contém:

- `GET /health/live`;
- `GET /health/ready`;
- `GET /api/v1/me`;
- `GET /api/v1/users`;
- `GET /api/v1/permissions`;
- `GET /api/v1/roles`.

Os dois endpoints de Plataforma validam o access token no `userinfo` do Auth
Ávila Ops, exigem `X-Tenant-Id`, confirmam a associação ativa e aplicam RLS na
transação. A listagem de usuários exige `platform.users.read`; papéis e
permissões exigem `platform.roles.read`.

O restante do produto ainda não possui handlers no backend. Os módulos do
frontend continuam usando dados simulados e não são evidência de disponibilidade
da API.

## Como evoluir o contrato

Para cada novo fluxo:

1. definir o recurso, os comandos e as permissões em `domains.md`;
2. implementar o handler, a validação e a persistência no domínio proprietário;
3. adicionar a operação ao `openapi.json` com `operationId` único;
4. adicionar exemplos de sucesso e de erro sem dados pessoais reais;
5. testar autenticação, autorização, isolamento por empresa e idempotência;
6. validar que o contrato representa exatamente o comportamento implementado.

Endpoints empresariais serão versionados sob `/api/v1`. Os endpoints de saúde
permanecem fora desse prefixo porque pertencem à operação da aplicação, não ao
contrato de negócio.

## Fonte de verdade e compatibilidade

- O código é a fonte de verdade do comportamento em execução.
- O OpenAPI é a fonte de verdade pública do contrato implementado.
- Alterações incompatíveis exigem uma nova versão de API.
- Campos podem ser adicionados de forma compatível; consumidores não devem
  rejeitar propriedades desconhecidas.
- Rotas planejadas não devem aparecer como disponíveis no OpenAPI.

## Validação mínima

Sem adicionar dependências ao projeto, a sintaxe JSON pode ser validada no
PowerShell com:

```powershell
Get-Content -Raw docs/api/openapi.json | ConvertFrom-Json | Out-Null
```

Antes de publicar uma API, a validação deve também conferir referências,
parâmetros de caminho, `operationId`, respostas e o alinhamento com os testes do
router.
