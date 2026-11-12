# Preferências do sistema

## Escopo entregue

- Tema: preferência somente deste navegador, aplicada imediatamente pelo controle existente.
- Produtos por página: preferência pessoal por usuário autenticado e empresa ativa,
  persistida no PostgreSQL e consumida pelo catálogo de produtos (10, 25, 50 ou 100).
- Idioma, formatos, fuso e notificações não possuem opções de gravação nesta entrega.
  A tela informa sua indisponibilidade, sem simular alterações ou envio de avisos.

Outras listagens não são alteradas pelo tamanho de página do catálogo.
Não há configuração tributária ou empresarial implícita nas preferências pessoais.

## Contrato e segurança

`GET/PUT /api/erp/preferences` encaminha a sessão para
`GET/PUT /api/v1/preferences`. A identidade vem do Auth; não é aceita no corpo.
Um vínculo ativo é obrigatório, mas a pessoa não precisa administrar a empresa
para alterar a própria preferência. A tabela usa chave de empresa e identidade,
com RLS para ambas. O usuário de runtime recebe somente SELECT, INSERT e UPDATE.

O GET é somente leitura: sem registro salvo, retorna 25 itens e revisão virtual 1.
O PUT exige If-Match; a primeira gravação cria a revisão 2. Escritas usam o mesmo
bloqueio de empresa da gestão de acessos, revalidam o vínculo e gravam auditoria
na mesma transação. Revisão desatualizada retorna 412, sem sobrescrever a escolha.
Campos desconhecidos e tamanhos não suportados retornam 422.

A interface preserva a seleção recusada e exige recarga após confirmação ambígua
ou conflito. Não anuncia sucesso sem confirmar empresa, revisão e valor salvo.
Se a preferência não puder ser consultada, o catálogo informa a falha e usa
25 itens como padrão, sem modificar o registro persistido.

## Publicação

Aplicar `202610310001_personal_preferences.sql` pelo workflow de migração com
`schema_only=true`, usando a release aprovada. A etapa correspondente concede
o acesso do papel existente. A migração é aditiva e não altera dados de produtos,
estoque, financeiro, certificados ou configurações fiscais.
