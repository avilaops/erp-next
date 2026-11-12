# Clientes e fornecedores

## Primeiro fluxo conectado

O cadastro é único por empresa e documento. Uma pessoa pode ser cliente,
fornecedor ou ambos. A remoção de um papel não cria outro cadastro. O registro
pode ser arquivado e reativado; não há exclusão destrutiva nesta API.

As telas de listagem, criação, consulta e edição em
`/cadastros/clientes-fornecedores` usam a API Rust pelo BFF do Next.js.
As contagens simuladas de produtos e pessoas foram retiradas da central de
cadastros. Os demais cadastros ainda demonstrativos são identificados como tal.

## Dados e invariantes

- `personType`: `fisica` ou `juridica`.
- `legalName`: nome ou razão social, de 1 a 200 caracteres após remover espaços
  nas extremidades. Não aceita caracteres de controle.
- `tradeName`: opcional, até 200 caracteres.
- `taxId`: CPF ou CNPJ obrigatório neste primeiro recorte brasileiro. É
  normalizado para ASCII alfanumérico em maiúsculas, com verificação de tipo e
  dígitos pelo validador já utilizado no cadastro de empresa.
- `email`: opcional, até 254 caracteres; verificação básica de formato ASCII.
- `phone`: contato declarado opcional, até 40 caracteres. Não é verificado
  contra uma operadora nem usado como prova de identidade.
- `isCustomer` e `isSupplier`: pelo menos um precisa ser verdadeiro.
- `status`: `active` ou `archived`.
- Documento único dentro da empresa, inclusive em cadastros arquivados. A mesma
  pessoa pode ser cadastrada por empresas diferentes sem compartilhar dados.
- `tenantId`, identificador e revisão são determinados pelo servidor. Campos
  desconhecidos no JSON são recusados.
- Documento e tipo não podem ser trocados depois que houver pedido vinculado.
  Nomes e contatos podem mudar; snapshots comerciais preservam os dados anteriores.

Não há consulta à Receita, validação de inscrição estadual, endereço, regime,
contribuinte, crédito, condições comerciais ou enquadramento tributário nesta
entrega. CPF/CNPJ aceito não significa cadastro apto a faturar. Clientes sem
documento e pessoas estrangeiras também ficam fora deste primeiro contrato.

## API

| Operação | Condições |
| --- | --- |
| `GET /api/v1/parties` | Busca por nome, nome fantasia ou documento sem máscara; filtros `role=customer/supplier`, `status`; paginação `offset/limit` |
| `POST /api/v1/parties` | `Idempotency-Key` UUID obrigatório; retorna HTTP 201 e ETag |
| `GET /api/v1/parties/{id}` | Cadastro e ETag da revisão atual; HTTP 404 para registro fora da empresa |
| `PUT /api/v1/parties/{id}` | `If-Match` obrigatório; HTTP 412 quando a revisão já mudou |

O OpenAPI é gerado pelo Utoipa. Consulta exige `catalog.parties.read`; gravação
exige também `catalog.parties.manage`. A migração registra as permissões, sem
atribuí-las automaticamente a papéis existentes. O provisionamento do ambiente
deve concedê-las ao administrador autorizado.

O PostgreSQL aplica RLS forçada. O executor serializa as escritas por empresa e
revalida os direitos depois de obter o bloqueio. Cadastro, auditoria, outbox e
comando de criação são gravados na mesma transação. A auditoria registra revisão
e papéis comerciais; não replica documento e contatos no evento.

## Concorrência e confirmação

O formulário conserva a edição recusada e exige descarte explícito antes de
recarregar o cadastro atual. Uma criação com resposta perdida conserva o corpo
e a chave em memória para repetir a confirmação sem criar outra pessoa.

A chave e o rascunho ainda não são recuperados depois de fechar a aba. O aviso
de alterações pendentes ao recarregar não substitui uma política de recuperação.
As validações de origem, sessão e empresa continuam no BFF; permissões e
invariantes são novamente verificadas na API.

## Verificação local

Os testes Rust usam PostgreSQL real e papel sem superusuário nem `BYPASSRLS`.
Cobrem duplicidade por empresa, papéis, criação idempotente simultânea, edição
concorrente, paginação, filtros, isolamento, negação de escrita e rollback de
cadastro/auditoria/comando quando a outbox falha.

Os testes de navegador usam Auth sintético explícito. O harness também compara
os cadastros, dados e ETags antes e depois de reiniciar a API. Isso não valida
autenticação, provisionamento ou implantação de produção.
