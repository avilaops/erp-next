# Convenções da API

## Base e versionamento

- Desenvolvimento local: `http://127.0.0.1:8080`.
- Saúde operacional: `/health/*`, sem versão.
- Recursos empresariais: `/api/v1/*`.
- Versões maiores coexistem durante uma migração; não se altera silenciosamente
  a semântica de uma versão publicada.

## Autenticação e contexto da empresa

O Auth Ávila Ops fornecerá identidade por OIDC. A API validará o token e usará o
`sub` como `auth_subject` da identidade local. A escolha definitiva de emissor,
audience, algoritmo e URLs de descoberta depende da integração OIDC e, portanto,
não está declarada no OpenAPI atual.

Regras obrigatórias para endpoints empresariais:

1. autenticar a identidade;
2. resolver a associação ativa à empresa;
3. estabelecer `app.tenant_id` na mesma transação usada pela operação;
4. verificar a permissão do comando;
5. auditar ações relevantes.

O cliente não pode elevar acesso enviando um `tenant_id` arbitrário. O contexto
de empresa deve ser derivado de uma associação válida e confirmado pela API.

## Autorização

Permissões pertencem ao ERP e usam códigos estáveis no formato
`<dominio>.<recurso>.<acao>`, por exemplo `platform.users.read`. Papéis agrupam
permissões; uma permissão subordinada nunca pode conceder mais acesso que a
permissão principal da qual depende.

Respostas esperadas:

- `401 Unauthorized`: credencial ausente, inválida ou expirada;
- `403 Forbidden`: identidade válida sem empresa ativa ou sem permissão;
- `404 Not Found`: recurso inexistente no tenant atual, sem revelar existência
  em outro tenant.

## Formato de erros

Erros HTTP empresariais deverão usar `application/problem+json` e o formato:

```json
{
  "type": "https://erp.avilaops.com/problems/validation-error",
  "title": "Dados inválidos",
  "status": 422,
  "detail": "Um ou mais campos precisam ser corrigidos.",
  "instance": "/api/v1/users",
  "requestId": "0192f45d-02ec-7b74-b0c6-3e37edb80fb1",
  "errors": [
    {
      "field": "email",
      "code": "invalid_email",
      "message": "Informe um e-mail válido."
    }
  ]
}
```

`detail` deve ser seguro para o consumidor. Exceções internas, SQL, tokens,
segredos e dados de outro tenant não podem aparecer na resposta.

## Identificação e rastreabilidade

- A API aceita um `X-Request-Id` válido ou gera um UUID para a requisição.
- A resposta propaga `X-Request-Id`.
- Auditoria e logs usam o mesmo identificador.
- Segredos, tokens, documentos completos e payloads fiscais não são registrados
  em logs de aplicação.

## Idempotência

Comandos que criam efeitos repetíveis ou acionam integrações exigirão
`Idempotency-Key`:

- a chave é isolada por tenant, identidade e operação;
- repetir a mesma chave com o mesmo payload devolve o resultado persistido;
- repetir a chave com payload diferente devolve `409 Conflict`;
- validação e persistência do resultado ocorrem atomicamente com a operação;
- timeouts de integrações entram em reconciliação, não em repetição cega.

O prazo de retenção das chaves ainda será definido antes do primeiro comando
idempotente entrar em produção.

## Listas, filtros e ordenação

O padrão previsto para coleções empresariais é paginação por cursor:

| Parâmetro | Tipo | Regra |
| --- | --- | --- |
| `limit` | inteiro | padrão `25`, mínimo `1`, máximo `100` |
| `cursor` | string opaca | posição devolvida pela página anterior |
| `search` | string | busca textual normalizada pelo recurso |
| `sort` | string | campo permitido, prefixado por `-` para ordem decrescente |
| `filter[...]` | string ou lista | somente filtros declarados pelo endpoint |

Resposta planejada:

```json
{
  "data": [],
  "page": {
    "limit": 25,
    "nextCursor": null,
    "hasMore": false
  }
}
```

Cursores são opacos. O consumidor não deve interpretar nem fabricar seu valor.

## Concorrência e mutações

- Recursos editáveis devem expor uma versão ou `ETag` quando houver risco de
  sobrescrita concorrente.
- Atualizações condicionais usam `If-Match`; conflito devolve
  `412 Precondition Failed`.
- Movimentos financeiros, fiscais e de estoque são cancelados ou estornados;
  não são apagados.
- `DELETE` é reservado a recursos realmente removíveis e sem exigência de
  trilha histórica.

## Eventos

Eventos externos são gravados na outbox na mesma transação do domínio. Nomes
usam passado e versão explícita, por exemplo `sales.order.created.v1`.

Envelope planejado:

```json
{
  "id": "0192f45d-02ec-7b74-b0c6-3e37edb80fb1",
  "type": "sales.order.created.v1",
  "tenantId": "0192f45b-7d8d-7b7c-bfd5-dd0dbeab2d98",
  "aggregate": {
    "type": "sales.order",
    "id": "0192f45c-329e-7ca0-a8e3-bf731f38e3b5"
  },
  "occurredAt": "2026-10-25T12:00:00Z",
  "data": {}
}
```

Consumidores devem ser idempotentes e tolerar entrega repetida. O n8n consome
eventos e orquestra integrações; ele não contém o estado canônico nem substitui
regras transacionais do ERP.
