# Configurações financeiras

`/preferencias/financeiro` reutiliza contas, categorias e formas de pagamento existentes. Os totais e as permissões vêm das APIs originais. A edição utiliza os formulários, revisões e auditoria desses cadastros, sem duplicação de tabelas.

`GET/PUT /api/v1/financial-settings` armazena por empresa o meio sugerido nas baixas manuais: transferência, dinheiro, cartão ou outro. A consulta aceita leitura da empresa ou leitura de contas a pagar/receber; a gravação exige gestão da empresa e `If-Match`. Sem registro, transferência e revisão virtual 1 são retornadas sem escrita. A primeira gravação cria revisão 2. RLS, bloqueio da empresa, vínculo ativo e auditoria na mesma transação protegem a configuração.

Os formulários de baixa de contas a pagar e a receber usam a sugestão inicial. Uma escolha manual não é substituída por respostas posteriores. Durante a consulta, a confirmação fica bloqueada; em falha, aparece aviso e transferência é o valor inicial. Configurar não cria baixa nem altera pagamentos anteriores. A configuração é somente de preenchimento, e não uma regra contábil ou uma integração bancária.

Formas de pagamento cadastradas e prazos de referência ainda não são vinculados automaticamente às baixas. Não existem configurações operacionais de parcelamento, centros de custos ou comissões nesta tela. Nenhum total ou indicador simulado é exibido.

Migração aditiva: `202610310005_financial_settings.sql`; a publicação aplica a migração e concede SELECT/INSERT/UPDATE ao papel da aplicação antes de subir a nova API.
