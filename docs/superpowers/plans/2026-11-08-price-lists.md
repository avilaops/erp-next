# Cadastro de listas próprias

> Implementação em sequência com a skill executing-plans; sem agentes adicionais.

**Objetivo:** substituir o alias de publicação comercial por cadastro real de listas de preços por produto.

**Escopo aprovado:** listas próprias escolhidas pelo usuário. Nome, código, vigência opcional, situação, observações e itens com preço manual em reais. Não aplicar automaticamente a pedidos existentes nem alterar o preço base dos produtos.

**Arquitetura:** domínio Rust/Axum com PostgreSQL e isolamento por empresa, BFF Next.js e interface de tabela/formulário. Reutilizar permissões de catálogo de produtos, ETag, idempotência, auditoria e proteção de navegação. Publicação comercial permanece em suas rotas atuais.

**Restrições:** 18/14/12 px, componentes compartilhados, URLs atuais de listas preservadas, nenhuma migração em produção antes de revisão do resultado concreto.

## Implementação

- [ ] Testes de navegador: criar lista, adicionar produtos, consultar, editar e preservar erros/conflitos.
- [ ] Migração com listas e itens, chaves compostas por empresa, RLS e preços em centavos.
- [ ] API list/get/create/update com validação de datas, itens duplicados, produtos da empresa, permissões e revisão; testes de domínio e integração.
- [ ] BFF e telas reais de listagem/criação/consulta/edição, com pesquisa de produtos.
- [ ] TypeScript, lint, arquitetura e testes; preparar instruções de ativação da API/migração.

## Revisão

Cobrir preço inválido, vigência invertida, produto de outra empresa, consulta sem permissão de escrita e repetição após confirmação perdida. Arquivamento conserva histórico e itens. Novos registros usam código único por empresa. Atualizações devem preservar a digitação após conflito e exigir recarga explícita.
