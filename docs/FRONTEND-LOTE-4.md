# Integração frontend — lote 4

Esta branch reúne os lotes 1–3 sobre a main `bbb577c`, incluindo preparação de NF-e a partir de pedidos confirmados. Nenhuma migração, lógica Rust, autorização fiscal externa ou configuração de produção é alterada.

## Conciliação

- A listagem de NF-e utiliza `NfeDrafts`; detalhe/criação preservam `NfeDraftEditor` e a preparação por pedido da main. A criação recebeu metadados específicos.
- Preferências da empresa utiliza pesquisa, painel mobile e estados não verificados do lote 2, preservando o acesso ao A1.
- O certificado mantém a implementação real de upload, remoção, revisão e limpeza de senha. Erros 401 oferecem retorno contextual.
- A navegação fiscal identifica rascunhos de saída como funcionalidade disponível, mantendo a distinção de emissão/transmissão indisponível.
- O inventário contém 178 páginas: 91 prévias, três indisponíveis, 77 com API/autenticação e sete de navegação/configuração local. A classificação não certifica transações.

## Verificação reproduzível

`pnpm --filter web test:danfe` inclui regressões anteriores, integração fiscal/A1 e axe-core 4.14.0 em três áreas, nos temas claro e escuro efetivamente aplicados. Testes funcionais usam sessão e respostas sintéticas; a validação Rust/PostgreSQL e as specs de persistência mantêm responsabilidades próprias.

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

## Acessibilidade e limites

O critério visual considera hierarquia, contraste, rótulos, teclado, foco, movimento reduzido e temas. As [diretrizes Apple de acessibilidade](https://developer.apple.com/design/human-interface-guidelines/accessibility) são referência de princípios; esta aplicação web não usa SwiftUI.

Axe não substitui revisão manual ou leitor de tela. WebKit emulado não comprova Safari/iPhone físico, VoiceOver, teclado virtual ou safe area de dispositivo. Resultados e capturas efetivamente inspecionadas ficam no relatório local e no PR.

Publicação exige revisão integrada, CI do commit exato e smoke de leitura da revisão servida. A sessão autenticada do usuário não é usada nas suites e não deve ser desconectada.
