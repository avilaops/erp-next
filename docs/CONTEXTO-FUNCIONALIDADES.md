# Contexto de funcionalidades do ERP

## Fonte das definições

`verification/contracts.json` mantém as ações e suas regras. O campo
`productFlows`, sob `erp-product-flow-definitions/1`, acrescenta os nomes de
produto, objetivos, dependências e próximos passos. `actionGroups` referencia
o campo `flow` das ações existentes. Cada grupo precisa ter exatamente um
responsável. Permissões, operações, recuperação e tipos do corpo continuam
definidos nas ações canônicas.

As 96 ações atuais estão organizadas em 23 funcionalidades ou recursos de
suporte. Três têm sequência explicitamente definida: usuários e convites,
produtos e cadeia de compra/pagamento. Os 25 grupos com decisões pendentes
continuam preservados, inclusive quando estendem uma funcionalidade existente.

Uma etapa pode referenciar ações canônicas, operações de autenticação ou um
sistema externo identificado. Referências a ações de outra funcionalidade
exigem dependência explícita, direta ou transitiva. Uma sequência definida
descreve o caminho pretendido; não afirma que esse caminho foi executado.

## Saída por tarefa

Execute `pnpm context:erp --flow users` para obter Usuários e suas dependências.
Use `products` ou `purchase_payment_chain` para as outras sequências iniciais.
Sem filtro, o comando inclui todas as funcionalidades.

O JSON `erp-product-context/1` contém:

- Commit, estado do checkout, hash do catálogo e fingerprint do inventário.
- Manifesto de fontes relativas ao repositório, com SHA-256 de cada arquivo.
- Seleção da tarefa e dependências transitivas.
- Definições das funcionalidades e referências às ações selecionadas.
- Contratos canônicos das ações, operações de autenticação e decisões pendentes.
- Declarações de implementação e vínculos de interface, separados de publicação e execução.

O Markdown apresenta objetivos, telas, permissões, ações, fontes e próximos
passos para leitura direta pelo desenvolvedor. Os conteúdos são derivados;
alterações devem ser feitas no catálogo ou nas fontes e geradas novamente.

O CLI lê fontes declaradas, dependências TypeScript resolvidas estaticamente e
arquivos de configuração do projeto incluídos no manifesto. Não lê `.env`,
cookies ou banco, e não inclui corpos de fontes no artefato. Referências que
saem do repositório, arquivos ocultos ou links simbólicos são recusadas.
O grafo de dependências Rust e as relações observadas em execução não estão
resolvidos por esse mecanismo.

## Consistência e consumo

As mesmas entradas produzem os mesmos bytes e a mesma pasta endereçada pelo
hash. Mudanças no conteúdo alteram o hash. A escrita usa criação exclusiva e
confere os bytes quando o arquivo já existe; não substitui um artefato divergente.
O gerador confere o estado Git, o inventário e as fontes antes e depois da leitura.
Isso detecta divergências observadas, mas não garante atomicidade do filesystem.

O contexto de um checkout com alterações registra `dirty: true`. O commit é a
base desse checkout, não a afirmação de que todos os bytes pertencem ao commit.
O manifesto e o hash do inventário identificam o conteúdo adicional observado.

O validador recusa um artefato cujo conteúdo diverge do hash declarado. A
correspondência de hashes não autentica origem nem comprova regras de negócio.

Publicação e execução permanecem `not_observed`. O consumidor futuro precisará
registrar separadamente ambiente, versão servida e evidências de execução.
A sincronização com o laboratório deve confirmar a importação e reconciliar
respostas perdidas, com proteção de revisão e preservação da captura anterior.
O gerador de contexto não implementa essa sincronização nem a nova visão de fluxos
no Experiments, e não modifica o importador de inventários de rotas existente.

## Consumo pelo MCP central

`pnpm context:erp:mcp` gera um lote para Usuários, Produtos e Compras em
`artifacts/mcp-context/<bundleSha256>/bundle.json`. `--flow` pode ser repetido
para selecionar outras funcionalidades. O lote contém um índice pequeno e
capturas completas, preservando o formato `erp-product-context/1` e seus hashes.
Todas as capturas precisam pertencer ao mesmo estado de fonte; capturas
adulteradas ou seleções repetidas impedem a exportação.

O MCP central encaminha as chamadas para o workflow `MCP - Avila Ops` no n8n.
As duas ferramentas de leitura e os identificadores de suas tabelas estão em
[`central-tools.json`](../verification/mcp/central-tools.json):

1. `erp_contexto_listar` retorna as 20 entradas mais recentes do índice, com
   título, funcionalidade, commit, estado do checkout e SHA-256 da captura.
2. `erp_contexto_obter` recebe o `content_sha256` exato e retorna `context_json`.
   O consumidor deve analisar o JSON, validar o schema e recalcular seu hash.
   Ausência ou duplicidade de captura impede usar esse resultado como contexto.

As tabelas são armazenamento de artefatos derivados, não outra definição de
contratos. Não recebem senhas, sessões, corpos de arquivos ou dados do banco.
Pessoas autorizadas no n8n podem editar as tabelas; elas não são um registro
imutável nem uma assinatura da origem do conteúdo.

Para importar um lote, o operador ou agente usa a conexão autenticada do n8n:

1. Consulta cada hash na tabela de capturas. Se existir, confere os bytes; se
   não existir, insere a linha de `tables.snapshots`. Não substitui divergências.
2. Lê novamente e valida cada captura completa e o SHA-256.
3. Só depois insere as linhas correspondentes de `tables.index`, sem duplicar
   pares de funcionalidade e hash já registrados.
4. Confere a leitura pelas ferramentas do MCP central. Uma resposta perdida
   exige consultar o estado antes de repetir uma inserção.

Não há transação entre as duas tabelas. Uma importação interrompida pode deixar
capturas ainda sem índice, recuperáveis por hash. A conferência antes de inserir
não é exclusão mútua: use um único importador por vez. O horário das linhas
identifica a importação, não a publicação do ERP ou a execução de um fluxo.

O CLI apenas gera o lote; não possui credenciais nem envia requisições ao n8n.
A primeira importação é operacional, não uma atualização automática por commit.
Após mudanças no ERP, é necessário gerar e importar outro lote. A automação
dessa atualização e o consumidor visual no laboratório continuam separados.
