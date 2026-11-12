# Importação de produtos recuperável — Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans, TDD and one fresh final review of the whole branch.

**Goal:** Corrigir o envio da empresa ativa e tornar a importação existente utilizável, compacta, explícita e recuperável.

**Architecture:** Next/React existentes, sem dependências novas. Manter parsing, autorização, duplicidade/SKU, transação e resultado persistido da API Rust. A web envia X-Tenant-Id e usa o ID persistido da prévia na URL; ao recarregar consulta o resultado autorizado, sem importar automaticamente. A confirmação usa esse mesmo UUID como Idempotency-Key em toda repetição.

**Spec:** [AVL-379](https://linear.app/avilaops/issue/AVL-379): prévia e erros do arquivo real, confirmação explícita, repetição sem duplicação e resultado recuperável. Brief aceito nesta conversa: compacto, responsivo e friendly, mantendo identidade atual. Continuação autorizada com deploy/publicação; não reabrir discussão de design.

## Global Constraints

- Apenas web/BFF se necessário; API e banco não mudam. A API já tem os endpoints de prévia, consulta e confirmação.
- CSV UTF-8 até 2 MiB, até5000 linhas conforme backend. Não prometer XLSX, estoque inicial, importação de imagens ou todos os domínios.
- Preview POST e confirm POST levam a empresa capturada de /me; BFF continua recusando sessão/empresa divergentes.
- Nenhum produto é gravado ao escolher arquivo ou gerar prévia. Confirmar só após conferência explícita; a API continua sendo autoridade.
- O ID na URL referencia resultado persistido e autorizado. Recarregar/consultar/repetir nunca cria outro job nem confirma automaticamente.
- Erro ou perda de resposta na confirmação exige conferir/repetir o mesmo job, sem substituir arquivo no meio de resultado incerto.
- Não inventar sucesso/contagens quando resposta é inválida. Validar o contrato do job e mostrar importação parcial conforme resultado retornado.
- Navegação/duplo clique/respostas tardias respeitam operação em andamento; não alterar dados de outra empresa.
- Testes somente com arquivos e API/sessão sintéticos; aceite real autenticado fica separado. Linear somente leitura.
- Validar 320/390/430/1366/1440, teclado, controles móveis44px e nenhum corte lateral. Build local/CI, nunca compilar em produção; deploy web apenas.

## Review Focus

- Header X-Tenant-Id ausente hoje torna ambos os POST409 no BFF: reproduzir pelo navegador e conferir o protocolo completo.
- Troca de arquivo, arquivos inválidos ou leitura malformada não podem confirmar uma prévia anterior.
- Falha de confirmação pode ocultar commit já aplicado: recarregar/consultar mostra verdade do mesmo job sem novo POST automático.
- Prévia de outra empresa/ID divergente/resposta inválida nunca vira botão de confirmação ou mensagem de sucesso.
- Nomes/SKUs/erros longos cabem no celular; linhas inválidas e conflitantes ficam identificáveis e não se apresentam como importadas.

### Task 1: Contrato de arquivo e resultado

**Files:** Create `apps/web/src/features/data/import/product-import-model.ts`, `apps/web/tests/product-import-model.node.mjs`.
**Interfaces:** Produz `productImportHref(id: string): string`, `readProductImport(response: Response, expectedId?: string): Promise<ProductImport>`, `readProductImportFile(file: File): Promise<{filename: string;content: string}>`. `ProductImport` corresponde a data_transfer.rs: id/filename/format/status/valid/invalid/conflicts/rows/result.

- [ ] Escrever testes para tamanho/extensão/UTF-8, URL segura, resposta e contadores verdadeiros, resultado parcial e erros/ID divergente. Rodar e observar RED.
- [ ] Implementar helpers preservando conteúdo do arquivo e dados do backend; rodar modelos completos, esperar GREEN.

### Task 2: Fluxo compacto, protocolo e recuperação

**Files:** Modify `apps/web/src/features/data/import/data-import.tsx`; create `product-import-job.tsx`, `apps/web/tests/product-import-ui.spec.ts`; register test in `apps/web/playwright.danfe.config.ts`.
**Interfaces:** Consome helpers/contrato Task1. `/me` determina acesso/empresa; preview POST `{filename,content}`; GET `/products/import/{id}`; POST `/products/import/{id}/confirm` bodyless, Idempotency-Key=id e X-Tenant-Id.

- [ ] Teste navegador reproduz header ausente em POST; observar RED na build anterior com API sintética.
- [ ] Implementar escolha do arquivo, gerar prévia, conferência explícita e confirmação. Guardar ID em `?job=UUID` e consultar na reabertura; oferecer novo arquivo sem reutilizar prévia anterior.
- [ ] Proteger navegação/concorrência, manter resultado incerto no mesmo job e permitir conferir resultado/repetir. Validar resposta e bloquear acesso insuficiente.
- [ ] Testar cinco larguras e arquivo/conflitos/inválidos, confirmação, reload, perda de resposta, autorização, erros, navegação e resposta tardia. Esperar GREEN.

### Task 3: Revisão e publicação

- [ ] Build, TypeScript, lint, modelos e navegador de produção. Capturas mobile/desktop revisadas.
- [ ] Uma revisão independente da branch; corrigir achados relevantes via RED→GREEN e repetir verificações afetadas.
- [ ] Commit/PR/CI; integrar somente revisão testada. Publicar web compilada localmente, confirmar revisão pública e4 serviços saudáveis.
- [ ] Arquivar ledger e deixar main limpa. Não declarar aceite autenticado ou fechamento de AVL-379 sem evidência real.
