# Gate OpenAPI do ERP — AVL-343

## Desenho

Exportar `ApiDoc::openapi()` da revisão testada e da base explícita do PR,
sem iniciar HTTP, Auth ou PostgreSQL para descobrir o contrato. Usar oasdiff
1.34.1 com checksum fixado para incompatibilidades estruturais. O contrato
continua sendo uma descrição Utoipa; não prova autorização nem semântica.

A base é um checkout Git separado do SHA fornecido pelo evento do GitHub.
Se ainda não contém exportador, recebe somente o mesmo helper de teste do
candidato e um include cfg(test); fontes de domínio/contrato permanecem intactas.
Registrar essa instrumentação e o hash do helper. Não usar snapshot editável
do candidato como baseline. Não executar testes/builds nos servidores.

## Entrega

1. [ ] Testes de incompatibilidade primeiro, RED observado na CI existente.
2. [ ] Helper Rust de exportação e captura de base/candidato, com hashes.
3. [ ] Gate oasdiff: remoção de operação/resposta, entrada mais restritiva,
   mudança de autorização e erros de ferramenta não podem ser aprovação.
4. [ ] Consumidor TypeScript fixado, exemplos da operação company e mutações
   que provem rejeição; indicar políticas e testes reais relacionados.
5. [ ] CI existente preserva OpenAPI base/candidato, relatório, fontes e duração.
6. [ ] Revisão independente, CI completa aprovada e registro no Linear/PR.

## Verificação

Somente GitHub CI: `cargo test --workspace`, testes Node do gate e consumidor
compilado contra tipos gerados do OpenAPI real. Base igual é compatível;
remoção de endpoint, campo obrigatório novo, enum restrito, resposta removida
e autenticação mais forte são incompatíveis. Documento inválido ou falha do
comparador deve interromper. Nenhum upload a serviço de revisão externo.

## Ledger

- Base inicial: origin/main 1569e8f. Checkout de desenvolvimento isolado;
  os módulos staff, onboarding, fiscal e Langfuse de outros chats não são alterados.
- get_agent_context indisponível (Tool not found); fontes consultadas no Linear
  e nos repositórios. Método: execução nativa com revisão ao final.
