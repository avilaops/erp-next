# Leitura da prévia em paisagem

**Objetivo:** continuar a implementação da entrada corrigindo dois problemas reproduzidos em 844×390: diálogo sem margem lateral e captura vertical ampliada que mostra somente o cabeçalho na primeira área visível.

**Abordagem:** manter a prévia simples aprovada, sem adicionar modos. Em celulares em paisagem, selecionar uma captura real da ficha de produto focada no cartão de dados em duas colunas; retrato e desktop preservam seus ativos. Capturar o elemento real no navegador com dados sintéticos, sem editar ou fabricar a interface. O diálogo conserva 16px de margem horizontal em todos os tamanhos.

**Arquivos:** `apps/web/src/components/erp-entry-preview.tsx`, `apps/web/public/erp-preview-landscape.png`, testes existentes em `apps/web/tests/onboarding-ui.spec.ts`.

## Plano

- [x] Capturar cartão real em duas colunas, contendo SKU, unidade, preço e situação; inspecionar o arquivo salvo. PNG de 638×208, recorte do navegador incluindo os dados reais e o espaçamento existente do cartão; registros sintéticos locais.
- [x] Adicionar seleção por orientação antes da fonte de retrato; preservar proporção e rolagem vertical quando necessária.
- [x] Fixar largura do diálogo em `calc(100% - 2rem)`, limitada ao tamanho desktop existente.
- [x] Atualizar o teste existente para captura selecionada, margens, imagem inteira na área visível e rotação para retrato durante o diálogo aberto. Foco e fechamento continuam cobertos.
- [x] Executar lint/build/TypeScript e os 13 testes de onboarding sobre o build de produção. Revisão independente sem achados.
- [ ] Aprovar CI e release completos no SHA fixado.
- [ ] Publicar somente web após aprovação e verificar retrato, paisagem e desktop na página pública.

## Restrições

- Não modificar autenticação, cadastro, API, dados ou migrations.
- Sem modos adicionais ou mudanças na captura de retrato aprovada.
- Sem rolagem horizontal; botão de fechar permanece visível.
- SKU e preço pertencem ao conteúdo visível no início da captura em paisagem.
- Base de código `f52b502624d32f1d26cb5a11567affa2db2d7708`; web em produção `f40471acfb2b341d602bbd6c4075e1254b403e27`, API `99befd57dca537a17245d7a6de8c70ac652d99db` na última publicação. Revalidar antes de publicar.

## Concorrência de releases

Durante os testes, `main` recebeu `dd1cb600bc606001e8bffff9993525ec06ea9942` (editor de contratos, com APIs, dependência e migrations novas). A produção ainda estava em web `f40471a` / API `99befd5`. Esta release mantém a base publicada e acrescenta somente a prévia. A integração do PR em `main` deve preservar o editor de contratos; a publicação desta tarefa não provisiona nem implanta essa funcionalidade. Registrar separadamente SHA da imagem publicada e merge no PR/ticket.
