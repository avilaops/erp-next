# Estoque conectado à API

## Escopo

As rotas `/estoque`, `/estoque/saldos`, `/estoque/lancamentos` e
`/estoque/lancamentos/novo` compartilham o primeiro fluxo conectado de estoque.
O operador busca um produto, seleciona seu saldo e consulta ou registra movimentos.

- Saldos e histórico vêm da API Rust, com paginação e contexto de empresa.
- O saldo apresenta quantidade física, reservada por pedidos e disponível.
- A sessão permanece no BFF; credenciais da API não são enviadas ao navegador.
- As permissões `inventory.stock.read/manage` são verificadas pela API.
- Uma entrada ou saída exige quantidade positiva e motivo.
- O formulário completa a escala de seis casas por manipulação de texto.
  Não usa números de ponto flutuante para converter quantidades.
- Estorno cria outro movimento, de mesma quantidade e direção oposta, com
  referência ao original. Não altera nem exclui o movimento anterior.
- Saldo insuficiente, produto arquivado e segundo estorno são recusados pela API.
- Saídas manuais não consomem quantidades reservadas. Movimentos originados de
  pedidos não admitem estorno manual; exigem um fluxo próprio de devolução.
- Uma resposta perdida mantém o corpo e a chave de idempotência da operação em
  memória. A repetição usa o mesmo comando. Enquanto a confirmação está
  pendente, a edição e a troca de produto ficam bloqueadas.
- Ao fechar a aba ou recarregar com edição pendente, o navegador recebe a indicação
  de alterações não salvas. Não existe recuperação desse comando após fechar
  a página: persistência de rascunhos e reconciliação entre sessões ficam fora
  deste primeiro fluxo.

O histórico mostra o saldo confirmado após cada movimento. Em movimentações
concorrentes esse saldo representa aquele registro, não uma promessa de saldo
atual. A autorização e a disponibilidade continuam sendo verificadas na transação.

## Limites

O saldo implementado é por produto e empresa. Reservas comerciais são derivadas
dos pedidos confirmados, conforme o [contrato comercial](PEDIDOS-FINANCEIRO.md).
Depósitos, lotes, séries, contagem de inventário, produção e recebimento de compras
ainda exigem contratos e implementação próprios. As respectivas interfaces
demonstrativas não comprovam esses comportamentos.

A página inicial deixou de apresentar empresa, indicadores, séries e eventos
fictícios. Indicadores ainda não conectados aparecem como indisponíveis; isso
não significa saldo zero nem ausência de operações na empresa.

## Verificação reproduzível

O harness `scripts/verify-company.mjs` cria seu próprio banco e papel PostgreSQL
sem superusuário nem `BYPASSRLS`, aplica migrações e usa um Auth sintético local.
Ele executa os testes de empresa, acessos, catálogo, estoque, pessoas, pedidos e
recebíveis contra o Next.js
compilado e a API Rust. Também compara saldos e históricos antes e depois de
reiniciar o processo da API. Ao terminar, remove somente seus recursos temporários.

```powershell
$env:CARGO_TARGET_DIR = 'target/company-verification'
cargo build -p erp-next-api -j 1
pnpm --filter web lint
$env:CIRCLE_NODE_TOTAL = '3'
$env:ERP_NEXT_DIST_DIR = '.next-operations-verification'
pnpm --filter web build
$env:COMPANY_TEST_DATABASE_URL = 'postgres://erp_modules@127.0.0.1:55441/postgres'
pnpm test:company
pnpm --filter web test:e2e --workers=1
```

O PostgreSQL de teste precisa estar disponível no endereço informado. A variável
`CIRCLE_NODE_TOTAL=3` limita esta versão do Next.js a dois workers na geração de
páginas; foi conferida no código local da dependência. Não altera o contrato da
aplicação. Os testes são locais e não validam o Auth ou a implantação de produção.
