# Editor próprio de modelos — AVL-318

O editor em `/servicos/contratos/modelos` salva rascunhos privados por empresa.
O cadastro recebe PDF de até 5 MiB, participantes, campos, tipos e posições
percentuais, com arraste e ajuste por teclado sobre o PDF renderizado com PDF.js.
A edição exige `platform.integrations.manage`; a consulta exige
`sales.orders.read`. O BFF usa a sessão da empresa, sem expor credenciais do
serviço de contratos.

`commercial_template_drafts` preserva o PDF e a definição, com RLS e revisão.
O comando de gravação exige idempotência; atualizações exigem `If-Match`.
A auditoria registra a revisão e a quantidade de campos. O histórico do comando
recebe o hash do PDF em vez de duplicar seu conteúdo. Cada gravação é atômica.

## Limites desta etapa

- Salvar não publica o modelo, não modifica os modelos do provedor e não envia
  solicitações de assinatura.
- Os modelos já associados ao serviço continuam sendo usados pelos pedidos.
- O PDF é analisado no navegador para renderização e contagem de páginas.
  A publicação precisa validar também no backend a estrutura do PDF e a
  quantidade real de páginas antes de permitir uso em pedidos.
- Os campos representam posições do rascunho; salvar ainda não grava essas
  posições no modelo do serviço de assinatura.
- A lista mostra até 100 rascunhos recentes.
- Sincronização, importação dos modelos existentes e publicação de versões
  ainda precisam ser implementadas antes do aceite completo da AVL-318.

## Validação

Testes Rust cobrem limites de campos, participantes, permissão, revisão,
idempotência, auditoria e isolamento do armazenamento. O teste de navegador usa
um PDF real de fixture e um backend simulado para conferir criação, reabertura
e alteração do rascunho pela interface/BFF. Não é prova de produção ou de
assinatura concluída.

A migration deve seguir o fluxo de publicação do repositório. Não executar
migrações manualmente em `applications` nem publicar esta etapa como editor
integrado completo.
