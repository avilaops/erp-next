# Parâmetros comerciais por linha

O módulo mantém políticas independentes para as linhas Importada e Nacional.
O gestor cadastra meta de lucro, desconto livre, segurança, entrada mínima,
validade da proposta, tributos, custos do canal, taxa fixa, provisões e as
alíquotas das 27 UFs. Percentuais são salvos em pontos-base e dinheiro em
centavos. Nenhum valor fiscal ou comercial é preenchido automaticamente.

`GET` e `PUT /api/v1/commercial-settings/{line}` consultam e salvam com `ETag`/
`If-Match`; `POST /api/v1/commercial-settings/{line}/preview` simula sem gravar.
O acesso exige `platform.company.manage`. A tabela `commercial_settings` tem
RLS por empresa; auditoria registra linha e revisões, sem margens nem alíquotas.
O BFF preserva sessão, origem e empresa. A página é `/preferencias/comercial`.

O resultado calcula o pior destino, taxas variáveis, multiplicador de custo e
faturamento de equilíbrio. A despesa mensal é a soma das despesas fixas ativas
e vigentes na data de São Paulo. O gestor mantém esses registros em
`/preferencias/despesas-fixas`, com categoria financeira de despesa, valor mensal,
vigência e situação. O campo nos parâmetros é somente leitura; o servidor
recalcula a soma ao consultar, simular, salvar e preparar a tabela.

Cada produto ativo pode ter linha comercial, custo de compra ou assessoria,
crédito tributário e embalagem em `/cadastros/produtos/{id}/custos`. Esses dados
são privados da gestão e versionados por `ETag`/`If-Match`. A prévia em
`/preferencias/tabela-precos` exige parâmetros salvos e pelo menos um produto
ativo com custo na linha. O servidor calcula preços inteiros em centavos,
registra um resumo criptográfico dos dados de entrada e exige sua confirmação
para publicar. A publicação grava versão e itens imutáveis, atualizando apenas
o ponteiro da versão ativa da linha. Custos, política e preços calculados ficam
no histórico da versão para auditoria. A taxa fixa por pedido não é multiplicada
por produto.

Salvar parâmetros ou custos não altera preços de produto, propostas ou pedidos
existentes. Publicar a tabela também preserva esses registros; a adoção da
versão por um novo pedido exige fluxo próprio. A fórmula é gerencial, não
apuração fiscal. Não há geração de contas a pagar pelas despesas fixas.

Verificação de compilação e testes ocorre na CI do GitHub. O fluxo de migração
aplica as três novas tabelas e os grants do papel de aplicação. Merge de código
não comprova migração aplicada ou validação autenticada em produção.
