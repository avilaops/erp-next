# Formulário fiscal conforme referências

## Escopo e limites

Trabalhar nos arquivos locais sem Git e sem transmissão real. Usar os campos das referências, mantendo o regime da empresa e a numeração fiscal controlada pelo servidor. Não apresentar operações sem XML/validação implementados como aptas à transmissão.

## Implementação

1. Adicionar datas declaradas de emissão e saída, presença, apresentação do DANFE e dados complementares do destinatário ao contrato Rust. Preservar compatibilidade dos rascunhos históricos, congelamento da data e idempotência da emissão.
2. Mapear esses campos no motor e no XML. Cobrir presença, datas, apresentação e contatos com testes sintéticos, incluindo entrada inválida.
3. Apresentar dados da nota e destinatário como nas referências, integrados às etapas existentes. Mostrar série/número/regime vindos do servidor, reutilizar o cliente cadastrado e manter valores ao navegar.
4. Exibir as modalidades da referência com suporte explícito. Importação de XML autorizado deve seguir consulta/documentos, sem gerar emissão duplicada. Modalidades cujo motor não implementa as regras não podem ser transmitidas por uma alteração apenas visual.
5. Regenerar o contrato, verificar TypeScript/lint, executar testes do motor e testes de navegador. Não compilar a suíte completa de testes Rust nesta máquina de 8 GB, que já esgotou a memória; usar cargo check com um job e testes focados dos contratos.

## Evidências

Registrar as validações efetuadas e as capacidades ainda indisponíveis. Conferir regras fiscais somente em fontes oficiais do Portal NF-e. A compatibilidade visual não equivale à homologação fiscal das novas modalidades.
