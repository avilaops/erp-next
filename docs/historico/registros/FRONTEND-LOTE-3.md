# Frontend: estados e consistência — lote 3

Esta revisão complementa o retorno de autenticação do PR #25, sobre os lotes 1 e 2. Não representa publicação em produção.

## Comportamento

- FE-10: dashboards desconhecidos retornam a página não encontrada em português. As fronteiras de erro oferecem nova tentativa e retorno ao início. A tentativa usa a API `retry` do Next instalado e conserva a URL. Tratamentos de domínio existentes permanecem específicos.
- FE-11: as 177 páginas deste checkout têm metadados específicos; dashboards recebem título pelo tipo validado. O template global acrescenta ERP Next e Ávila Ops, sem dados empresariais.
- FE-12: preços, quantidades, custos, pagamentos e recebimentos aceitam vírgula ou ponto. A normalização usa texto e inteiros, mantém duas ou seis casas e rejeita agrupamento, expoentes e excesso de precisão. Contratos, revisões e idempotência são preservados.
- FE-13: 91 padrões de páginas demonstrativas exibem aviso de dados de exemplo e têm controles de operação desabilitados. Os links continuam disponíveis. A classificação acompanha a navegação client; não bloqueia cadastros integrados, estoque ou chaves da loja.
- Importadores gerais e de pedidos não aceitam arquivos nem apresentam contagens fictícias. Exportação não simula fila ou histórico de arquivos.
- Preferências do sistema mantêm tema local persistido; as demais configurações ficam indisponíveis, sem confirmação fictícia de salvamento. A página inicial já distingue indicadores indisponíveis e atalhos locais.

## Inventário e limites

`FRONTEND-ROUTE-STATES.csv` contém as 177 páginas e sua classificação de interface: `preview`, `unavailable`, `navigation-or-local`, `api-or-auth` ou `reconcile-main`. A presença de API não atesta todas as transações em produção. O inventário identifica telas e dependências; não substitui provas transacionais.

As três rotas `/fiscal`, `/fiscal/notas-saida` e `/fiscal/notas-saida/[id]` exigem conciliação com a implementação fiscal já presente na main consultada (`477477e`). Não foram classificadas como prévias para evitar bloquear o fluxo persistido na integração. A nova rota de criação de NF-e da main também precisa de metadados e regressão quando os lotes forem integrados. Não publicar esta pilha sem essa conciliação.

Esta revisão não implementa as integrações ausentes, não valida autorização fiscal externa e não altera dados reais. Leitor de tela, teclado virtual e safe area em dispositivo físico continuam pendentes.

## Verificação

Seis cenários reproduziram defeitos antes das alterações. A suíte inclui 404 inválido/genérico, títulos, importação indisponível, prévias sem operação, transição para cadastro integrado, recuperação de falha com consulta preservada, decimais e repetição idempotente do estoque. Compras também exercita entrada com vírgula até o corpo canônico recebido pelo servidor de teste.

No Edge, a execução direcionada de estados/modelos/compras passou 17 testes; a execução anterior de estados/modelos/compras/navegação passou 33. Dez cenários de estados passaram em WebKit emulado. A captura de prévia em 390 px foi inspecionada, e o estoque foi medido em 320 px sem overflow horizontal. Fixtures e autenticação são sintéticas; a sessão do usuário não é usada.

As novas specs integram `playwright.danfe.config.ts`. Build e suíte completa são verificados no CI do commit; consultar o PR para a evidência final.
