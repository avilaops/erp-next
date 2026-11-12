# Administracao de tenants

O ERP reconhece administradores da plataforma por concessao explicita em
`platform_administrators`, vinculada ao subject real do Auth. Nao ha promocao
por dominio de email, cabecalho enviado pelo navegador ou papel de administrador
de uma empresa. A concessao e revogacao pertencem a administracao de banco,
devem identificar operador/motivo e ser auditadas; nao ha API de autoatribuicao.

`GET /api/v1/companies` acrescenta `platformAdministrator` e o estado de cada
empresa. Usuarios comuns mantem a descoberta por membership ativo. Operadores
veem todos os tenants, inclusive suspensos/arquivados, mas apenas ativos podem
ser selecionados. O login sempre apresenta o seletor ao operador, mesmo que
exista somente uma empresa. Uma sessao ja aberta pode usar `/empresas`.

`POST /api/v1/company-selection`, autenticado e com `X-Tenant-Id`, valida acesso
e grava `platform.tenant.selected`. O BFF so troca o cookie depois do sucesso.
O evento identifica a pessoa real e se o acesso e administrativo.

O acesso administrativo usa o tenant selecionado e as permissoes do catalogo
com as mesmas seis exclusoes fiscais do onboarding. Nao cria memberships de
cliente, nao desliga RLS e nao permite operar tenant inativo. A concessao e
consultada a cada autorizacao; revoga-la interrompe acessos administrativos
existentes sem remover memberships legitimos anteriores.

RLS permite leitura do diretorio completo apenas sem contexto de tenant.
Transacoes de dados continuam limitadas a um tenant. A tabela de concessoes
possui somente politica SELECT por subject, sem politica de escrita para o
runtime. Recursos com requisitos adicionais (por exemplo FK de proprietario
para membership em arquivos/relatorios) preservam esses requisitos: autoridade
global nao fabrica vinculos para satisfazer contratos de outros dominios.

Nao ha seed de conta real em migration. Depois do deploy, confirmar a identidade
e autoridade no Auth e conceder somente o acesso explicitamente autorizado.
Registrar a concessao/revogacao em audit_log com o operador e o motivo reais.

Validacao: teste de API com role NOSUPERUSER NOBYPASSRLS cobre diretorio,
selecao auditada, usuario comum, email igual/subject diferente, tenant suspenso,
RLS no contexto selecionado, autoatribuicao negada e revogacao imediata.
