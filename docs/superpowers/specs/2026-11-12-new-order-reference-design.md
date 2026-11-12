# Novo pedido conforme referência LUDUS

## Intenção e referência aprovada

O usuário pediu que `/vendas/pedidos/novo` siga as imagens fornecidas nesta conversa, completando-as com capturas de cliente, endereço, entrega, pagamento, desconto e totais. A página deve permitir negociar e salvar o pedido com dados reais, integrada ao ERP existente.

## Composição

- Equipamentos ocupam toda a largura no início: busca por nome/SKU, seleção que acrescenta uma unidade, tabela com quantidade e valores, acabamentos e peso total.
- Desktop: coluna principal com Cliente e Forma de pagamento; coluna lateral de aproximadamente 360px com Desconto, totais e Salvar pedido. Em larguras menores, equipamentos, cliente/entrega, pagamento, desconto, totais e ação formam uma coluna sem transbordamento.
- Cliente: buscar cadastrado, alternar Empresa (CNPJ)/Pessoa física (CPF), documento, IE/ISENTO quando PJ, nome/razão social, fantasia, responsável, celular, e-mail e endereço completo. CEP completa campos vazios e IBGE, sem substituir edição manual.
- Entrega: UF de destino acompanha endereço até alteração explícita; contribuinte acompanha IE/ISENTO até alteração explícita; prazo de fabricação em dias úteis/corridos, frete assumido pela empresa e observações.
- Pagamento: entrada em R$/%, forma/data, saldo, quantidade de parcelas, primeiro prazo, intervalo, vencimentos/valores/formas editáveis e observações. Valores fecham em centavos.
- Desconto por percentual ou total desejado com IPI, alçada e indicação de liberação/aprovação, totais de tabela, desconto, líquido, IPI, total, entrada e saldo. Cálculo é o servidor comercial atual.
- Interface usa tokens/temas e componentes do ERP. Correspondência é de estrutura, densidade e comportamento; navegação e identidade Avila permanecem. Nenhum novo raster é necessário na referência vazia.

## Abordagem

Usar o motor e a orquestração do simulador atual com uma apresentação de pedido, evitando um segundo cálculo comercial. Reaproveitar checkout, consulta CNPJ/CEP e comandos idempotentes. Manter o formulário de catálogo existente em `?modo=catalogo` para os rascunhos e quantidades decimais atuais. O caminho padrão passa a exibir o modelo completo solicitado. A versão atual da tabela, suas permissões e políticas são a autoridade; não copiar os números de exemplo das imagens.

Cliente selecionado é carregado por ID e empresa e apresentado nos mesmos campos. Novo cliente ou alterações explícitas são validados e gravados apenas ao salvar o pedido, com comando idempotente separado e ETag para alterações. Se o cadastro já tiver sido confirmado e o pedido falhar, conservar o ID para repetir somente a criação do pedido; em resposta incerta bloquear edição e repetir exatamente o mesmo comando. Usuário sem gestão de cadastros pode usar cliente existente sem alterá-lo.

O contrato existente registra `manufacturingDays` e texto `deliveryNotes`. A unidade e a referência de início do prazo serão incluídas explicitamente nas observações da entrega, preservadas no pedido, PDF e e-mail. Não há cálculo automático de data de entrega ou mudança de schema nesta etapa.

## Restrições e aceite

- Preservar a entrega bcc2dc11 da PR #186 e concluir sua integração/publicação; novo layout terá revisão e commit próprios.
- Sem migrações, novas dependências, tabelas de preços/políticas alteradas ou operações reais como teste.
- Sem simulação stale: respostas antigas/empresa diferente descartadas, alterações invalidam digest, tabela vencida exige nova conferência e retry incerto mantém payload/chave.
- Parcela editada não pode ser substituída silenciosamente; nenhuma entrada prevista equivale a recebimento.
- Verificar vazio e preenchido em 390, 640 e desktop, claro/escuro, teclado, ausência de overflow, adição repetida, busca de cliente, cadastro novo, CEP/IBGE, erro/retry e criação com condições persistidas. Comparar capturas da página com as imagens e registrar QA visual.
