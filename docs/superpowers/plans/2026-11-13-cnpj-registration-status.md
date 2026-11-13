# Situação cadastral do CNPJ visível antes do cadastro

O usuário apontou que um CNPJ baixado aparece apenas com a situação interna Ativo no cadastro. A consulta à BrasilAPI devolveu código 8, BAIXADA, data 2026-04-15 e motivo de encerramento por liquidação voluntária. O parser atual descarta esses campos.

O objetivo geral anterior permanece pausado. Esta correção é uma tarefa independente, em worktree isolada, preservando o trabalho de documentos/e-mail existente no checkout do usuário.

1. Reproduzir a perda da situação cadastral no parser e a ausência do aviso nos formulários.
2. Normalizar situação, data e motivo das fontes BrasilAPI/CNPJ.ws. Ausência ou divergência permanece não confirmada; nunca presumir Ativa. Manter o contrato de campos textuais existente e o alerta nas respostas para clientes anteriores.
3. Exibir aviso destacado na consulta e mantê-lo após preencher os campos. Cobrir cadastro da empresa, clientes/fornecedores, cliente do pedido e oportunidade. Na visualização de um cadastro existente, consultar a situação sem alterar os dados salvos.
4. Identificar explicitamente a situação interna como Situação no ERP. Não arquivar a pessoa, alterar relacionamentos ou bloquear o cadastro automaticamente; o pedido é informar a situação cadastral.
5. Verificar regressões de origem/documento/empresa, dados manuais preservados, situação desconhecida e ausência de gravação só por consultar. Validar tipos, lint, build e navegador; uma revisão independente antes da publicação.

Sem migração de banco: a situação é informada pela consulta cadastral com fonte e data. Não constitui um campo fiscal declarado pelo operador nem será inferida da inscrição estadual.

Referências: modelo de estabelecimentos CNPJ.ws e domínio oficial de situação cadastral da Receita/Serpro: 1 Nula, 2 Ativa, 3 Suspensa, 4 Inapta, 8 Baixada.
