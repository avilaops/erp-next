# Comercial e navegação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Concluir e verificar tabela publicada → simulação → pedido, com navegação compacta, valores consistentes e preservação do acordo comercial.

**Architecture:** Reutilizar o domínio comercial e os snapshots existentes. Corrigir cálculos e a origem fiscal no servidor; manter o navegador responsável por preenchimento, navegação e apresentação. Os testes usam dados sintéticos ou PostgreSQL isolado, sem vendas, e-mails ou transmissão fiscal reais.

**Tech Stack:** Rust/Axum/SQLx/PostgreSQL; Next.js/React/TypeScript; Playwright e testes de domínio/HTTP existentes.

**Spec:** Critérios comerciais e de navegação de AVL-432 e AVL-17, com as correções explícitas do usuário: sem cor de anilheiro; tipo Standard, Olímpico ou não se aplica na negociação; cores fotográficas do catálogo; interface compacta e responsiva.

## Global Constraints

- Preservar preços, parâmetros, documentos e dados reais existentes.
- Cálculos monetários em centavos; percentuais em pontos-base; servidor decide preços, aprovação e permissões.
- Preservar tenant, revisão, digest, idempotência, auditoria e histórico imutável.
- Não executar operações comerciais, financeiras, e-mails ou emissões fiscais reais como teste.
- Compilação local ou em CI; nenhuma compilação no servidor de produção.
- Interface legível em 320, 390, 430, 1366 e 1440 pixels, com teclado e indicação dos requisitos antes de criar o pedido.

## Review Focus

- Arredondamento no limite livre não deve criar uma exceção inexistente.
- Um total desejado não deve ser ultrapassado por um centavo.
- Sem desconto, a simulação deve conservar o preço publicado com IPI.
- Custos e margens exigem as mesmas permissões na simulação e no pedido preservado.
- Reabrir ou atualizar uma negociação não pode perder cliente/acabamentos nem repetir um comando incerto.

## Baseline

- Base: d64acfea4b12be1a318d094d9d1e9c2a162ff09f.
- 26 testes existentes de simulador, navegação e pedidos aprovados com a build de produção local.
- Lacunas identificadas: cálculo comercial novo diverge do arredondamento já protegido no motor anterior; preparação fiscal considera somente o snapshot antigo; ausência de teste de conversão bem-sucedida da tabela ao detalhe.

### Task 1: Cálculo e permissões comerciais

**Files:** `apps/api/src/domains/sales/negotiation_model.rs`, seus testes de modelo, `apps/api/src/domains/sales/negotiation.rs`, `apps/api/src/http/negotiation_tests.rs` (confirmar caminhos do modelo antes da edição).

- [x] Adicionar regressões para preço sem IPI 30001, IPI 1300 pontos-base, sem desconto: preço com IPI 33902.
- [x] Adicionar regressão para quantidade 3, preço 1256323 e total desejado 4258934: total efetivo nunca excede o desejado.
- [x] Adicionar regressão para desconto de exatamente 2000 pontos-base não exceder o limite livre de 2000 por arredondamento subcentavo.
- [x] Reutilizar as regras inteiras verificadas do motor anterior e preservar alçadas de lucro/frete/entrada.
- [x] Conferir proteção de custos e margem com gestor sem permissão de diretoria; ajustar resposta do servidor e teste HTTP.

### Task 2: Pedido negociado e origem fiscal

**Files:** `apps/api/src/domains/fiscal/order_source.rs`, `apps/api/src/http/negotiation_tests.rs`.

- [x] Reproduzir conversão comercial e preparação fiscal com mais de um item.
- [x] Usar os valores sem IPI do snapshot comercial preservado, sem recalcular com a tabela corrente.
- [x] Recusar inconsistência entre snapshot e itens reais em vez de preparar valores divergentes.
- [x] Verificar compatibilidade com pedidos simples e com o simulador anterior.

### Task 3: Navegação comercial e recuperação

**Files:** `apps/web/src/features/sales/commercial-table.tsx`, `commercial-simulator.tsx`, modelos auxiliares necessários e rotas correspondentes; testes de navegador comerciais.

- [x] Preservar linha, busca e paginação da tabela na URL e no retorno do simulador.
- [x] Oferecer retorno por Vendas e proteger a saída de negociação preenchida.
- [x] Explicar cliente/vencimento ausentes e oferecer próximo passo visível após simular.
- [x] Recuperar uma revisão obsoleta sem exigir redigitação da negociação; comando incerto conserva chave e conteúdo.
- [x] Verificar percentuais, reais e total desejado, estados vazios/erros e conservação de acabamentos.
- [x] Exercitar o percurso integrado tabela → produto → simulação → criação 201 → detalhe, nos cinco tamanhos e com teclado.

### Task 4: Revisão e publicação

- [x] Conferir fórmulas, permissões e regressões em revisão independente.
- [x] Executar testes relevantes de domínio/HTTP, modelos web, lint, build e navegador; registrar limites da validação.
- [ ] Integrar PR aprovado e publicar artefatos versionados, com migrations apenas se realmente necessárias.
- [ ] Conferir saúde pública, versão e serviços; preservar distinção entre testes sintéticos e uso real autorizado.
- [x] Registrar quais critérios de AVL-432/AVL-17 foram comprovados e quais permanecem fora deste recorte.

### Task 5: Modelo comercial conferido no Brave e confirmado pelo usuário

A referência LUDUS foi inspecionada em 11/11/2026; valores de exemplo não substituem a política do ERP.

- [x] Comparar preços sem IPI, com IPI e com desconto livre, alçada e menor preço por UF/contribuinte.
- [x] Carrinho com quantidades na tabela, preservado na URL e aberto no simulador.
- [x] Salvar cliente/endereço e IE declarada no pedido sem inferir condição de contribuinte.
- [x] Entrada em reais/percentual, forma e data; saldo com parcelas editáveis e centavos exatos.
- [x] Persistir plano, fabricação após recebimento da entrada e observações de entrega/pagamento/pedido.
- [x] Confirmação gera títulos abertos de entrada/parcelas sem declarar recebimento; conclusão reutiliza títulos; cancelamento preserva histórico.
- [x] Preservar os mesmos termos no detalhe, PDF, e-mail e contratos.
- [ ] Publicar a versão conferida com backup completo e conferir a saúde dos serviços.

## Evidências antes da publicação

- Revisão independente do backend corrigiu projeções de e-mail/contrato; revisão frontend corrigiu centavos ao Tab, percentual inválido, datas, item removido e navegação de linha.
- PostgreSQL privado em 127.0.0.1:55439: 19 testes de negociação/modelo, 2 de alçadas/tabela, 5 de checkout e 31 de contratos/e-mails/devoluções/simulador passaram. Nenhuma operação real.
- 74 testes de modelos web passaram; lint sem erros (oito avisos preexistentes), TypeScript e build de produção passaram.
- 17 novos testes de navegador passaram, incluindo tabela/carrinho em 320/390/430/1366/1440 px e condições completas em 390/1366 px. As 57 regressões existentes passaram (uma foi ajustada e repetida para abrir os preços recolhidos no celular); total de 74 cenários distintos aprovados. Capturas adicionais de tabela e pedido em 390 px foram inspecionadas.
- Continuidade de navegação e cálculo de AVL-432/AVL-17 verificada neste recorte. Aprovação de usuários autenticados com dados reais, configuração de SMTP e demais frentes fiscais/financeiras do projeto não foram declaradas concluídas por estes testes.