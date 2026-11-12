# Endereços e contatos de clientes/fornecedores

Contrato registrado no Linear antes da migration: documento `85f72009-cb28-4b60-b3d7-ee8d9077b1a3`.

Usar as quatro operações existentes de /api/v1/parties, permissões catalog.parties.read/manage, criação com Idempotency-Key e atualização com If-Match. Não criar endpoints paralelos.

Coleções addresses e contacts limitadas a dez itens e um principal em cada. Endereço brasileiro: label, postalCode, state, city, street, number, district, complement e primary. Contato: name, role, email, phone e primary; nome e pelo menos um canal obrigatórios. Validar limites, UF, oito dígitos de CEP e formato de e-mail; não consultar serviços externos.

Criação sem coleção significa vazia. PUT sem coleção preserva a anterior. [] remove explicitamente. null e campos desconhecidos são recusados. Respostas sempre contêm arrays. Manter coleções e revisão na transação do cadastro, auditoria e outbox; recusa não produz efeitos parciais e revisão antiga preserva a edição na tela. Não alterar snapshots comerciais nem gerar mensagens, estoque ou financeiro.

Plano: teste de integração primeiro; tipos/validação e armazenamento JSON na linha isolada por tenant; formulário e consulta com incluir/editar/remover; testes CI de persistência, compatibilidade, erros, acesso e rollback; revisão e registro das evidências. Builds e testes somente GitHub CI, nenhuma operação em produção.
