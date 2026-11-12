# QA visual — novo pedido

final result: passed

## Referência e evidências

Fonte visual: imagens do usuário em `C:/Users/nicol/AppData/Local/Temp/`, prefixo `codex-clipboard-`: `XPKR1K.png` (1525×966), `DRXB2C.png` (1526×962), `Mwb9Gc.png` (1854×1011), `mV2zt5.png` (649×909), `8NL3QK.png` (650×826) e `dipxnI.png` (647×787).

Implementação: `/vendas/pedidos/novo`, build de produção local, Chrome/Playwright, fixtures sintéticas, escala de dispositivo 1. Capturas em `artifacts/new-order-visual-review/test-results/` e `artifacts/new-order-same-width/test-results/`. Vazio em 390/640/1440px claro e 649/1525/1854px escuro; preenchido em 390/640/1440px escuro. Viewport com altura de 1000 CSS px; screenshots fullPage preservam pixels CSS (ex.: 1854×2409 e 649×3178).

Comparações conjuntas inspecionadas: `artifacts/new-order-comparison-desktop.png`, `artifacts/new-order-comparison-payment.png` e `artifacts/new-order-comparison-narrow.png`. As duas primeiras recortam conteúdo de 1264/1280px e pagamento de 888/904px, sem redimensionamento; a última compara conteúdo escuro vazio na mesma largura de 649px. Referências são capturas parciais com rolagem e browser/taskbar; implementação inclui navegação ERP. Esses elementos externos foram excluídos dos recortes. Não se afirma equivalência pixel a pixel de canvas ou de posição de rolagem.

## Resultado por superfície

- **Layout e ritmo:** equipamentos em toda a largura; cliente/endereço/entrega e pagamento à esquerda; desconto/totais/salvar em lateral de 360px no desktop. Cartões separados por 16px, campos com agrupamento equivalente à referência. CEP/endereço e número/complemento em 1:2; bairro/cidade/UF em três colunas. Pagamento com entrada/percentual/forma, data abaixo e configuração do saldo em linha. Abaixo do breakpoint, seções seguem em coluna; em 390px os campos também empilham. Tabela preenchida tem rolagem interna, sem ampliar o documento.
- **Fontes e tipografia:** família e escala 18/14/12 do ERP preservadas deliberadamente, conforme spec. Títulos em caixa alta e peso forte mantêm hierarquia; a fonte condensada LUDUS não substitui a identidade Avila. Campos e textos de ajuda continuam legíveis e não colidem. Conteúdo e controles adicionais do ERP aumentam a altura em relação ao protótipo.
- **Cores e tokens:** superfícies, bordas, inputs, foco e ações usam temas existentes do ERP. Tema escuro neutro substitui o verde escuro LUDUS; tema claro também verificado. Status de falta de equipamento/aprovação em âmbar, liberação em verde e limite de alçada na barra com contraste entre faixas. Valores reais da política prevalecem sobre exemplos do mockup.
- **Imagens e ícones:** referência vazia não requer imagem de produto; não foram criados rasters ou marcas substitutas. Marca/navegação Avila existentes preservadas. Busca e quantidade usam biblioteca de ícones já instalada; nenhum desenho artesanal substitui logo ou produto.
- **Texto e conteúdo:** seções e campos solicitados presentes. Instruções refletem persistência real, prazo de fabricação e recebimento previsto. Formas de pagamento, IPI e alçadas vêm do contrato atual. Campos obrigatórios têm indicação; salvar permanece desabilitado sem itens e condições válidas. Não há textos de implementação no fluxo.

## Histórico de ajustes

1. **P2 — endereço/pagamento sem proporções da referência:** corrigidas grades de endereço, entrada e parcelas; prazo/unidade ao lado do frete. Eliminados padding duplicado e densidade excessiva do cartão vazio. Evidência posterior: capturas finais vazias desktop/649px e comparação focada de pagamento.
2. **P2 — tabela preenchida ampliava documento em 390px:** labels acessíveis posicionados absolutamente escapavam do contêiner. Adicionado `position: relative` em `.order-equipment-scroll`, mantendo tabela e labels na área rolável. Antes: documento 737px para viewport 390px (`artifacts/new-order-overflow-diagnosis.json`). Depois: assert de largura aprovado em 390/640px preenchidos e capturas finais correspondentes. Todos os 10 casos então existentes da tela passaram na build corrigida.
3. **Comportamento — retorno cadastral atrasado/retry incerto/valores equivalentes:** revisão independente e casos RED→GREEN confirmam preservação de endereço, chave/payload, cliente já salvo e totais quando `2→02` não muda a negociação. Respostas de outra empresa não confirmam pedido. Nenhuma gravação real usada como teste.

## Verificação e checklist

- [x] Fonte e implementação abertas, comparações conjuntas e regiões de endereço/pagamento inspecionadas.
- [x] Estrutura vazia, formulário preenchido, quantidade repetida, CEP/IBGE, cliente existente sem escrita e cliente novo verificados com fixtures.
- [x] Parcela editada, soma em centavos, consulta de preço e confirmação incerta/retry verificados no navegador.
- [x] Sem overflow do documento em 390/640px; equipamentos preservam rolagem horizontal interna.
- [x] Revisão independente e correções dos achados materiais concluídas.

Sem achados P0/P1/P2 residuais. Diferenças de marca, paleta, família tipográfica, navegação e controles exigidos pelo ERP são adaptações explícitas da spec. Limite: esta revisão visual não inclui envio de e-mail, criação de pedido real ou transmissão fiscal. O épico AVL-432 permanece mais amplo que esta tela.

Follow-up P3: nenhum ajuste necessário para aceite desta entrega.

## Conferência após integrar main

Build integrada com main8d71dc9 concluída (TypeScript e369páginas). Capturas finais em `artifacts/new-order-integrated/test-results/`; comparações conjuntas reabertas em `artifacts/new-order-comparison-payment-final.png` (viewport1854px em ambos) e `artifacts/new-order-comparison-narrow-final.png` (649px em ambos), com os mesmos resultados de layout. Os seis estados vazios passaram com assert de ausência de console.error e pageerror. Os seis cenários preenchidos/normalização também passaram na build integrada. Lint completo:0erros,8avisos preexistentes. Modelos:113/113. Sem novos achados P0/P1/P2.
