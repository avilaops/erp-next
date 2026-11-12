# Acessos da empresa

O Auth confirma a identidade pelo `sub`. O ERP mantém a associação à empresa,
os papéis e as permissões. As operações abaixo exigem Bearer válido e
`X-Tenant-Id`; o contrato gerado em `/openapi.json` acompanha os handlers Rust.

## Recursos implementados

| Método e recurso | Permissões locais | Concorrência |
| --- | --- | --- |
| `GET /api/v1/me` | Associação ativa | Direitos atuais, sem cache no BFF |
| `GET /api/v1/users` | `platform.users.read` | Lista da empresa |
| `GET /api/v1/users/{id}` | `platform.users.read` | Retorna ETag e `revision` |
| `PUT /api/v1/users/{id}` | `platform.users.read/manage`, `platform.roles.read` | Exige `If-Match` |
| `GET /api/v1/roles` | `platform.roles.read` | Lista da empresa |
| `GET /api/v1/roles/{id}` | `platform.roles.read` | Retorna ETag e `revision` |
| `POST /api/v1/roles` | `platform.roles.read/manage` | Exige `Idempotency-Key` UUID |
| `PUT /api/v1/roles/{id}` | `platform.roles.read/manage` | Exige `If-Match` |
| `DELETE /api/v1/roles/{id}` | `platform.roles.read/manage` | Exige `If-Match`; recusa papel atribuído |
| `GET /api/v1/permissions` | `platform.roles.read` | Catálogo registrado no ERP |

`read/manage` na tabela representa as duas permissões, não um código literal.
Uma permissão `*.manage` em um papel exige a correspondente `*.read`.
Não é permitido editar papéis nem atribuições que contenham direitos que o
operador não possui, nem conceder direitos fora da sua autoridade.

## Corpos e revisões

Criação e atualização de papel recebem somente:

```json
{
  "code": "consulta-comercial",
  "name": "Consulta comercial",
  "description": "Consulta ao cadastro da empresa",
  "permissions": ["platform.company.read"]
}
```

Alteração de associação recebe somente:

```json
{
  "status": "active",
  "roleIds": ["UUID_DE_UM_PAPEL_DESTA_EMPRESA"]
}
```

O identificador da URL de usuário é o da associação à empresa. Nome e e-mail
permanecem no cadastro central de identidade e não são alterados por esse PUT.
Estados apresentados são `active`, `blocked` e `pending`. A confirmação de
convite não é implementada: uma associação pendente pode ter seus papéis
editados, mas não pode mudar de estado por esta API. Isso impede contornar a
confirmação por uma sequência de bloqueio e reativação.

`If-Match` usa o ETag recebido, por exemplo `"2"`. Ausência retorna 428;
revisão desatualizada retorna 412. Os formulários preservam o rascunho e exigem
confirmação antes de recarregar e descartar a edição. Campos desconhecidos e
dados inválidos são recusados.

O POST de papel grava a chave, o corpo normalizado e o resultado na mesma
transação. O escopo da chave é empresa e `sub`. Reenviar a mesma intenção retorna
201 com o resultado original e `Idempotency-Replayed: true`; mudar o corpo com
a mesma chave retorna 409. A resposta repetida representa o comando original,
não uma consulta ao estado atual do papel. A autorização é conferida novamente.
Não existe rotina automática de expiração desses registros nesta versão.

## Invariantes e transações

- Uma alteração não pode bloquear o próprio operador.
- A empresa mantém pelo menos uma associação ativa cuja união de permissões
  inclui consulta e gestão de usuários e papéis.
- UUID de outra empresa é tratado como recurso não encontrado.
- Alterações de acesso serializam na linha da empresa e só então carregam os
  direitos do operador. A escrita do cadastro de empresa segue a mesma ordem.
- Gravação, revisão, auditoria e outbox confirmam ou desfazem juntas.
- Tabelas de acesso e comandos usam RLS com contexto transacional de empresa.
  A conta de aplicação deve ser `NOSUPERUSER NOBYPASSRLS`.

A condição de administrador é uma garantia sobre as associações locais do
ERP. Ela não verifica a disponibilidade futura do Auth ou a recuperação da
conta central. Não há endpoint de exclusão de identidade nem simulação de
envio de convite.

## Navegador e testes

As telas estão em `/preferencias/usuarios` e `/preferencias/papeis`. O BFF em
`/api/erp/*` usa sessão HttpOnly criptografada; não entrega o token ao cliente.
Escritas validam origem e empresa da sessão. Requisições JSON são limitadas a
64 KiB no BFF. Respostas de dados usam `Cache-Control: no-store` no BFF.

`pnpm test:access` executa o harness de empresa e acessos, incluindo as
verificações do catálogo presente no checkout. Ele cria uma base e uma conta
isoladas, usa Auth sintético, inicia API e Next.js de produção, executa o
Playwright e confere persistência após reiniciar a API. `pnpm test:company`
continua como alias do mesmo harness. Consulte a evidência da rodada para
pré-requisitos e resultados observados.
