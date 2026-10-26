# Roadmap completo do frontend do ERP

## Objetivo

Entregar todas as superfícies web previstas em `docs/ROADMAP.md` antes da integração com o backend. Cada rota usa dados simulados identificados, mantém o padrão visual definido em `docs/architecture.md` e evita afirmar que processos fiscais, financeiros ou externos estão operacionais.

## Estado das trilhas

Atualizado em 25 de outubro de 2026.

Legenda:

- **Concluída:** tela-base e fluxos próprios de criação, detalhe, edição ou operação implementados e cobertos pela regressão aplicável.
- **Tela-base concluída:** todas as rotas planejadas existem e são navegáveis, mas ainda faltam fluxos próprios de operação.
- **Validada no escopo atual:** a automação cobre todas as rotas existentes; deve crescer junto com os próximos fluxos.

| Trilha | Faixa | Estado |
| --- | --- | --- |
| Preferências | FE-001 a FE-015 | Concluída |
| Cadastros | FE-100 a FE-110 | Concluída |
| Estoque e compras | FE-200 a FE-211 | Concluída |
| Vendas | FE-300 a FE-309 | Concluída |
| Fiscal de vendas | FE-400 a FE-404 | Concluída |
| Logística | FE-500 a FE-505 | Concluída |
| Serviços | FE-600 a FE-606 | Concluída |
| Financeiro | FE-700 a FE-712 | Concluída |
| Relatórios e visão executiva | FE-800 a FE-805 | Concluída |
| Regressão global | FE-900 | Concluída |
| Paridade dos menus | FE-910 | Concluída |
| Produtividade da página inicial | FE-911 | Concluída |
| Eventos e central de trabalho | FE-912 | Concluída |
| Experiência opcional | FE-913 | Concluída como demonstração local |

As lacunas FE-910 a FE-913 foram identificadas pela auditoria autenticada da
página inicial do Bling e estão detalhadas em
[`docs/bling-ui-gap-analysis.md`](./bling-ui-gap-analysis.md).

## O que já foi implementado

- shell responsivo compartilhado, navegação por módulos, busca global e temas claro e escuro;
- empresa demonstrativa Ludus aplicada às superfícies de Preferências;
- Preferências com empresa, usuários, papéis, sistema, segurança, fiscal, financeiro, certificado digital, integrações, importação e exportação;
- nove cadastros fundamentais com listagem, criação, detalhe e edição;
- Estoque com saldos, lançamentos, depósitos, inventários e ordens de produção;
- Compras com pedidos, aprovação local, notas de entrada, sugestões e recebimentos;
- Vendas com pedidos, propostas, PDV, anúncios, loja virtual, importação, garantias e relatórios detalhados;
- Fiscal com NF-e, NFC-e, monitor de documentos, XML/DANFE demonstrativos, manifestações e guias detalhadas;
- Logística com postagens, reversa, checkout, etiquetas, cotações, contratação e acompanhamento demonstrativos;
- Serviços com criação contextual, detalhe, execução, conclusão, documentos, cobranças e relatórios próprios;
- Financeiro com formulários contextuais, baixas, estornos, conciliação, comissões, caixa, tributos e demais operações simuladas;
- Relatórios com período, agrupamento, comparação, detalhamento, exportação demonstrativa e estados completos;
- estados demonstrativos de carregamento, vazio, erro e acesso negado onde aplicável;
- navegação responsiva e acessível, foco por teclado e proteção contra descarte em formulários;
- menu superior reorganizado com acessos diretos para contas e categorias financeiras, importação de pedidos, documentos fiscais, faturamento agrupado, contador, Conta Digital, relatórios, Logística e Serviços;
- página inicial com favoritos editáveis, painel de importações, cartões clicáveis, períodos e gráficos configuráveis;
- dashboards especializados para vendas, margem, produtos, clientes, Curva ABC e metas;
- central de trabalho com eventos, notificações, ajuda, aplicativos e Conta Digital demonstrativa;
- experiência opcional com assistente local, novidades e informações de plano, sem transmissão ou integração real;
- 164 arquivos `page.tsx`, 230 páginas geradas no build e 41 testes Playwright aprovados em 46,4 segundos;
- CI principal simplificado com lint e build executados em paralelo.

## Próximas etapas fora do escopo atual do frontend

- persistência real, autenticação e autorização efetiva;
- integrações com APIs, n8n, canais de venda, serviços fiscais, bancos e transportadoras;
- regras transacionais, concorrência, idempotência e auditoria no backend;
- aplicativos Android e iOS;
- homologação e operação em produção.

## Rotas obrigatórias

### Cadastros

- `/cadastros`
- `/cadastros/produtos`
- `/cadastros/produtos/novo`
- `/cadastros/clientes-fornecedores`
- `/cadastros/vendedores`
- `/cadastros/funcionarios`
- `/cadastros/contas-financeiras`
- `/cadastros/categorias-financeiras`
- `/cadastros/formas-pagamento`
- `/cadastros/categorias-produtos`
- `/cadastros/listas-precos`

Cada cadastro acima possui agora o fluxo dedicado de frontend:

- `/cadastros/{cadastro}/novo`
- `/cadastros/{cadastro}/[id]`
- `/cadastros/{cadastro}/[id]/editar`

Isso cobre produto, cliente/fornecedor, vendedor, funcionário, conta financeira,
categoria financeira, forma de pagamento, categoria de produto e lista de preços.
As telas usam dados locais declarados como demonstração, restauração completa,
proteção contra descarte e navegação entre listagem, detalhe e edição.

### Estoque e compras

- `/estoque`
- `/estoque/saldos`
- `/estoque/lancamentos`
- `/estoque/inventarios`
- `/estoque/depositos`
- `/estoque/ordens-producao`
- `/compras`
- `/compras/pedidos`
- `/compras/pedidos/novo`
- `/compras/notas-entrada`
- `/compras/sugestoes`
- `/compras/recebimentos`

Os fluxos operacionais desta trilha também possuem telas próprias e navegáveis:

- pedidos de compra: criação, detalhe, edição, aprovação e rejeição simuladas;
- notas de entrada: detalhe fiscal e visualização segura do XML demonstrativo;
- recebimentos: conferência item a item e registro local de divergências;
- sugestões: detalhe e conversão local em rascunho de pedido;
- lançamentos de estoque: criação e detalhe do movimento;
- depósitos: criação, detalhe e edição;
- inventários: criação, detalhe e contagem física;
- ordens de produção: criação, detalhe e execução simulada.

As ações deixam explícito quando alteram somente o estado local. Nenhuma aprovação,
movimentação, entrada fiscal ou produção é enviada ao backend nesta fase.

### Vendas

- `/vendas`
- `/vendas/pedidos`
- `/vendas/pedidos/novo`
- `/vendas/propostas`
- `/vendas/pdv`
- `/vendas/anuncios`
- `/vendas/loja-virtual`
- `/vendas/importacao`
- `/vendas/relatorios`
- `/vendas/garantias`

### Fiscal

- `/fiscal`
- `/fiscal/notas-saida`
- `/fiscal/nfce`
- `/fiscal/monitor`
- `/fiscal/guias`

### Logística

- `/logistica`
- `/logistica/postagens`
- `/logistica/reversa`
- `/logistica/checkout`
- `/logistica/etiquetas`
- `/logistica/envios`

### Serviços

- `/servicos`
- `/servicos/contratos`
- `/servicos/ordens`
- `/servicos/cte`
- `/servicos/notas`
- `/servicos/cobrancas`
- `/servicos/relatorios`

Os fluxos usam formulários e painéis contextuais nas próprias páginas para criar,
consultar e executar operações demonstrativas sem persistência. Ações sensíveis
exigem confirmação antes da alteração local.

### Financeiro

- `/financeiro`
- `/financeiro/caixas-bancos`
- `/financeiro/contas-pagar`
- `/financeiro/contas-receber`
- `/financeiro/remessas-retornos`
- `/financeiro/ficha-financeira`
- `/financeiro/comissoes`
- `/financeiro/controle-caixa`
- `/financeiro/faturamento-agrupado`
- `/financeiro/tributos`
- `/financeiro/contador`
- `/financeiro/conta-digital`
- `/financeiro/relatorios`

As telas incluem operações contextuais de baixa, estorno, conciliação, comissão,
caixa e tributos. Nenhuma ação movimenta valores, transmite arquivos bancários ou
persiste dados fora da sessão demonstrativa.

### Relatórios e visão executiva

- `/relatorios`
- `/relatorios/vendas`
- `/relatorios/estoque`
- `/relatorios/financeiro`
- `/relatorios/servicos`
- `/relatorios/auditoria`

Os relatórios oferecem período, agrupamento, comparação, detalhamento, exportação
demonstrativa e estados de carregamento, vazio, erro e falta de permissão.

## Contrato mínimo de cada tela

1. Título, contexto da empresa ativa e rota identificável.
2. Dados simulados declarados sem sugerir persistência.
3. Busca, filtros e estados quando a tela representar uma coleção.
4. Ações destrutivas desabilitadas ou confirmadas.
5. Loading, vazio, erro e ausência de permissão proporcionais ao risco.
6. Layout sem overflow entre 320 e 1440 pixels.
7. Teclado, foco visível, rótulos e semântica apropriada.
8. Nenhum link para rota inexistente.

## Definição de pronto

A trilha termina quando todas as rotas acima existem, são navegáveis pelo shell ou por hubs de domínio, passam em lint, TypeScript, build e regressão Playwright. O CI principal executa lint e build em paralelo para permanecer abaixo de um minuto; a regressão Playwright completa é executada localmente antes da entrega de cada lote, sem alongar o caminho de publicação.

## Evidência de conclusão

- O build do Next.js gera todas as rotas estáticas e variantes dinâmicas conhecidas.
- O shell conecta os módulos principais e cada hub conecta suas telas internas.
- A regressão descobre automaticamente todos os arquivos `page.tsx` e verifica resposta sem `404`.
- Os templates representativos são verificados em 320, 375, 768, 1024 e 1440 pixels.
- A suíte cobre estados, foco, teclado, persistência do tema e paleta de comandos.
- A navegação móvel expõe todos os módulos e aciona a mesma busca global do desktop.
- As páginas representativas falham o teste quando emitem `pageerror` ou erro de console.
- Ações ainda sem backend informam explicitamente que nenhum arquivo, documento ou operação real foi produzido.
- Os nove cadastros fundamentais têm criação, detalhe e edição dedicados, verificados por navegação automatizada.
- Estoque e compras possuem criação, detalhe e operações locais dedicadas, verificadas por navegação automatizada.
- Vendas, Fiscal e Logística possuem fluxos detalhados e navegação automatizada entre listagens, criações e detalhes.
- Serviços, Financeiro e Relatórios possuem operações contextuais cobertas por testes de fluxo dedicados.
- A regressão completa passou com 41 testes e cinco workers em 46,4 segundos, sem falhas paralelas.
- O frontend contém 164 arquivos `page.tsx`; o build gerou 230 páginas e as rotas dinâmicas usam pré-renderização representativa com fallback para os demais identificadores.
- A auditoria Lighthouse da página inicial atingiu 100 em acessibilidade, boas práticas, SEO e navegação por agentes nos perfis desktop e mobile, sem achados.
- Preferências/Empresa, Vendas/Pedidos, Financeiro e Eventos foram auditados como amostra interna; os quatro eixos do Lighthouse permaneceram em 100 após a normalização dos estados verde e âmbar nos temas claro e escuro.
- Cadastros/Produtos, Estoque, Fiscal, Logística, Serviços e Relatórios também atingiram 100 nos quatro eixos do Lighthouse em desktop; Relatórios repetiu o resultado no perfil mobile.
