# Miniatura compacta na entrada

**Objetivo:** reduzir a rolagem da entrada no celular sem reduzir a legibilidade da imagem ampliada.

**Decisão de apresentação:** a miniatura móvel exibe até 320 px da captura real, com um desvanecimento discreto na borda inferior em retrato e a ação “Ver tela completa”. A janela mantém a imagem inteira, sua proporção, rolagem, foco, estados de carregamento e recuperação. A apresentação a partir de 640 px permanece integral. Nenhuma nova dependência ou captura é necessária.

## Implementação e verificação

- [x] Limitar somente a miniatura em `apps/web/src/components/erp-entry-preview.tsx`, sem inserir controles aninhados.
- [x] Verificar nos testes existentes de `apps/web/tests/onboarding-ui.spec.ts` a altura compacta em 320 e 390 px e a proporção integral na ampliação.
- [x] Executar lint, build e os 15 testes de onboarding (24,4 s); inspecionar retrato, paisagem e desktop, incluindo falha de imagem e teclado. Revisão independente sem achados.
- [ ] Revisar o diff independentemente; aprovar CI e release e verificar a entrada publicada.

## Limites

- Acesso e criação de conta continuam visíveis na primeira tela móvel.
- Sem alterações de autenticação, API, dados, migrations ou configuração operacional.
- A miniatura indica o recorte; a imagem ampliada continua completa.
