# Estoque conectado e página inicial

## Escopo da rodada

Checkout local: `D:\Projetos\SaaS\erp-next`.

As alterações anteriores de empresa, acessos, catálogo, fiscal e demais frentes
foram preservadas. Esta rodada conectou as telas de saldos e movimentos à API
existente e retirou os indicadores, séries, empresa e eventos fictícios da home.
Nenhuma implantação de produção foi realizada.

## Comportamentos verificados

| Cenário | Resultado observado |
| --- | --- |
| Entrada de 10.000001 | Movimento confirmado e saldo 10.000001 |
| Saída de 11 | Recusada por saldo insuficiente; edição preservada |
| Saída de 2.000001 | Saldo confirmado de 8.000000 |
| Estorno dessa saída | Novo movimento referenciado; saldo de 10.000001 |
| Segundo estorno do mesmo original | Recusado pela API |
| Resposta perdida após confirmação de entrada | Repetição com a mesma chave e somente um movimento persistido |
| Usuário com permissão de consulta | Histórico acessível e escrita recusada com HTTP 403 |
| Estoque em 320 e 375 pixels | Sem rolagem horizontal; controles finais acima da navegação móvel |
| Reinício do processo da API | Saldos e históricos iguais aos dados anteriores ao reinício |
| Página inicial entre 320 e 1440 pixels | Sem rolagem horizontal; cartão de logística dentro da largura disponível |

## Execuções

- `pnpm --filter web lint`: aprovado; lint dos componentes e testes alterados
  também aprovado em execução específica.
- `cargo build -p erp-next-api -j 1`, com
  `CARGO_TARGET_DIR=target/company-verification`: aprovado.
- `pnpm --filter web build`, com `CIRCLE_NODE_TOTAL=3`: aprovado,
  incluindo TypeScript e geração de páginas com dois workers.
- `pnpm test:company`, com
  `COMPANY_TEST_DATABASE_URL=postgres://erp_modules@127.0.0.1:55441/postgres`:
  **17 testes aprovados** na execução final, em 34,3 segundos; comparação de
  persistência após reiniciar a API também aprovada.
- `pnpm --filter web test:e2e --workers=1`: **41 testes aprovados**, em 1,5 minuto.
  Essa execução precedeu o último ajuste de margens e espaço inferior do estoque;
  o ajuste foi revalidado pela suíte integrada final e pela regressão específica.
- Regressão específica de home, estoque e navegação operacional:
  **3 testes aprovados**, em 18 segundos, sobre a compilação final.

Uma tentativa de compilação com concorrência maior falhou durante pressão de
memória; o PowerShell também registrou `OutOfMemoryException`. A compilação e os
testes foram repetidos em sequência, com menos workers. A primeira execução do
teste de estoque também encontrou ambiguidade entre o alerta de erro e o
anunciador de rotas do Next.js; o seletor passou a identificar a mensagem do
domínio. Nenhuma asserção de recusa comercial foi removida.

## Ambiente e limites

O harness usa banco e papel temporários próprios, PostgreSQL real sem superusuário
nem `BYPASSRLS`, API Rust, Next.js compilado e um provedor de identidade sintético.
Ele remove os recursos temporários que criou. Não confirma autenticação de
produção nem concede acesso a empresas reais.

O estoque ainda não implementa depósitos, reservas, lotes, produção ou recebimento
de compras. A chave de uma operação com resposta perdida é mantida na memória da
página; sua recuperação depois de fechar a aba não está implementada.

As imagens usam somente dados dos testes:

- `screenshots/erp-estoque-mobile-persistente.png`.
- `screenshots/erp-home-mobile-sem-dados-ficticios.png`.

O contrato e os comandos estão em `docs/ESTOQUE-PERSISTENTE.md`.
