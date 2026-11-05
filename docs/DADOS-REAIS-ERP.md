# Dados reais e dashboard responsivo

Pedido do usuário em 05/11/2026: corrigir os cartões comprimidos na visão geral
e remover os dados demonstrativos das telas operacionais.

## Fontes

`GET /api/v1/dashboard?period=7D|30D|3M|6M|12M` consulta somente a empresa ativa,
com RLS e a permissão de leitura de cada domínio. Dados sem permissão são `null`,
nunca zero. Falha de consulta não recebe valores substitutos.

- Pedidos: data de criação em America/Sao_Paulo, excluindo cancelados dos valores
  e do ticket; cancelados têm contagem separada. Inclui rascunhos. Não representa
  faturamento, recebimento, lucro ou conversão de oportunidades.
- Série: agregação mensal dos pedidos não cancelados dentro do período; meses
  sem registros não geram barras ou projeções fictícias.
- Recebíveis: saldo atual dos títulos não cancelados, considerando pagamentos
  parciais e estornos. Não é saldo bancário.
- Pagáveis: saldo atual dos títulos de compras, considerando pagamentos e
  estornos; não inclui folha e outras obrigações.
- Produtos e clientes: contagem dos cadastros ativos atuais, independente do
  período dos pedidos.
- Atividade: API de auditoria existente, com sua permissão própria; mostra os
  cinco eventos mais recentes sem detalhes confidenciais.

Metas ainda não possuem cadastro no backend. Margem por pedido e curva ABC não
possuem base suficiente neste painel. Essas páginas informam a indisponibilidade
e oferecem consulta dos registros reais, sem métricas, gráficos ou exportações
simuladas. A seleção antiga de faturamento aponta para os documentos fiscais,
sem confundir valores de pedidos com receita fiscal.

## Prévia e operações

As rotas catalogadas em `demonstration-routes.ts` deixam de montar os componentes
legados com dados de exemplo. Diretórios preservam acesso aos módulos reais;
funcionalidades sem implementação mostram estado indisponível. Rotas
operacionais, autenticação, filtros e dados da empresa são preservados.
As telas de dashboard agora saem dessa lista, pois consultam o endpoint real.
Dados sintéticos continuam restritos aos testes e imagens editoriais de entrada;
dicas de preenchimento nos inputs são mantidas.

## Layout e validação

O grid dos módulos se adapta à largura disponível; o painel de atividade só
divide a linha quando essa largura comporta ambos. O painel não estica até a
altura dos cartões. Testes cobrem 390, 907, 1280 e 1600 px, ausência de conteúdo
inventado, erro de consulta, autorização, empresa, período, parcelas e estornos.

Implementação isolada em `fix/dashboard-real-data`. O checkout original possui
74 pendências e quatro conflitos de merge e permanece preservado. Publicação e
validação autenticada são etapas separadas dos testes com fixtures.
