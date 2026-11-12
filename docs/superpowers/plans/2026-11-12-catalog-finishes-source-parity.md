# Acabamentos dos catálogos: implementação

> Execução inline por superpowers:executing-plans, com um único revisor final independente. Não delegar implementação.

Goal: separar estrutura, braços e estofado de ponta a ponta e apresentar opções/amostras reais dos catálogos, preservando dados e histórico.
Architecture: migração aditiva; contrato opcional no produto e itens; componentes existentes de acabamento com paleta explícita e rasters originais. Migração da imagem validada precede ativação da aplicação.
Tech stack: Rust/SQLx/PostgreSQL, Next16/React19/TypeScript, testes Rust/Node/Playwright e Python para deploy.
Spec: docs/superpowers/specs/2026-11-12-catalog-finishes-source-parity.md
Base: e065b0d5191abd8f176ef4c1310b3e1ffc9c4c3a; branch feat/catalog-finishes-source-parity-20261112; worktree a9e9.

## Global constraints
Não preencher nacionais/Core ou inserir dez modelos excluídos. Não sobrescrever fotos, preços, status, impostos, estoque ou histórico. Não reutilizar aliases armColors/armColor. Não gerar aproximações das imagens. Não compilar no servidor nem enviar e-mail/NF-e real nos testes. Publicação e preenchimento Premium já autorizados. Preservar processos e checkout do usuário.

## Task1 — contrato e persistência dos componentes
Files: migrations/202611120003_catalog_finishes.sql; apps/api/src/domains/catalog.rs; sales.rs; sales/proposals.rs; sales/negotiation_model.rs; sales/negotiation.rs; sales/pricing_orders.rs; caminhos de snapshots/conversões/contratos encontrados na leitura; testes HTTP de produtos/propostas/negociação e OpenAPI.
Interfaces: ProductInput.swing_arm_colors:Option<Vec<String>>,finishing_palette:Option<String>; itens swing_arm_color:Option<String>. upholstery permanece estofado; aliases legados permanecem anilheiro. Novas colunas em products e linhas existentes, sem reescrever dados antigos.
- [ ] Escrever testes RED de roundtrip/omissão, validação e legado independente.
- [ ] Implementar leitura/gravação/validação e propagar o campo nas conversões e snapshots.
- [ ] Testar edição de quantidade com seleção histórica inalterada após mudança de paleta; opções novas inválidas continuam recusadas.
- [ ] Rustfmt/clippy/contrato e testes apropriados; exportar OpenAPI real para a web.

## Task2 — paletas originais e seleção compacta
Files: apps/web/src/features/catalog/catalog-color-photo-model.ts,catalog-color-photos.tsx,catalog-workspace.tsx; public/catalog rasters/provenance; apps/web/src/features/sales/orders.tsx,proposals.tsx,commercial-simulator.tsx,negotiation-types.ts,documentos/detalhes; modelos e navegador.
Interfaces: palette explícita do produto + componente semântico; swingArmColors/swingArmColor novos; nomes atuais de estofado corretos. Desconhecido não recebe swatch aproximado.
- [ ] RED: cores e componentes independentes, nenhuma equivalência Amarelo→Apple Green, estofado não configurável não esconde braços.
- [ ] Reutilizar rasters originais e implementar as três seções/rótulos/seleções; atualizar os fluxos de proposta, pedido, simulador e documentos.
- [ ] Node/TypeScript/build e navegador em320/393/1280 com teclado e escolhas preservadas; conferir screenshots contra originais.

## Task3 — publicação com migração prévia
Files: deploy/migrate-release.py; scripts/deploy/test_migrate_release.py; deploy/README.md; integração controlada no /usr/local/sbin/erp-next-deploy com backup anterior.
Interfaces: helper recebe SHA validado, usa imagem pronta, ambiente sem valores em argv/output, backup schema e SQLx antes da ativação; falha não altera serviços antigos.
- [ ] RED: ativação não pode preceder migração; falha de backup/migração impede troca; segredo não aparece na linha de comando.
- [ ] Implementar e verificar o helper, documentar instalação/rollback e fazer uma revisão final independente do pacote inteiro.
- [ ] Corrigir achados importantes em um passe RED→GREEN; executar checks exigidos e publicar com migração/saúde/leituras autenticadas no mesmo SHA.

## Task4 — alinhamento Premium e planilha
Fonte: snapshot privado atual em checkout principal artifacts/ludus-documentacao-20261112/erp-e-planilha-fontes.json,94perfis; reler antes de aplicar. Planilha1X9_wg111VRUbE9Nnaqr8eR3zMSqhSIDDKK_q9MeDbF0,abaProdutosPremium,52colunas.
- [ ] Preparar correspondência e diff sustentados pelas referências, sem inferir paleta para Cable Motion; comparar campos protegidos.
- [ ] Backup + aplicação com revisão + readback dos Premium sustentados. Manter42tiposanilheiro e94fichas sem recarga.
- [ ] Reler a planilha, alterar só células relacionadas, preservar aba única e verificar valores.
- [ ] Registrar evidência e pendências legítimas por ausência na fonte; continuar depois no pacote de transferência ampliada da auditoria.

## Review focus
Omissão por clientes antigos; seleção histórica após alteração do produto; aliases antigos de cor de anilheiro não viram braços; ausência de estofado/paleta desconhecida; conversão/snapshot/documento não perde a seleção; migração falha sem ativar o novo software; mistura de empresas/revisões e células nativas da planilha preservadas.
