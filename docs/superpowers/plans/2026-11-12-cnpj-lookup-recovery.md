# Consulta cadastral no cadastro de cliente do pedido

O usuário recebeu `Unexpected end of JSON input` ao consultar um CNPJ em Novo pedido. A consulta autenticada na API de produção encontrou o mesmo CNPJ com BrasilAPI e HTTP200. Isso comprova disponibilidade na leitura realizada, sem reproduzir o defeito transitório do navegador.

## Causa e limites da evidência

RegistryLookup chama response.json diretamente no POST de consulta e no GET de conferência da sessão. A ausência de corpo em qualquer etapa gera o erro nativo mostrado, interrompendo o preenchimento. O BFF também encaminha corpos vazios ou não JSON da consulta, embora o contrato prometa JSON. O navegador Brave aberto não oferece porta CDP; a origem de um eventual corpo vazio no transporte em produção ainda não foi observada.

## Implementação

1. Reproduzir a falha com respostas vazias e truncadas no navegador e nos testes do protocolo; incluir leitura de sessão, autorização negada, cancelamento e preservação dos campos.
2. Normalizar respostas inválidas no BFF somente para as consultas cadastrais. Criar leitura tipada e recuperação limitada a uma repetição dessas operações de consulta; não repetir gravações comerciais.
3. Manter empresa, documento, origem da prévia, validade e confirmação da sessão antes de aplicar dados; erros devem orientar em português sem expor exceções de JSON.
4. Verificar modelos, navegador responsivo, tipos, lint e build. Uma revisão final independente; corrigir achados importantes.
5. Publicar a revisão testada e conferir a consulta real por leitura, sem criar cliente, pedido ou emissão. Preservar as alterações do usuário e o pacote separado de acabamentos.

Não há mudança no banco, inferência de inscrição estadual ou de tributação, nem preenchimento de um documento diferente do consultado. A organização documental por tela já foi concluída no PR194.

## Validação da correção

- Regressão reproduzida no build anterior: consulta vazia não preenche o cliente do pedido; BFF encaminha corpo vazio com HTTP200.
- 152 testes de modelo e protocolo passaram, incluindo validação de respostas parciais, autorização, cancelamento e ausência de repetição de comandos comerciais.
- 33 testes de navegador passaram no build de produção, com pedido em 393/1280px e cadastros em 320/390/768/1280/1920px. Incluem sessão vazia, empresa/documento alterado, prévia vencida e preservação da digitação.
- Build padrão com Turbopack e tipos passou; lint sem erros, com oito avisos anteriores. O checker documental verificou 878 links sem erro novo. A auditoria de arquitetura conserva os mesmos 20 achados da base, sem achados novos ou mudança de rotas.
- A revisão independente apontou validação insuficiente de uma prévia parcialmente válida. O teste reproduziu a falha; a validação de inscrições estaduais e metadados foi ampliada e os testes passaram.

A origem do corpo vazio observado pelo usuário não foi capturada no transporte de produção. A consulta direta à API retornou os dados do CNPJ; a correção trata as falhas de contrato reproduzidas no caminho do formulário.
