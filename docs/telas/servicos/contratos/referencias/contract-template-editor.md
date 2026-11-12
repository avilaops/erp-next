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

## Modelos do serviço conectado

A tela consulta pelo backend os modelos explicitamente associados à empresa
na instalação própria. A ação **Editar cópia no ERP** importa o PDF e os campos
para um rascunho privado. O original no serviço não é alterado.
Uma restrição por empresa e modelo de origem, junto da trava transacional e
idempotência, impede cópias duplicadas por cliques simultâneos ou novas tentativas.
A origem e sua definição são preservadas no armazenamento privado.

A importação suporta um documento estático com campos simples e múltiplas
áreas por campo. Modelos com múltiplos documentos, conteúdo dinâmico, campos condicionais
ou configurações não representáveis no editor ficam identificados como não
suportados, sem conversão parcial. A contagem inicial cobre as páginas dos campos;
ao abrir o PDF, o editor calcula a contagem completa antes de salvar.

## Publicação versionada

**Publicar versão para os pedidos** exige uma revisão salva e assinatura
obrigatória de cada participante. `commercial_template_versions` preserva o PDF,
definição e hash antes de chamar a API própria do portal. Triggers protegem o
snapshot. Cada revisão gera no máximo uma publicação; timeout mantém a intenção
durável. Uma nova tentativa consulta o mesmo identificador antes de repetir o POST.
O portal também deduplica esse identificador dentro da transação da conta.

O serviço confere a quantidade real de páginas com PDFium. Só após sua confirmação
o ERP registra o modelo como publicado e permite selecioná-lo em pedidos daquela
empresa. Campos com múltiplas áreas preservam todas as posições. Publicar não
gera solicitação de assinatura nem envia e-mail. Contratos emitidos mantêm o
snapshot e os documentos privados anteriores.

## Limites

- Salvar não publica o modelo, não modifica os modelos do provedor e não envia
  solicitações de assinatura.
- Os modelos já associados ao serviço continuam sendo usados pelos pedidos.
- O PDF é analisado no navegador e validado no servidor ao publicar.
- A lista mostra até 100 rascunhos recentes.
- Estruturas avançadas não representáveis continuam recusadas, sem importação parcial.
- A publicação depende da imagem do portal com a extensão em `deploy/contracts-portal`.

## Validação

Testes Rust cobrem limites de campos, participantes, permissão, revisão,
idempotência, auditoria e isolamento do armazenamento. O teste de navegador usa
um PDF real de fixture e um backend simulado para conferir criação, reabertura
e alteração/publicação do rascunho pela interface/BFF. O teste da imagem do portal
executa a API Rails real com banco descartável. Não é prova de produção ou de
assinatura concluída.

A migration deve seguir o fluxo de publicação do repositório. Não executar
migrações manualmente em `applications`. Registrar separadamente CI, publicação
das imagens, validação autenticada e assinatura realmente concluída.
