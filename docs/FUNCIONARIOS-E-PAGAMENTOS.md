# Funcionários e pagamentos

Cadastro em `/cadastros/funcionarios`: dados operacionais, documentos, endereço,
contato de emergência e foto JPEG/PNG/WebP de até 200 KB. Um registro pode ser
funcionário e vendedor. O cadastro não cria login; contas permanecem em Usuários.
Atualizações de clientes antigos que omitam `profile` preservam os dados pessoais.

A interface no detalhe possui Salário e Pix, Pagamento avulso, Solicitações e
Histórico. A central `/cadastros/funcionarios/pagamentos` permite filtrar aprovações,
atualizar salários em lote e gerar uma competência. Uma proposta do lote pode
ser aprovada sem aprovar as demais. Não se calcula folha legal, encargos ou férias.
Os valores e categorias são declarados pelo operador.

## Autoridade e aprovação

`catalog.staff.read/manage` controlam o cadastro operacional.
`finance.staff.read` libera dados salariais; `finance.staff.manage` propõe mudanças;
`finance.staff.approve` autoriza ou recusa e encerra obrigações no desligamento.
Administradores existentes recebem essas três permissões na migração. Nenhum
outro papel recebe dados salariais automaticamente. Cada proposta guarda autor,
conteúdo, revisão original e decisão. Salário/Pix só são aplicados na aprovação.
Uma revisão financeira antiga não pode sobrescrever uma mais recente.

Contas geradas integram `payables`, com uma origem exclusiva: compra ou obrigação
de funcionário. `receiptId` é nulo na segunda; `staffId` aponta ao funcionário.
O domínio financeiro é responsável pela criação/cancelamento do título e pelos
pagamentos/estornos manuais já existentes. Nada envia dinheiro, consulta saldo ou
atesta liquidação bancária. Não há conexão com Bling Conta.

## Recorrência

Aprovar recorrência cria o salário da competência atual quando aplicável. Um
reconciliador SQL/Rust executa a cada hora e no início do processo, usando o fuso
America/Sao_Paulo (UTC-3), trava da empresa e origem única por funcionário/mês.
A central permite gerar uma competência explicitamente, sem duplicar títulos.
O dia é o primeiro ou quinto dia útil; sábado e domingo são excluídos. Feriados
nacionais, estaduais e municipais aplicáveis precisam ser informados no calendário
do cadastro. Não inferimos o calendário da empresa.

A função SECURITY DEFINER `erp_staff_payroll_due_tenants()` retorna somente IDs
de empresas com recorrências aprovadas de funcionários ativos. Seu EXECUTE é
revogado de PUBLIC e concedido apenas ao runtime no deploy. Nenhum endpoint
expõe essa descoberta. Todas as tabelas financeiras continuam com FORCE RLS e
as gravações do worker usam o contexto e a trava da empresa. Não há Redis/BullMQ.

Alterações aprovadas atualizam somente salários futuros em aberto sem qualquer
registro de pagamento. Históricos pagos ou parcialmente pagos são preservados.
Desativar recorrência cancela os salários futuros ainda intocados. Desligamento
cancela títulos em aberto (preservando lançamentos e valores já pagos), cancela
propostas pendentes e desativa recorrência. Reativar cadastro não reativa pagamentos.

## Contrato e verificação

Rotas: `/api/v1/staff/{id}/payroll`, `/payroll/requests`, `/api/v1/staff-payroll`,
`/staff-payroll/salaries`, `/staff-payroll/generate` e
`/staff-payroll/requests/{id}/review`. Todas autenticadas por empresa; escrita usa
Idempotency-Key e decisões exigem If-Match. BFF verifica sessão, origem, empresa,
rotas e limites. Nenhum estado pessoal é colocado em localStorage.

Testes HTTP com PostgreSQL verificam aprovação, proibição, repetição de comandos,
valores, RLS, histórico e rollback quando auditoria falha. Testes de navegador
usam identidade e API sintéticas, para interface e responsividade. Não comprovam
conexão bancária. A publicação segue os workflows Production release e Production
data migration (schema_only); o servidor nunca constrói imagens ou aplica DDL.
