# Funcionários e vendedores

Contrato definido antes da migration e salvo no Linear: db0e43f1-4396-4883-9083-0925576d6468.

Cadastro operacional único por empresa, com funções isEmployee/isSeller (ao menos uma). Código obrigatório único mesmo arquivado; nome obrigatório, cargo/e-mail/telefone opcionais. Nenhuma identidade ou conta Auth é criada ou vinculada por coincidência de nome/e-mail. Não calcula comissões ou folha nem vincula pedidos automaticamente.

API: GET/POST /api/v1/staff e GET/PUT /api/v1/staff/{id}. Consultar exige catalog.staff.read; escrever exige também catalog.staff.manage. POST com Idempotency-Key, PUT com If-Match. Identificador/empresa/revisão vêm do servidor. Repetição não duplica; código em conflito retorna 409; revisão antiga 412; precondição ausente 428. Listagem suporta q, role=employee/seller, status=active/archived e offset/limit. Arquivar/reativar são alterações explícitas do status, sem exclusão física.

Código normalizado ASCII maiúsculo: A-Z, 0-9, ponto, hífen e underscore, 1–40 caracteres. Nome até 200; cargo 120; e-mail 254; telefone 40. Aparar textos, recusar controles e campos desconhecidos. RLS forçada, lock/revalidação de direitos e transação única para registro/auditoria/outbox/comando. Eventos não replicam contatos pessoais.

Plano: testes primeiro; implementação Rust/PostgreSQL; BFF e substituição das oito telas demonstrativas; casos de acesso, validação, concorrência, revisão, arquivo/reativação e rollback; testes web e revisão independente; registrar evidências no Linear. Todas as verificações na CI, até 90 s por execução, sem deploy/migration de produção.
