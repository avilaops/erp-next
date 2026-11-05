# Parâmetros comerciais por linha

Esta etapa acrescenta rascunhos independentes para as linhas Importada e Nacional.
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
faturamento de equilíbrio. A despesa mensal desta etapa ainda é informada no
rascunho. A integração com `fixed_expenses` e a publicação versionada da tabela
de preços permanecem como trabalho seguinte; salvar não altera preços de produto,
propostas ou pedidos existentes. A fórmula é gerencial, não apuração fiscal.

Verificação de compilação e testes deve ocorrer na CI do GitHub, conforme pedido
do usuário. A migração em produção requer o fluxo separado de migrações e o grant
do papel de aplicação; um merge de código não prova que o esquema foi aplicado.
