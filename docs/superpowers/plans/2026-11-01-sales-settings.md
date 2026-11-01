# Configurações operacionais de Vendas

Entrega vinculada à frente AVL-372, solicitada pela captura de Preferências.

## Escopo

- Parâmetros por empresa: valor mínimo do pedido, prazo máximo de recebimento
  em dias e exigência de e-mail ou telefone do cliente.
- Perfil novo sem valores preenchidos ou escolhas sugeridas. Gravação exige
  preenchimento explícito dos três campos; zero significa mínimo sem restrição
  monetária e prazo zero permite vencimento até o dia da confirmação.
- Regras verificadas no servidor ao confirmar um pedido, antes de reservar
  estoque. Prazo contado a partir do dia da confirmação em Brasília.
- Sem configuração gravada, o fluxo atual permanece utilizável. Cancelamento e
  conclusão de pedidos já confirmados não são reavaliados por regras novas.
- Gestão exige `platform.company.manage`; leitura permite gestão/cadastro da
  empresa ou leitura de pedidos. RLS, revisão, auditoria e outbox preservados.
- Propostas comerciais e PDV continuam em tarefas próprias, pois seus fluxos
  atuais são demonstrativos.

## Execução e verificação

- [ ] Cobrir formulário vazio, gravação e conflito sem perda da edição.
- [ ] Criar armazenamento RLS, GET/PUT e validação na confirmação do pedido.
- [ ] Expor Preferências / Vendas e mostrar regras vigentes nos pedidos.
- [ ] Cobrir persistência, acesso, isolamento e bloqueio sem efeitos parciais
  contra PostgreSQL em testes da API.
- [ ] Atualizar OpenAPI, inventário de contratos e grants de runtime.
- [ ] Validar testes locais de interface, lint, tipos e CI completo.
- [ ] Publicar somente após release e migrations aprovadas; conferir domínio e
  registrar a entrega e os limites na AVL-372.
