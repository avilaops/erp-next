# Verificação de rotas e fluxos do ERP-Next

Ferramenta local de descoberta, ligação estática, probes HTTP e execução das
suítes existentes. Os relatórios preservam a distinção entre código encontrado,
requisição observada e operação testada. Não é um emissor, um backend novo ou
um agente que altera o ERP automaticamente.

## Executar

O catálogo [contracts.json](contracts.json) descreve as operações Rust
existentes, suas precondições, estados, permissões, efeitos e recuperação, além
das ações dinâmicas do BFF e das famílias de fluxos que ainda exigem definição.
O verificador cruza essas fichas com os métodos/rotas/páginas descobertos. Rota
sem ficha, método divergente ou contrato apontando para rota ausente produz erro.
O relatório mostra a cobertura contratual separada do resultado de execução.
`p0Ready=false` permanece enquanto houver decisões contratuais pendentes.

Este catálogo documenta os tipos Rust existentes em vez de duplicar seus campos
em outro schema. Os testes conferem que as referências de tipos e fontes existem.
As oito dimensões de aceite não são resultados de testes. Veja o
[escopo e a matriz de ações](../docs/CONTRATOS-ACOES-P0.md).

## Contexto por funcionalidade

O campo `productFlows` do mesmo catálogo associa os grupos de ações a nomes e
objetivos de produto, dependências e próximos passos. As definições de sequência
inicial cobrem Usuários, Produtos e Compras. Os demais grupos mantêm o estado
`actions_mapped`, sem sequência de uso presumida.

```powershell
pnpm context:erp
pnpm context:erp --flow users
pnpm context:erp --flow products
pnpm context:erp --flow purchase_payment_chain
pnpm context:erp:mcp
```

O comando grava `context.json` e `context.md` em
`artifacts/product-context/<contentSha256>/`. Inclui as dependências transitivas
da funcionalidade selecionada, as ações canônicas, as permissões e os caminhos
das fontes com seus hashes. Não copia os campos dos tipos Rust para outro contrato.
Repetir entradas idênticas produz os mesmos bytes e reutiliza os arquivos;
um arquivo existente com conteúdo diferente é preservado e causa erro.

As definições e a saída têm JSON Schemas Draft 2020-12 em `schemas/`, validados
com Ajv. Referências inexistentes, propriedade desconhecida, grupo com mais de
um responsável e dependência circular impedem a geração. O comando confere
as fontes e o estado Git antes e depois da captura; essas leituras observam
intervalos e não bloqueiam o checkout como um snapshot atômico.

`routes_mapped` significa que o catálogo relaciona páginas e BFF. Publicação e
execução ficam como `not_observed`; o artefato não transforma commit, catálogo,
HTTP 200 ou sugestão de modelo em evidência de uso. O hash permite conferir o
conteúdo, mas não autentica quem produziu o artefato.

Este formato novo prepara o contexto para consumo pelo laboratório. Nesta etapa,
o comando não envia dados ao Experiments nem adiciona uma tela ou endpoint ao
laboratório. O importador existente de `route-inventory/2` continua separado;
ele não deve receber `erp-product-context/1` como se fossem o mesmo contrato.

O exportador `context:erp:mcp` prepara índice e capturas para as ferramentas
`erp_contexto_listar` e `erp_contexto_obter` do MCP central. A importação no n8n
é uma operação separada e confirmada por leitura; o comando não atualiza as
tabelas automaticamente. Veja o [contrato de consumo](../docs/CONTEXTO-FUNCIONALIDADES.md).

Com as dependências web já instaladas:

```powershell
pnpm verify:erp
pnpm test:verification
```

O primeiro comando lê as rotas e dependências atuais e grava `report.json`,
`report.md` e um painel HTML pesquisável em
`artifacts/verification/<data-uuid>/`. Não inicia serviços nem lê arquivos
`.env`, cookies, certificados ou dados do banco. Cada execução preserva as
anteriores e registra hashes dos arquivos, commit e situação do checkout.

```powershell
pnpm verify:erp --api http://127.0.0.1:8080 --web http://127.0.0.1:3201
```

Os probes são opcionais e aceitam somente origens loopback explícitas. Usam
GET anônimo, descartam o corpo, não seguem redirecionamentos e não executam
POST/PUT/DELETE. Um 401 esperado prova somente a recusa do acesso anônimo.
Um 200 na web não aprova a página: ela permanece inconclusiva até uma
verificação de navegador. Indisponibilidade de transporte é inconclusiva.

## Suítes com evidência real

```powershell
$env:ERP_VERIFY_TEST_DATABASE_URL = 'postgres://USUARIO_DE_TESTE@127.0.0.1:PORTA/postgres'
pnpm verify:erp --suite rust
pnpm verify:erp --suite flows
```

Declare uma instância local dedicada a testes. Não use o PostgreSQL de trabalho
ou de produção. A conta precisa criar bases e papéis. Os testes SQLx e o
harness existente criam bases sintéticas; o verificador não decide sozinho
qual instância pode ser usada. Ele não reaproveita `DATABASE_URL` do ambiente
como autorização implícita.

`rust` executa `cargo test --workspace`. `flows` compila a API atual em
`target/verification`, compila a web e chama `scripts/verify-company.mjs`, que
inclui os cenários de persistência presentes na configuração Playwright do
projeto. O harness usa Auth sintético e confere persistência após reiniciar a
API. `PG_BINDIR` pode selecionar a instalação PostgreSQL. As portas do harness
precisam estar livres. Os logs têm remoção de segredos conhecidos e limite de
tamanho. Interrupção por timeout pode exigir limpeza de recursos de teste;
nenhuma suíte é tratada como aprovada nesse caso.

As portas 18441, 18081 e 3202 são conferidas antes dos builds e antes do
harness. A checagem não reserva portas; um conflito posterior também é
classificado como inconclusivo. O verificador não encerra aplicações que já
estavam usando essas portas.

Suítes são comandos fixos do próprio projeto. Não há entrada para executar
comandos produzidos por IA. Elas não validam login, banco ou serviços externos
de produção. As verificações não corrigem regras de negócio automaticamente.

## Verificação identificada do DANFE

```powershell
$env:ERP_VERIFY_TEST_DATABASE_URL = 'postgres://USUARIO_DE_TESTE@127.0.0.1:PORTA/postgres'
pnpm verify:erp --suite danfe
```

A suíte `danfe` associa explicitamente os testes nomeados à rota
`POST /api/v1/fiscal/danfe`, ao BFF e à página correspondente. Executa Cargo com
dois jobs e um teste por vez, preserva o log e verifica os hashes das fontes e
fixtures antes/depois. Um comando com saída zero e nenhum teste correspondente
não aprova o fluxo. Testes ausentes, ignorados, duplicados ou mudança de fonte
mantêm o resultado inconclusivo.

O relatório HTML/Markdown mostra os checks individuais e os hashes do plano,
log e arquivos. O resultado cobre API e transporte em PostgreSQL isolado, Auth
sintético e MCP de teste. Não aprova a execução da página, um XML de cliente,
o estado atual na SEFAZ ou os serviços de produção. As páginas mantêm seu
estado de verificação individual separado.

Para verificar a página e o BFF com uma API fiscal de teste, execute
`pnpm --filter web build` e depois `pnpm --filter web test:danfe`. Os quatro
cenários Chromium salvam JSON e screenshots em uma pasta exclusiva de
`artifacts/danfe-browser/`. A configuração identifica sessão sintética e API de
teste nos metadados; essa execução não aprova o encadeamento com o MCP real.

## Aprendizado de máquina

O adaptador em `ml/anomaly.py` aplica Isolation Forest ao tempo e tamanho das
respostas de um mesmo check, origem e expectativa. Treina somente com execuções
anteriores aprovadas daquele check e usa a execução atual como amostra nova.
Exige pelo menos vinte execuções históricas distintas por check; esse número
é um limite inicial da ferramenta, não garantia estatística de qualidade.

```powershell
python -m venv .venv-verification
.venv-verification/Scripts/python -m pip install -r verification/ml/requirements.txt
pnpm verify:erp --api http://127.0.0.1:8080 --ml-python .venv-verification/Scripts/python.exe
```

Sem histórico suficiente, a saída é `insufficient_history`; sem a biblioteca,
`dependency_missing`. Não se inventam observações para treinar. O modelo
informa indício de anomalia e um fingerprint do treinamento; não substitui
assertions, não aprova fluxo e não autoriza mudanças ou implantação. Não há
treinamento de entendimento de regras de negócio ou de navegação autônoma nesta
versão. A avaliação de falsos positivos exige histórico representativo e revisão.
Modelos não são carregados de pickle ou de arquivos recebidos de terceiros.

Referência primária: [IsolationForest no scikit-learn](https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.IsolationForest.html).
Para investigar passos, rede e assertions dos testes, o
[tracing do Playwright Test](https://playwright.dev/docs/api/class-tracing)
pode ser habilitado na configuração de teste; ele ainda não é habilitado por
este coletor e pode conter dados sensíveis da execução.

## O que os resultados significam

- `not_verified_per_route` e `not_associated_per_file`: ainda não há correlação
  individual de evidência com a página ou arquivo. Uma suíte aprovada é
  registrada separadamente e não aprova todas as ações de suas páginas.
- Ligações estáticas: a árvore de imports pode incluir componentes nunca
  renderizados nesta rota. Não é um trace de chamadas reais.
- Callbacks vazios e alvos ausentes são achados com arquivo e linha para revisão.
- O scanner Rust cobre registros literais `.route(...)`, excluindo módulos
  `cfg(test)`. Composição dinâmica e macros exigem outro adaptador/revisão.
- A descoberta segue módulos externos convencionais a partir de `main.rs` e
  `lib.rs`; arquivos de teste continuam nos hashes, sem serem rotas de produção.
  Projetos sem esses pontos de entrada mantêm a varredura de arquivos do modo
  anterior. `#[path]`, módulos externos declarados dentro de módulos inline,
  macros e outras condições `cfg` exigem revisão; não há análise de compilação Rust.
- Aliases TypeScript cobertos: relativos e `@/` para `apps/web/src`, conforme a
  configuração atual. Mudanças de convenção exigem atualização do resolvedor.
- Mudança de código durante a execução impede tratar a evidência como uma
  verificação de uma única versão e a exclui do histórico elegível do modelo.
- A comparação mostra rotas adicionadas/removidas e regressões de probes
  compatíveis. Diferenças não são corrigidas automaticamente.

Código de saída: `0` significa que as verificações solicitadas terminaram sem
falha reconhecida; no modo estático isso não significa ERP funcional. `1`
indica falha encontrada; `2`, execução incompleta ou inconclusiva.

O laboratório independente em `experiments/` permanece separado. Os relatórios
daqui não são publicados nele nem enviados a serviços de ML automaticamente.
