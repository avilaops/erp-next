# MCP remoto completo do ERP com OAuth

Objetivo: servidor MCP Streamable HTTP nativo em `https://erp.avilaops.com/mcp`,
com uma ferramenta tipada para cada operação empresarial implementada no contrato
OpenAPI, sem SQL arbitrário, credencial de serviço compartilhada ou plugin.

## Decisões

- O ERP emite credenciais OAuth próprias, vinculadas ao recurso `/mcp` e à
  identidade que entra pelo Auth Ávila existente. O token do Auth nunca chega ao
  cliente MCP. Consentimento explícito pelo navegador, PKCE S256 obrigatório,
  códigos de uso único, refresh com rotação e revogação de concessões.
- Cadastro dinâmico de clientes públicos; redirects HTTPS exatos ou HTTP em
  loopback. Nenhuma URL fornecida pelo cliente será buscada pelo servidor.
- Tokens e códigos opacos aleatórios; somente hashes no PostgreSQL. Metadados
  RFC 8414/9728 e desafio WWW-Authenticate permitem descoberta automática.
- A API Rust mantém autorização, associação às empresas, RLS, idempotência,
  revisão e auditoria. MCP despacha ao mesmo roteador empresarial em memória.
- Catálogo derivado do OpenAPI da mesma versão, com esquemas JSON, parâmetros,
  corpos, revisões e chaves de idempotência. Não inventar ferramentas para telas
  demonstrativas. Exportar inventário verificável e cobertura no CI.
- Respostas JSON, texto, XML e binários; erros HTTP preservados como erros de
  ferramenta. Sem retry automático de comandos.

## Etapas e verificações

1. Testes HTTP de descoberta, autenticação e Origin falham no GitHub CI antes
   da implementação. Nenhum teste, build ou script de aplicação roda no servidor.
2. Catálogo e despacho MCP em `apps/api/src/mcp/`, integrados ao roteador HTTP.
   Testes de cobertura do contrato, esquemas, parâmetros, isolamento e erros.
3. OAuth em `apps/api/src/mcp/oauth/`: registro, autorização, token, refresh,
   revogação e concessões por identidade. Migration e grants executáveis pela CI.
   Testes de PKCE, replay, redirects, recurso, consentimento e revogação.
4. Consentimento web em `/mcp/oauth/authorize`, reutilizando sessão do ERP,
   protegido por Origin e CSRF. Proxy transparente das demais entradas MCP.
5. CI existente compila, testa e publica evidências. PR em rascunho evita merge
   e publicação automáticos enquanto o trabalho está em andamento.
6. Publicação usa exclusivamente workflows e imagens aprovadas; sem builds,
   migrations ou execução direta de código de aplicação em applications.

## Critérios de conclusão

Handshake e catálogo por cliente MCP, fluxo OAuth completo e negativo testados,
uma ferramenta por operação empresarial implementada, permissões originais
preservadas, CI verde e endpoint remoto publicado e verificado. Login e
consentimento de cada usuário permanecem no navegador do próprio usuário.
