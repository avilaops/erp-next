# Frete, desconto e operações interestaduais na NF-e

O emitente continua limitado a SP, modelo 55, CRT 1 ou 3. O CRT 3 aceita
destinatários de outras UFs, com a classificação uniforme e as alíquotas
explicitamente declaradas pelo operador. Não se preenche tributação por NCM.

## Valores comerciais

`DraftItem.freightAmount` e `discountAmount` são valores monetários com duas
casas decimais. O desconto é incondicional e não pode superar o total bruto do
produto. O usuário declara a parcela de cada item; não há rateio implícito.
`DraftInput.freightMode` aceita 0, 1, 2, 3, 4 ou 9. Cobrar frete com modalidade
9 é recusado. Dados históricos sem esses campos mantêm frete/desconto zero e
modalidade 9, sem regravação automática.

Preço unitário, `grossTotal` e `productsTotal` continuam brutos. O XML escreve
`vFrete` e `vDesc` nos produtos e nos totais. A base comercial por item é o
produto mais frete menos desconto. Essa base alimenta IPI, ICMS e contribuições
no recorte existente. As opções declaradas de inclusão do IPI e exclusão do
ICMS continuam aplicadas. O total da nota é a soma comercial mais o IPI,
arredondado por item, e precisa corresponder aos pagamentos declarados.

O snapshot IBPT acompanha a mesma base comercial com IPI. Alterar valores
invalida um snapshot anterior. O valor aproximado não altera os tributos da
operação. O vínculo ao pedido preserva a validação do preço e total bruto da
venda, sem alterar recebimentos ou faturamento como efeito do rascunho.

## ICMS interestadual

Operações tributadas exigem ICMS interestadual declarado de 4%, 7% ou 12%.
O gerador mantém a verificação de compatibilidade da origem e das UFs.
Para destinatário contribuinte, a IE continua obrigatória.

Venda interestadual a consumidor final não contribuinte exige CST 00 e os
campos `destinationIcmsRate` e `destinationFcpRate`, em percentuais com quatro
casas, inclusive zero para FCP inexistente. A alíquota interna do destino não
pode ser inferior à interestadual nesse recorte. O XML inclui o grupo
`ICMSUFDest`, DIFAL/FCP por item e totais; esses impostos são excluídos da base
de IBS/CBS já tratada pelo gerador. Em operação sem DIFAL, os campos do destino
ficam ausentes ou zerados.

Permanecem fora do recorte: ICMS-ST, bases reduzidas, diferimento, tributação
heterogênea por item e outros CST/classificações IBS/CBS além dos já aceitos.
Este incremento não declara cobertura de todas as operações fiscais.

## Verificação

Testes sintéticos cobrem arredondamento em centavos, pagamento divergente,
desconto excessivo, frete sem transporte, destinatário contribuinte e não
contribuinte, exigência das alíquotas e XML assinado validado pelo pacote XSD
versionado. Isso não comprova autorização externa nem emite notas reais.

Referência de leiaute: [MOC 7.0, Anexo I, grupos I, NA e W](https://www.confaz.fazenda.gov.br/legislacao/arquivo-manuais/moc7-anexo-i-leiaute-e-rv.pdf).
