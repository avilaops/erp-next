# Integração frontend — lote 4

Esta branch reúne os lotes 1–3 sobre a main `bbb577c`, incluindo preparação de NF-e a partir de pedidos confirmados. Nenhuma migração, lógica Rust, autorização fiscal externa ou configuração de produção é alterada.

## Conciliação

- A listagem de NF-e utiliza `NfeDrafts`; detalhe/criação preservam `NfeDraftEditor` e a preparação por pedido da main. A criação recebeu metadados específicos.
- Preferências da empresa utiliza pesquisa, painel mobile e estados não verificados do lote 2, preservando o acesso ao A1.
- O certificado mantém a implementação real de upload, remoção, revisão e limpeza de senha. Erros 401 oferecem retorno contextual.
- A navegação fiscal identifica rascunhos de saída como funcionalidade disponível, mantendo a distinção de emissão/transmissão indisponível.
- O inventário contém 178 páginas: 91 prévias, três indisponíveis, 77 com API/autenticação e sete de navegação/configuração local. A classificação não certifica transações.

## Verificação reproduzível

`pnpm --filter web test:danfe` inclui regressões anteriores, integração fiscal/A1 e axe-core 4.14.0 em quatro telas (empresa, A1, listagem e criação de NF-e), nos temas claro e escuro efetivamente aplicados. Testes funcionais usam sessão e respostas sintéticas; a validação Rust/PostgreSQL e as specs de persistência mantêm responsabilidades próprias.

No Windows, para desenvolvimento isolado:

```powershell
$env:ERP_BROWSER_DEV='1'
$env:ERP_BROWSER_CHANNEL='msedge'
pnpm --filter web test:danfe
```

A varredura visual completa é explícita, para não transformar cada PR em uma recaptura extensa:

```powershell
pnpm --filter web exec playwright test --config playwright.audit.config.ts
```

Ela percorre as 178 páginas com amostras de parâmetros dinâmicos, captura 390/1749 px e grava `coverage.json` em `artifacts/danfe-browser/<execução>`. As APIs de navegador retornam indisponibilidade controlada; gravações são recusadas. Essas capturas verificam apresentação e estados negativos, não dados ou transações em produção. A suíte de integração cobre separadamente estados operacionais com fixtures.

Para repetir somente rotas afetadas, `ERP_AUDIT_ROUTES` aceita padrões separados por vírgula, como `/dashboard,/servicos/contratos/[id]`. O relatório registra somente as rotas percorridas nessa execução; não equivale a uma nova varredura completa.

## Achados corrigidos durante a recaptura

- Vinte e cinco páginas dinâmicas aguardavam parâmetros acima da fronteira local de Suspense. Agora a transição tem carregamento próprio abaixo do layout compartilhado.
- Links renderizados pelo componente Button em aplicativos, eventos, conta digital e logística declaram o elemento não nativo, eliminando avisos de JavaScript.
- Estados de erro/carregamento de edição de compras, vendas, contas a pagar e contratos preservam título e saída para a lista.
- O redirecionamento legado `/dashboard` ocorre antes da renderização, sem o erro de validação de navegação instantânea.
- Os avisos de NF-e na lista e no editor usam cores explícitas para texto e fundo nos dois temas. O scanner classificou contraste 1:1 como inconclusivo; a inspeção visual confirmou o defeito e a regressão passou a rejeitá-lo.
- A visão de compras identifica a consulta de notas de entrada como disponível, mantendo sugestões como demonstração.

Em 30/10/2026, a varredura completa produziu 356 capturas, sem overflow horizontal nem exceções JavaScript não tratadas. Registrou o aviso do redirecionamento e ausência de título em duas rotas de contratos; a repetição posterior dessas três rotas e das duas telas fiscais produziu dez capturas sem ocorrências. A execução original com falhas foi preservada como evidência.

Na validação local, 16 testes passaram no Edge e cinco cenários no WebKit em execuções complementares. As oito combinações de tela/tema passaram no axe, sem violações ou resultados inconclusivos nessas execuções. As medições aguardam a resposta da API e a aplicação do tema; o ambiente de desenvolvimento admite compilação fria na transição testada, mantendo o limite normal na execução de produção. Resultados de CI devem ser conferidos no commit atual do PR, sem inferir publicação.

O CI revelou também uma falha intermitente na fixture HTTP do inventário: conversão independente de buffers corrompia caracteres UTF-8 divididos entre pacotes. A fixture usa agora o decodificador do stream com `setEncoding('utf8')`; as verificações de corpo, revisão e leitura divergente foram mantidas.

## Acessibilidade e limites

O critério visual considera hierarquia, contraste, rótulos, teclado, foco, movimento reduzido e temas. As [diretrizes Apple de acessibilidade](https://developer.apple.com/design/human-interface-guidelines/accessibility) são referência de princípios; esta aplicação web não usa SwiftUI.

Axe não substitui revisão manual ou leitor de tela. WebKit emulado não comprova Safari/iPhone físico, VoiceOver, teclado virtual ou safe area de dispositivo. Resultados e capturas efetivamente inspecionadas ficam no relatório local e no PR.

Publicação exige revisão integrada, CI do commit exato e smoke de leitura da revisão servida. A sessão autenticada do usuário não é usada nas suites e não deve ser desconectada.
