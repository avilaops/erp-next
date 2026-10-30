# Cores dos equipamentos

Em **Cadastros → Produtos → Editar produto**, preencha as cores da estrutura
e do estofado, uma por linha. Cada acabamento aceita até 32 nomes de até
60 caracteres. Uma lista vazia significa que aquele acabamento não tem
opções configuradas; não se presume uma paleta para os produtos existentes.

Ao criar ou editar um rascunho em **Vendas → Pedidos de venda**, selecione
uma cor por acabamento em cada item que tenha opções. A escolha vale para
a quantidade daquele item. A estrutura atual mantém um item por produto
no pedido; não há divisão do mesmo produto em vários acabamentos.

O pedido grava as cores escolhidas e conserva os preços da venda. Retirar
uma cor do cadastro não altera os pedidos anteriores nem impede manter a
escolha registrada ao editar um rascunho. Novas escolhas precisam estar na
lista atual do produto. Pedidos confirmados não permitem editar acabamentos.

Os contratos novos incluem as cores registradas no pedido em seu snapshot
e no preenchimento automático do campo `itens`, quando o modelo o utiliza.
Contratos anteriores e pedidos sem cores mantêm a representação anterior.

A seleção de acabamento não cria SKU, reserva adicional, acréscimo de preço
ou saldo separado por cor. O estoque continua controlado por produto.
As permissões existentes de produtos e pedidos continuam sendo aplicadas
pela API Rust, dentro da empresa ativa.

Na API de produtos, `structureColors` e `upholsteryColors` são opcionais no
pedido de escrita. Omitir uma lista em uma atualização preserva a existente;
enviar `[]` remove as opções daquele acabamento. Nas linhas do pedido,
`structureColor` e `upholsteryColor` registram a escolha. Omitir uma escolha
ao atualizar um item existente preserva a cor já registrada.

A migração `202610300001_equipment_colors.sql` acrescenta somente colunas
com valores padrão ou anuláveis. Não altera registros comerciais existentes.
