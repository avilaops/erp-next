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

1. [x] Testes de incompatibilidade primeiro, RED observado na CI existente.
2. [x] Helper Rust de exportação e captura de base/candidato, com hashes.
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
- RED: CI 40645697677, dez testes recusados pela ausência do gate. GREEN desses
  dez: CI 40647464900; validação completa interrompida por timeout de compilação
  fria. Não houve aprovação presumida do módulo.
- Pedido posterior: todos os jobs até 90 segundos, acompanhamento sem watch.
  Política registrada e relida nos 16 projetos do Linear fora da lixeira.
  Workflows usam timeout nativo de um minuto; stages separados preservam testes.
- Revisão independente apontou documento parseável inválido e resposta PUT
  conferida contra GET. Regressões enviadas no commit fdbd7a0 antes das correções.
- A CI inicial também demonstrou falha móvel anterior: arquivo selecionado no
  HTML antes da hidratação deixou o botão desabilitado até timeout. Entrada agora
  permanece desabilitada até hidratar; teste espera habilitação antes de selecionar.
- RED da revisão: CI 40648263277, 12/14 aprovados, exatamente duas regressões
  falharam. Correções: validação completa por Swagger Parser 13.1.0 sem resolvers
  externos e validador separado da resposta PUT. Hidratação usa snapshot SSR/cliente
  de useSyncExternalStore, preservando a regra react-hooks/set-state-in-effect.
