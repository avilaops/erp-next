# Integração de notas recebidas com o Lojas

## Entrega

O ERP Next recebe um XML `nfeProc` 4.00 já autorizado, preserva o conteúdo
original por empresa e fornece ao Lojas a listagem e os downloads de XML e
DANFE. O ERP legado não participa do fluxo.

Esta entrega não busca documentos na SEFAZ. Distribuição por NSU, manifestação
do destinatário, cancelamentos posteriores, compras, contas a pagar e efeitos de
estoque continuam fora do escopo.

## Permissões e credencial

O papel do operador que provisiona a integração precisa de
`platform.integrations.manage`. O operador que importa XML precisa de
`fiscal.received_nfe.manage`.

Com sessão OIDC válida e `X-Tenant-Id` da empresa:

```http
POST /api/v1/integrations/service-keys
Content-Type: application/json

{"name":"Lojas monitor de notas"}
```

A resposta `201` contém `key` uma única vez. O banco armazena somente SHA-256 e
um prefixo não secreto. A chave é vinculada à empresa codificada nela e não
aceita `X-Tenant-Id` fornecido pelo consumidor.

As credenciais podem ser consultadas sem o segredo em
`GET /api/v1/integrations/service-keys` e revogadas em
`DELETE /api/v1/integrations/service-keys/{id}`. Revogação é imediata para novas
requisições e é revalidada antes de devolver um DANFE que demorou para ser
gerado.

Para rotacionar, crie outra chave, altere o segredo no Lojas, confirme o acesso
e revogue a anterior. Nunca registre a chave em Git, logs, tickets ou variáveis
expostas ao navegador.

## Importação

```http
POST /api/v1/fiscal/received-nfes/import
Authorization: Bearer <sessão OIDC>
X-Tenant-Id: <uuid da empresa>
Content-Type: application/json

{"xml":"<?xml version=\"1.0\" ...>"}
```

O destinatário do XML deve ser o CNPJ/CPF da empresa ativa. O emitente, a chave,
o protocolo e o digest declarado são conferidos pelo mesmo inspetor conservador
usado no DANFE. A rotina não afirma validação criptográfica ICP-Brasil, XSD,
consulta online ou situação atual na SEFAZ.

A primeira importação retorna `201`. Repetir exatamente o mesmo XML retorna
`200` e `Idempotency-Replayed: true`. Reutilizar a chave de acesso com conteúdo
diferente retorna `409`. O XML, seu SHA-256 e os metadados extraídos ficam em
tabela append-only com RLS forçada.

## Monitor próprio do ERP

O monitor em `/fiscal/monitor` e `/compras/notas-entrada` usa a sessão do ERP,
sem exigir uma conexão com o Lojas. A permissão atual é
`fiscal.received_nfe.manage` para importar, consultar e baixar documentos.

- `GET /api/v1/fiscal/received-nfes`: busca por fornecedor, documento, número
  ou chave; período de emissão em UTC; paginação com `offset` e `limit` (1–100).
- `GET /api/v1/fiscal/received-nfes/{id}/xml`: arquivo original e SHA-256.
- `GET /api/v1/fiscal/received-nfes/{id}/danfe`: geração pelo serviço configurado,
  com revalidação de acesso antes da entrega e hashes do XML e PDF.

As rotas exigem identidade OIDC e `X-Tenant-Id`, aplicam RLS e não recebem
chaves de integração do Lojas. O BFF usa exclusivamente a empresa da sessão.
O download e a importação também conferem a empresa exibida na tela.

`/preferencias/fiscal` lê e salva o perfil existente com revisão `If-Match`.
O certificado continua não verificado: cadastrar sua referência não recebe
um arquivo A1, não consulta a SEFAZ e não habilita emissão.

## Contrato de serviço consumido pelo Lojas

Todas as rotas abaixo recebem `Authorization: Bearer <chave de serviço>`:

| Método e rota | Resultado |
| --- | --- |
| `GET /api/v1/notas-recebidas` | `{notas, pendencias}` da empresa vinculada |
| `GET /api/v1/notas-recebidas/{id}/xml` | XML original com `application/xml` |
| `GET /api/v1/notas-recebidas/{id}/danfe` | PDF gerado pelo serviço fiscal |

Cada nota lista `id` numérico, `chave`, `numero`, `serie`, `emitida_em`, `valor`,
`itens`, `compra_id: null` e `fornecedor` ainda não vinculado. `pendencias`
permanece vazio até existir uma fonte operacional verificável.

Os downloads usam `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`,
nome de arquivo limitado à chave validada e hashes de integridade. Um identificador
de outra empresa responde `404` porque a consulta ocorre sob RLS.

## Configuração no Lojas

No backend do Lojas:

```dotenv
ERP_API_URL=https://erp-api.exemplo
ERP_APP_URL=https://erp.exemplo
ERP_API_KEYS_BY_CNPJ={"19131243000197":"erp_<tenant-uuid>_<segredo>"}
```

O CNPJ deve conter somente dígitos e corresponder à empresa destinatária no ERP.
`ERP_API_KEYS_BY_CNPJ` é segredo de backend; não use prefixo `NEXT_PUBLIC_`.

## Respostas relevantes

| HTTP | Situação |
| --- | --- |
| 200/201 | Consulta, replay idempotente ou criação concluída |
| 401 | Chave de serviço ausente, inválida ou revogada |
| 403 | Permissão ausente ou XML destinado a outra empresa |
| 404 | Nota ou credencial não encontrada no tenant |
| 409 | Chave de acesso já armazenada com outro XML |
| 413 | Corpo acima do limite configurado |
| 422 | XML, envelope, protocolo ou metadados recusados |
| 502 | Resposta inválida do serviço fiscal |
| 503 | Gerador de DANFE não configurado |

Implantação, migração do banco e provisionamento de segredos seguem o pipeline do
ERP Next. Este documento não autoriza deploy nem alteração em produção.
