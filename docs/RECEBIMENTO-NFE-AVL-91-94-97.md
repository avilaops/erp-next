# Recebimento e conciliação de NF-e — AVL-91, AVL-94 e AVL-97

Complemento do monitor canônico e da conversão fiscal existentes.
Em 04/11/2026, o escopo autorizado é resolver e integrar os PRs, sem deploy.
A publicação fica para uma etapa posterior, junto às demais alterações locais.
O aceite externo fiscal continua separado da integração e do deploy da aplicação.

## Distribuição e manifestação

O monitor preserva XMLs, cursor e auditoria na mesma transação. Eventos completos
`procEventoNFe` podem reconciliar uma manifestação com resultado incerto quando
ambiente, autor, chave, tipo, sequência e protocolo correspondem. O resultado
registrado não é reenviado. Uma resposta atrasada da transmissão não pode
substituir a evidência já reconciliada.

Cancelamento com registro aceito é indexado pela chave, preservando o XML original.
Cancelamento/denegação conhecidos bloqueiam novas manifestações e a utilização
operacional da NF-e de produção. A mesma chave em homologação não herda esse
estado. Estoque, obrigações e recebimentos anteriores permanecem no histórico;
seus estornos dependem dos comandos explícitos já existentes em Compras.

Manifestação pode partir de resumo autorizado ou NF-e completa distribuída para
a empresa. Ciência após manifestação conclusiva é recusada, inclusive quando a
conclusão foi enviada por outro sistema e conhecida pela distribuição. Outra
manifestação não pode ser transmitida enquanto existir resultado local incerto.

## Conciliação com compra existente

Na nota recebida, **Conciliar com compra existente** permite escolher uma compra
confirmada e mapear todos os itens fiscais a produtos existentes. Não cadastra
produtos nem fornecedores automaticamente.

| Comando | Efeito |
| --- | --- |
| `POST /api/v1/fiscal/received-nfes/{id}/purchase/preview` | Prévia sem gravação, com revisão da compra, diferenças e componentes de custo |
| `POST /api/v1/fiscal/received-nfes/{id}/purchase/match` | Vínculo documental transacional, revisão, chave idempotente e auditoria |
| `POST /api/v1/purchase-orders/{id}/receipts` | Recebimento físico explícito; estoque e obrigação financeira na mesma transação |

O mapeamento informa `purchaseOrderId`, `purchaseRevision` e
`items: [{ itemNumber, productId }]`. O vínculo exige `If-Match` da nota e
`Idempotency-Key`; a revisão da compra é conferida novamente durante a gravação.
As permissões fiscais e de compras são exigidas inclusive na repetição.

Fornecedor incorreto, produto fora da compra/inativo, unidade incompatível,
quantidade acima do saldo e custo unitário diferente impedem a confirmação.
O custo posto inclui os componentes declarados no XML conforme o cálculo já
existente. A prévia mostra diferenças de NCM sem alterar o produto nem presumir
crédito tributário.

Uma nota pode cobrir parte da quantidade comprada. Os recebimentos físicos
podem ser parciais, mas a soma não pode exceder a quantidade da NF-e vinculada.
Produtos adicionais da compra que não constam da nota não podem ser recebidos
nesse vínculo. A diferença restante pode ser encerrada explicitamente pelo
comando de fechamento parcial existente.

## Limites deste pacote

- Mantém uma NF-e por compra e recusa vínculo com compras que já tiveram
  recebimentos. Múltiplas notas por pedido exigem um livro de alocação próprio.
- Mantém uma solicitação local por tipo de manifestação, com sequência 1.
  Segunda ocorrência conclusiva não fica habilitada nesta entrega.
- Resumos de evento ou retornos sem correlação/protocolo suficientes são
  preservados sem serem tratados como prova de registro.
- O estado fiscal é o conhecido pelo ERP. Ausência de cancelamento armazenado
  não equivale a uma consulta atual de situação na SEFAZ.
- Não executa recebimento, pagamento, manifestação ou consulta fiscal por
  inferência a partir da importação ou do vínculo documental.

## Referências e aceite externo

Referências oficiais consultadas: [NT 2014.002 v1.21, distribuição de DF-e](https://www.nfe.fazenda.gov.br/Portal/exibirArquivo.aspx?AspxAutoDetectCookieSupport=1&conteudo=FM%2BKdU7EQrQ%3D)
e [NT 2020.001 v1.60, manifestação do destinatário](https://www.nfe.fazenda.gov.br/Portal/exibirArquivo.aspx?AspxAutoDetectCookieSupport=1&conteudo=%2BWTd7iuD21s%3D).
A consulta indexada confirmou as versões; a abertura direta dos PDFs pelo
navegador de pesquisa encontrou redirecionamento em ciclo. Esta limitação não
é evidência de validação integral dos documentos ou de homologação externa.

O aceite dos tickets deve registrar separadamente implementação, testes,
publicação e execução real. Consulta com certificado, persistência do lote real,
manifestação de NF-e/evento indicados pelo operador e operação autenticada
continuam como aceites externos; não são substituídos por fixtures sintéticas.

## Verificação

Resultados finais serão registrados após a conclusão das verificações deste
pacote. Os testes usam banco isolado e serviços fiscais sintéticos.
