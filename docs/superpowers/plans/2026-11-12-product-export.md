# Exportação de produtos confiável — Implementation Plan

> For agentic workers: use superpowers:executing-plans, TDD and one independent final review before integration.

**Goal:** Melhorar o fluxo existente de exportação, preservando filtros, identificando acesso/erros e entregando somente o CSV correto ao navegador.

**Spec:** [AVL-380](https://linear.app/avilaops/issue/AVL-380) pede filtros efetivos, conteúdo/nome/MIME corretos, proteção de planilha e autorização/isolamento no backend. O código atual já possui GET /products/export com catalog.products.export, RLS por empresa e CSV escapado; não reimplementar. A aceitação autenticada continua distinta dos testes sintéticos.

**Architecture:** Somente web e BFF. Manter dados e serialização CSV do backend. Conferir a permissão da sessão via /me, validar filtros e resposta CSV no cliente, guardar os filtros aplicados enquanto a operação estiver em andamento e permitir cancelamento. O BFF conserva o protocolo CSV e a identidade da sessão, sem aceitar empresa pelo navegador.

## Constraints / Review Focus

- Não iniciar exportação sem acesso conferido; a autorização real permanece no endpoint existente.
- Nome produtos.csv, MIME CSV e conteúdo devem corresponder ao contrato; JSON/HTML/arquivo vazio não viram download de sucesso.
- CSV de apenas cabeçalho é válido e indica ausência de produtos no filtro. Não inventar contagem, histórico persistente ou conclusão de gravação em disco.
- Manter os bytes/células do servidor, inclusive acentos, aspas, quebras de linha, zeros de códigos e fórmulas já neutralizadas. Não reformatar preços.
- Filtros permanecem preservados em erro/repetição, ficam bloqueados durante a geração e correspondem ao arquivo entregue.
- Cancelar/sair impede download tardio e não permite duas requisições concorrentes; usar a confirmação existente para links enquanto ocupado.
- Distinguir erro de sessão/permissão/rede e manter acesso ao catálogo conforme permissão de leitura.
- Validar desktop/celular em 320/390/430/1366/1440; alvos móveis de44px, teclado e ausência de rolagem lateral.
- Sem exportação de dados reais como teste sem sessão autenticada autorizada; sem importação, alteração de produtos, envio de mensagens ou operação fiscal.
- Sem mudança de status/comentário no Linear, nem alteração de API/banco. Build local/CI; publicação somente web, sem compilação em produção.

### Task 1: Contrato de consulta e arquivo

- [ ] Testar filtros válidos/inválidos, cabeçalho e MIME, UTF-8/células preservadas, erros e CSV sem produtos.
- [ ] Testar BFF: sessão/tenant, filtros permitidos, recusa de duplicados/métodos indevidos e preservação do protocolo CSV.
- [ ] Implementar helpers e ajuste do BFF conservando o endpoint e as permissões.

### Task 2: Tela compacta e recuperação

- [ ] Reproduzir filtros editáveis durante geração e respostas inválidas entregues como arquivo.
- [ ] Conferir acesso, validar entrada, congelar filtros, cancelar, recuperar erros e informar o envio ao navegador.
- [ ] Proteger navegação e limpar recursos sem disparo tardio, mantendo os filtros em erro e cancelamento.
- [ ] Conferir arquivo e estados de acesso/carregamento/vazio/erro em cinco larguras, com dados sintéticos.

### Task 3: Revisão e publicação

- [ ] Modelos completos, navegador na build de produção, TypeScript, lint, build e capturas.
- [ ] Revisão independente, correções relevantes, commit e CI aprovada.
- [ ] Publicação web com revisão pública e saúde dos quatro serviços, sem declarar aceite autenticado completo.
