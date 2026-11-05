# AVL-432 — paridade funcional Ludus

Fonte de aceite: AVL-432 e as 22 capturas em Downloads/Ludus-erp.
Base inicial: main 35c824c. Trabalho isolado para preservar o checkout original.

## Execução

- [x] Ler as 22 imagens e consultar a issue e a implementação atual.
- [x] Conferir as fórmulas de venda, custo, entrada e aprovação no ERP Ludus.
- [x] Disponibilizar consulta comercial da tabela publicada sem dados privados.
- [x] Implementar simulação exata, composição e visão gerencial autorizada.
- [x] Integrar conversão em pedido, snapshot, revisão e idempotência.
- [x] Persistir política de aprovação e validar decisões e confirmação.
- [x] Completar sugestão de entrada e ação explícita nos parâmetros.
- [ ] Integrar regras fiscais por linha aos cadastros e rascunhos existentes.
- [ ] Conferir emitente, ambiente e numeração sem mudar dados de produção.
- [ ] Completar indicadores de pedidos e comissões.
- [ ] Implementar oportunidades anteriores ao cadastro definitivo do cliente.
- [ ] Mapear os 21 acessos da central de cadastros.
- [ ] Validar API, isolamento, autorização, desktop e celular.
- [ ] Publicar PR, conferir CI e implantar o artefato aprovado.
- [ ] Conferir comportamento autenticado e registrar evidências no Linear.

## Contrato de cálculo

Referência de origem: avilaops/erp-ludus, src/lib/pricing/{order,payment,product,results,taxes}.ts.
Dinheiro no ERP Next usa centavos; percentuais usam pontos-base. O novo cálculo
mantém racionais inteiros até o arredondamento final de cada valor monetário.
Entrada comercial configurada e entrada necessária calculada são conceitos
separados. Frete e taxa fixa são descontados uma vez por pedido. Publicações
e parâmetros novos não recalculam negociações anteriores.

O preço líquido unitário é arredondado em centavos antes de multiplicar a
quantidade, como exige a restrição do pedido no banco. O IPI unitário segue o
mesmo contrato. Desconto em reais ou total desejado pode ser normalizado para
essa precisão; o resultado efetivo sempre é mostrado antes da conversão. A
preparação fiscal usa a composição sem IPI preservada, impedindo tributação
duplicada. Divergência entre arredondamento fiscal por item e o acordo por
unidade impede salvar a nota e exige revisão explícita da negociação.

Validação local: cargo check --tests passou na primeira base do simulador;
compilação do executável de testes interrompida após constatar cerca de 31 MB
de RAM livre. Testes completos e contrato final serão conferidos na CI.

Custos, margens e alçadas são decididos no servidor. As imagens não autorizam
importar percentuais, substituir configuração real, emitir notas, solicitar
assinaturas, enviar comunicações ou ativar tarefas recorrentes.
