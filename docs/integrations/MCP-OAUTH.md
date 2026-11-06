# MCP remoto do ERP

Entrada: `https://erp.avilaops.com/mcp`, transporte Streamable HTTP e JSON-RPC
2.0. Não é um plugin nem um túnel SQL. Cada ferramenta despacha uma operação
empresarial real ao mesmo roteador que atende à API Rust.

## Conectar

No cliente MCP, informe a URL acima e selecione OAuth. A descoberta pública
anuncia registro dinâmico de clientes, Authorization Code com PKCE S256,
renovação e revogação. O navegador abre o login existente do ERP/Auth Ávila e
mostra o nome do cliente, o endereço de retorno e as capacidades solicitadas.
O usuário precisa autorizar a conexão; uma sessão existente não autoriza
automaticamente um novo cliente.

Os scopes `erp.read` e `erp.write` limitam a conexão, mas não concedem papéis no
ERP. Uma identidade que só pode consultar continua sem poder alterar. A empresa
é explícita em `tenant_id` nas ferramentas que operam por empresa. Os vínculos,+papéis e o estado da empresa são conferidos a cada operação pela API original.

O servidor OAuth pertence ao ERP. Ele utiliza a sessão de identidade existente
para o consentimento e emite tokens MCP próprios, vinculados ao recurso exato
`https://erp.avilaops.com/mcp`. Tokens do Auth, cookies do navegador e credenciais
de serviço não são entregues ao cliente MCP nem aceitos como token do MCP.

Descoberta:

- `/.well-known/oauth-protected-resource/mcp` e
  `/.well-known/oauth-protected-resource`.
- `/.well-known/oauth-authorization-server`.

Entradas OAuth:

- `/mcp/oauth/register`: registro de cliente, sem credencial humana.
- `/mcp/oauth/authorize`: login e consentimento no navegador.
- `/mcp/oauth/token`: troca de código e rotação de refresh token.
- `/mcp/oauth/revoke`: revogação da concessão.

Códigos expiram em dois minutos e são de uso único. Access tokens expiram em
quinze minutos. Refresh tokens são rotacionados e a concessão tem validade
máxima de trinta dias. Reutilização de um refresh token consumido revoga toda a
concessão, inclusive access tokens emitidos anteriormente. O PostgreSQL armazena
somente hashes de códigos, tokens e segredos de clientes.

## Ferramentas e cobertura

O catálogo deriva do OpenAPI da mesma imagem da API. Inclui todas as operações
empresariais autenticadas implementadas: empresas, acessos, papéis, convites,
produtos, categorias, clientes, fornecedores, equipe, configurações, preços,
simulações, propostas, pedidos, compras, recebimentos, estoque, produção,
financeiro, comissões, contratos, documentos, fiscal e integrações.

Telas demonstrativas sem operação persistente não viram ferramenta fictícia.
Webhooks externos, saúde, credenciais de serviço e o motor fiscal interno não
são expostos como acesso administrativo alternativo. A criação e revogação de
chaves pela API empresarial continuam sujeitas à autorização original.

`tools/list` é paginado; percorra `nextCursor` até ele deixar de existir. Cada
ferramenta traz nome estável, descrição, JSON Schema, anotações de efeitos e os
metadados `erp/path` e `erp/method`. O CI exporta o catálogo e exige cobertura de
todas as operações protegidas do contrato.

Argumentos, conforme a operação:

- `tenant_id`: UUID explícito da empresa.
- `path`: parâmetros de caminho definidos pelo contrato.
- `query`: filtros e paginação definidos pelo contrato.
- `headers`: precondições como `If-Match` e `Idempotency-Key`.
- `body`: corpo tipado definido pelo contrato.

Não há ferramenta de SQL, URL arbitrária ou encaminhamento de cabeçalhos de
autenticação. Parâmetros de caminho são codificados e os destinos estão
limitados ao roteador empresarial em memória.

## Escritas, revisões e arquivos

Use a revisão devolvida pelo ERP em `If-Match`. Preserve a mesma chave de
idempotência em tentativas da mesma intenção. O MCP não gera novas chaves nem
repete comandos automaticamente. Uma operação fiscal pendente não significa
autorização da SEFAZ; mantenha as regras de acompanhamento já documentadas em
[integração fiscal](FISCAL-N8N-MCP.md).

Resultados preservam status HTTP, cabeçalhos relevantes e dados. XML/texto são
retornados como texto; arquivos binários incluem conteúdo em base64 e tipo MIME.
Falhas da API são resultados MCP com `isError: true`, sem transformar um erro em
sucesso nem acessar diretamente as tabelas para contorná-lo.

## Operação

`ERP_MCP_ORIGIN` fixa a origem pública; o padrão é `https://erp.avilaops.com`.
Somente HTTPS é aceito fora de loopback. O Host enviado pelo cliente não define
issuer, recurso ou endereço de retorno. `ERP_MCP_ALLOWED_ORIGINS` é uma lista
separada por vírgulas para clientes de navegador adicionais. Requisições sem
Origin continuam exigindo Bearer; Origin presente precisa estar autorizado.

A web encaminha apenas os caminhos MCP conhecidos à API de loopback. O caminho
de consentimento permanece na web, protegido por sessão, Origin e CSRF. Não há
processo ou container adicional.

Migration e grants de armazenamento OAuth são aplicados exclusivamente pelo
workflow existente no GitHub CI. A publicação recebe somente imagens prontas.
Não executar scripts de aplicação, migrations, testes ou builds em applications.
