# Auditoria de navegação e lacunas em relação ao Bling

## Escopo da inspeção

Auditoria visual e estrutural realizada em 25 de outubro de 2026 na página
autenticada `https://www.bling.com.br/inicio#/`. Foram abertos todos os menus
principais e as abas da página inicial. Os destinos foram comparados com as
rotas e componentes existentes no frontend do ERP Next.

Esta auditoria registra os controles observados na navegação e na página
inicial. Ela não afirma que todas as telas internas do Bling foram percorridas.

## Barra superior

### Menus principais

- Meu Negócio
- Cadastros
- Vendas
- Estoque
- Financeiro

### Controles globais

- logotipo com retorno ao início;
- campo de pesquisa global;
- botão do Assistente Bling;
- Central de Extensões;
- notificações;
- ajuda;
- preferências;
- menu de mais opções.

## Menu Meu Negócio

Grupo **Dashboards**:

- Dashboard geral;
- Dashboard vendas;
- Dashboard margem por pedido;
- Dashboard produtos;
- Dashboard clientes;
- Curva ABC;
- Metas.

## Menu Cadastros

Grupo **Cadastros**:

- Produtos;
- Clientes e fornecedores;
- Vendedores;
- Funcionários;
- Contas Financeiras;
- Categorias Financeiras;
- Formas de pagamento.

Grupo **Ferramentas**:

- Categorias de produtos;
- Listas de preços;
- Ver relatórios de cadastros.

## Menu Vendas

Grupo **Gestão**:

- Gestão de anúncios;
- Loja Virtual;
- Pedidos de venda;
- Notas fiscais de saída;
- NFC-e;
- Frente de caixa;
- Importar pedidos manualmente;
- Propostas comerciais;
- Relatório avançado de vendas.

Grupo **Logística**:

- Objetos de postagem;
- Logística reversa;
- Checkout de pedidos;
- Impressão automática de etiquetas;
- Bling Envios.

Grupo **Serviços**:

- Contratos;
- Ordens de serviço;
- CT-e;
- Notas de serviço;
- Cobranças;
- Relatórios de serviço;
- Ver relatórios de vendas.

## Menu Estoque

Grupo **Compras**:

- Pedidos de compra;
- Notas fiscais de entrada;
- Fornecedores;
- Sugestão de Compras;
- Check-in de Recebimentos.

Grupo **Estoque**:

- Lançamentos de estoque;
- Conferência de estoque;
- Ordens de produção;
- Depósitos;
- Multiempresa;
- Ver relatórios de compras e estoque.

## Menu Financeiro

Grupo **Gestão financeira**:

- Caixas e bancos;
- Contas a pagar;
- Contas a receber;
- Remessas e retornos;
- Ficha Financeira;
- Comissões;
- Controle de caixa;
- Faturamento agrupado.

Grupo **Tributos e contabilidade**:

- DAS MEI;
- GNRE e DARE-SP;
- Espaço meu contador.

Grupo **Soluções financeiras**:

- Bling Conta Digital;
- Ver relatórios financeiros.

## Página inicial

### Perfil e produtividade

- acesso ao perfil da empresa;
- indicador de importações de pedidos em marketplaces;
- botão Gerenciar;
- área de atalhos favoritos;
- botão para adicionar favorito;
- atalhos para pedidos de venda, pedidos de compra, clientes e fornecedores,
  notas fiscais, produtos, contas a receber e contas a pagar;
- ações de organização e opções em cada favorito.

### Banners e novidades

- carrossel de banners;
- seletores de slides;
- canal de novidades no WhatsApp;
- campanhas, serviços e integrações;
- link para versões do produto;
- carrossel de novidades.

### Abas da home

- Visão geral;
- Eventos;
- Conta Digital.

### Visão geral

- atualização manual e horário da última atualização;
- controle para ocultar ou exibir valores;
- cartões de pedidos de venda, contas a receber, contas a pagar e notas fiscais;
- seção de gráficos;
- períodos 7D, 30D, 3M, 6M, 12M e personalizado;
- botão para adicionar gráfico;
- menu de opções por gráfico;
- Ticket Médio;
- Valor Faturado;
- Quantidade de pedidos de venda;
- Top 5 SKUs mais vendidos.

### Eventos fiscais e tributários

- abas Não lidos, Urgentes e Lidos;
- contador de eventos;
- agrupamento por data;
- ações Ajuda e Marcar como lido;
- órgão, prazo, categoria e descrição do evento.

### Conta Digital

- apresentação da conta digital;
- botão Explorar o Internet Banking.

### Assistente Bling

- Nova conversa;
- Novidades;
- Ocultar assistente;
- aceite dos termos de uso;
- Começar a utilizar o Assistente;
- menu de anexos e feedback;
- Enviar.

## Cobertura atual do ERP Next

### Coberto

- módulos e fluxos de Cadastros, Vendas, Estoque, Compras, Financeiro, Fiscal,
  Logística, Serviços e Relatórios;
- visão geral com indicadores, módulos e atividade recente;
- pesquisa global;
- preferências, usuários e empresa;
- navegação desktop e móvel;
- temas claro e escuro;
- estados demonstrativos e avisos de ausência de backend.

### Existe, mas não está exposto corretamente no menu superior

- Contas financeiras;
- Categorias financeiras;
- Importação manual de pedidos;
- Notas fiscais de saída e NFC-e;
- Notas fiscais de entrada;
- relatórios de cadastros, vendas, estoque, compras, serviços e financeiro;
- Faturamento agrupado;
- Espaço do contador;
- Conta digital;
- GNRE e DARE-SP;
- operações detalhadas de Logística e Serviços, hoje concentradas no menu Mais.

## Estado da implementação

As quatro prioridades abaixo foram concluídas no frontend em 25 de outubro de
2026. Todas as operações que dependem de backend permanecem locais,
demonstrativas e identificadas como tal.

## Backlog concluído

### Prioridade 1 — paridade de navegação

1. Reorganizar os menus superiores para expor todos os destinos já existentes.
2. Adicionar Meu Negócio com acesso aos dashboards.
3. Incluir Contas Financeiras e Categorias Financeiras em Cadastros.
4. Incluir documentos fiscais, importação, logística e serviços nas colunas de Vendas.
5. Incluir Notas de entrada, Fornecedores e relatórios em Estoque e Compras.
6. Incluir Faturamento agrupado, Tributos, Contador e Conta digital em Financeiro.

### Prioridade 2 — produtividade da página inicial

1. Criar favoritos editáveis e ordenáveis.
2. Criar painel de importações de marketplaces.
3. Implementar abas Visão geral, Eventos e Conta Digital.
4. Criar cartões clicáveis para vendas, recebíveis, pagamentos e notas.
5. Criar gráficos configuráveis com períodos e comparação.
6. Criar dashboards de vendas, margem, produtos, clientes, Curva ABC e metas.

### Prioridade 3 — eventos e central de trabalho

1. Criar feed de eventos fiscais com Não lidos, Urgentes e Lidos.
2. Adicionar ações demonstrativas de Ajuda e Marcar como lido.
3. Criar central de notificações e indicador de pendências.
4. Criar central de ajuda contextual.
5. Criar central de aplicativos e extensões.

### Prioridade 4 — itens opcionais

1. Assistente do ERP com conversa, histórico e anexos.
2. Banners administrativos e central de novidades.
3. Informações de versão e notas de atualização.
4. Indicador de plano, limites e recursos bloqueados.

## Decisão de escopo

Os itens das prioridades 1 a 3 integram o frontend do ERP. Os itens da prioridade
4 foram implementados como experiência opcional local, sem reproduzir campanhas
externas nem afirmar capacidades de inteligência artificial inexistentes.

Integrações reais, eventos oficiais, notificações persistidas, marketplace,
internet banking e inteligência artificial dependem de backend e autorização.
Até essa etapa, as telas devem continuar usando dados locais claramente
identificados como demonstração.
