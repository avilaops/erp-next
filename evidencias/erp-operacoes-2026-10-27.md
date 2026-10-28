# Entrega local de pessoas, pedidos, estoque e recebíveis

## Escopo verificado

Checkout: `D:\Projetos\SaaS\erp-next`, em 27/10/2026.

Foi exercitado o ciclo de cadastro de cliente e produto, entrada de estoque,
criação de pedido, reserva, cancelamento ou conclusão, geração de conta a receber,
recebimento integral declarado e estorno por novo lançamento.

O recorte validado preservava rascunhos sem edição. Durante o encerramento desta
rodada, outra execução acrescentou edição de rascunhos ao mesmo checkout. Os
resultados abaixo não validam essa extensão nem o estado posterior completo dos
arquivos. Não houve reversão das alterações concorrentes.

## Resultados observados

| Verificação | Resultado |
| --- | --- |
| Testes Rust, incluindo HTTP e PostgreSQL | 43 aprovados, sem falhas ou ignorados |
| Navegador com API, BFF, PostgreSQL e Auth sintético | 26 aprovados |
| Suíte geral de frontend no build isolado | 48 aprovados |
| Comparação de dados antes e depois de reiniciar a API | Aprovada |
| Rustfmt e Clippy com avisos tratados como erro | Aprovados no recorte testado |
| ESLint completo do aplicativo web | Aprovado antes da extensão concorrente |
| Compilação web e verificação TypeScript | Aprovadas no build isolado |
| Compilação do binário da API após separar as escritas por domínio | Aprovada |

Os 26 testes integrados foram repetidos depois da separação das escritas por
domínio. Estoque e financeiro executam suas próprias gravações dentro da
transação autorizada coordenada por vendas. A falha de uma etapa desfaz os
efeitos comerciais, de estoque, financeiros, de auditoria e de outbox.

## Comportamentos exercitados

- Clientes e fornecedores compartilham identidade por empresa, com validação
  local de documento, papéis comerciais, revisão e restrição de alteração de
  identidade após vínculo com pedido.
- Preços são obtidos no servidor e preservados no pedido. Quantidades usam seis
  casas decimais em strings; valores usam centavos e intermediários inteiros.
- O arredondamento é por linha, de meio centavo para cima. Foram verificadas
  fronteiras e mudanças de preço posteriores à criação do pedido.
- Duas confirmações não reservam além do saldo. Cancelamento libera a reserva;
  saída manual respeita as reservas existentes.
- Conclusão gera saída e título financeiro na mesma transação. Estorno avulso
  de movimento originado de pedido é recusado.
- Recebimento integral exige valor exato. Estorno referencia o recebimento ativo,
  preserva o lançamento anterior e reabre a conta.
- Respostas perdidas são repetidas com o mesmo comando, sem duplicar pessoa,
  reserva, movimento de estoque ou recebimento.
- Revisão desatualizada recebe HTTP 412. A edição financeira é preservada até o
  descarte confirmado. Usuário de consulta não pode gravar.
- RLS foi exercitada com registros reais de outra empresa e conta PostgreSQL
  sem superusuário nem `BYPASSRLS`.
- Falhas deliberadas na outbox não deixam efeitos parciais.
- Layouts foram exercitados em larguras de 320, 375 e 440 pixels nos cenários
  correspondentes. As capturas apresentam dados sintéticos de teste.

O reinício da API preservou empresa, papéis, associações, revisões, pessoas,
saldos, reservas, pedidos, recebíveis e históricos de movimentos e recebimentos.

## Reprodução

O PostgreSQL isolado precisa estar disponível em loopback. O harness cria e
remove apenas seu banco e papel temporários. Não aponta para banco de produção.

```powershell
$env:CARGO_TARGET_DIR = 'target/company-verification'
$env:DATABASE_URL = 'postgres://erp_modules@127.0.0.1:55441/postgres'
cargo test -p erp-next-api -j 1 -- --test-threads=1
cargo fmt --all --check
cargo clippy --workspace --all-targets -j 1 -- -D warnings
cargo build -p erp-next-api -j 1
pnpm --filter web lint
$env:ERP_NEXT_DIST_DIR = '.next-operations-verification'
$env:CIRCLE_NODE_TOTAL = '3'
pnpm --filter web build
$env:COMPANY_TEST_DATABASE_URL = 'postgres://erp_modules@127.0.0.1:55441/postgres'
pnpm test:company
pnpm --filter web test:e2e --workers=1
```

Execute as suítes em série, sem outra execução alterando o checkout. O diretório
de build isolado evita disputa com `.next`. O harness recusa iniciar sem o
`BUILD_ID` do diretório escolhido. Os comandos devem ser repetidos para validar
a extensão de edição de rascunhos; a quantidade de testes poderá mudar.

## Desvios encontrados durante a verificação

Uma compilação concorrente alterou `.next`; a verificação foi transferida para
`.next-operations-verification`. Seletores ambíguos foram delimitados ao conteúdo
ou ao SKU do produto. Um teste geral que reunia vários módulos excedeu seu
timeout; seus fluxos foram separados em testes independentes, preservando as
asserções, e a suíte completa de 48 testes passou.

A seleção de arquivos sob `apps/api/src`, `apps/web/src`, `apps/web/tests`,
`migrations` e `scripts` continha 335 arquivos antes da última rodada, com hash
agregado SHA-256
`78DB65FD2F5D0D08F6475AAA0557FAFFD7C809C8E00D57887DB55CF02491BC8D`.
Após os testes, passou a 336 arquivos e hash
`62486BA4B27D6A0145C9793EA6AEA918D2A1B0EF6C533FE44F50EE5F36C4A9A8`.
O agregado usa caminhos absolutos ordenados e hashes dos arquivos; não é um
identificador portátil de release. A diferença detectou alterações concorrentes,
incluindo `202610270007_order_draft_editing.sql`, telas e testes de edição.
Portanto, não se afirma estabilidade do código-fonte durante toda a rodada.

## Limites

Autenticação é sintética nestes testes. Não foram provisionados cliente Auth de
produção, usuários reais ou implantação. Recebimento é declaração manual, sem
confirmação ou movimentação bancária. Conclusão não emite NF-e nem comprova
entrega. Outbox gravada não comprova consumo externo.

O resultado não conclui o ERP inteiro, não mede cobertura total, carga ou
desempenho industrial e não certifica conformidade tributária. A extensão
concorrente de rascunhos exige nova compilação, testes e atualização dos contratos.

## Capturas

- [Pedido concluído em tela móvel](screenshots/erp-pedido-mobile-persistente.png).
- [Recebimento e estorno em tela móvel](screenshots/erp-financeiro-mobile-persistente.png).
- [Cadastro de pessoas em tela móvel](screenshots/erp-pessoas-mobile-persistente.png).
- [Estoque em tela móvel](screenshots/erp-estoque-mobile-persistente.png).
