# Prévia móvel do ERP

**Objetivo:** corrigir a prévia após as três capturas enviadas pelo usuário: miniatura ilegível em paisagem, corte horizontal em detalhes e excesso de espaço vazio na visão geral.

**Decisão aprovada:** usar uma captura real da interface móvel no celular, ajustar a imagem à largura, remover os dois modos e o rodapé explicativo e manter uma única ação de ampliação. Preservar a captura de desktop em telas maiores. O usuário autorizou a execução da recomendação.

**Arquitetura:** manter o diálogo Base UI existente com cabeçalho compacto e botão de fechar fixos. O corpo acompanha a altura natural da imagem, limitado pela tela e com rolagem vertical. Usar `picture` para escolher a captura móvel abaixo de 640px e também em celulares em paisagem. Capturas usam somente registros demonstrativos locais.

## Tarefas

- [x] Capturar a ficha real de produto em 390×760, com dados sintéticos e sem estados de carregamento/erro. A ficha mostra nome, SKU e preço sem a densidade da tabela do catálogo.
- [x] Simplificar `apps/web/src/components/erp-entry-preview.tsx`: uma ação, sem modos/rodapé/altura fixa; largura completa, sem corte horizontal.
- [x] Atualizar os testes existentes em `apps/web/tests/onboarding-ui.spec.ts` para imagem responsiva, ausência de espaço vazio, rolagem vertical, foco, Escape, reabertura e paisagem.
- [x] Verificar lint, build, testes e capturas de 320px, 390px, paisagem e desktop. Revisar o diff independentemente.
- [ ] Publicar somente após CI e release aprovados, preservando a API atual; verificar a página pública.

## Critérios de revisão

- Não reduzir a imagem para caber verticalmente: permitir leitura por rolagem vertical.
- Fechar permanece totalmente visível, inclusive em 568×320 e 844×390.
- Não introduzir rolagem horizontal, modos adicionais ou instruções sobre teclado na apresentação.
- Imagem começa logo abaixo do cabeçalho, sem áreas artificiais acima ou abaixo.
- Login, criação de conta, returnTo e avisos existentes continuam funcionando.

## Base

Produção e `origin/main` em `99befd57dca537a17245d7a6de8c70ac652d99db` na inspeção inicial. Esta tarefa não altera API, persistência ou migrations.

## Evidências locais

- Lint e revisão independente do componente, testes e script de implantação sem problemas encontrados.
- Os dois testes da prévia passaram em desenvolvimento, incluindo 320px, 390px, desktop e paisagens 568×320 / 844×390.
- A suíte de onboarding em desenvolvimento apresentou uma falha de hidratação em `CompanySummary`, fora do diff. A validação no build de produção é obrigatória antes de publicar; não remover a asserção de erros do navegador.
- A captura móvel é PNG de 390×760, 48 KiB, produzida pelo navegador na ficha real de um produto com dados sintéticos. Nenhum dado de produção foi capturado.
- Build de produção e TypeScript aprovados. Os 13 testes de onboarding passaram sobre o build de produção em 23,6s, incluindo o teste de empresa que falhou em desenvolvimento, sem alterar essa página nem enfraquecer suas asserções.
- A implantação permanece condicionada à CI/release completos e à verificação pública. Seus identificadores finais serão registrados no PR e no ticket AVL-382.
