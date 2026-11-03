# Central de NFS-e recebida — AVL-112

Parte da meta AVL-101/104/108/110/111/112. Não encerra captura incremental,
eventos, conferência fiscal individual ou homologação externa.

## Desenho

Página `/fiscal/nfses`, ligada à central fiscal. Apresentar empresa ativa,
origem manual nacional, ambiente do arquivo e pendências de assinatura/situação.
Listar somente documentos do tenant e permitir detalhes e XML original íntegro.
Importação por arquivo UTF-8 de até 1 MiB, somente com permissão explícita.
Emitente, prestador e tomador permanecem distintos; valores usam strings exatas.

BFF expõe somente as quatro operações já existentes na API. Todas exigem
tenant igual à sessão; POST também exige Origin e JSON. Nenhuma URL livre,
consulta à autoridade, certificado, emissão ou lançamento comercial.

Falha ou troca de empresa limpa documentos/detalhe visíveis. Reenvio do mesmo
arquivo na mesma empresa conserva a chave idempotente após resposta incerta;
seleção fica somente em memória. Mudança de empresa invalida a seleção. Download
confere tipo, limite, SHA-256 do conteúdo e header antes de criar o arquivo.

## Execução

- [x] Escrever testes browser/BFF antes das rotas e confirmar falha no Actions:
  41645227586, primeiros três casos NFS-e falharam, dez anteriores aprovados;
  execução interrompida pelo limite de 60 s antes dos demais casos novos.
- [x] Implementar quatro handlers BFF com sessão/tenant/origem e limites.
- [x] Implementar validação de respostas, importação UTF-8 e download com hash.
- [x] Implementar tela, estados, leitura, detalhes, importação e paginação.
- [x] Atualizar catálogo e superfície de rotas, sem alegar execução pelo catálogo.
- [ ] Revisar e validar CI/browser com cinco tamanhos de tela.

Branch empilhada sobre o PR #72 em `3c9650e`; PR separado em rascunho.
Rust: nenhuma ferramenta local; compilação/lint/testes somente no Actions.
Next 16.4.3 confirmado no package.json e guias do pacote da mesma versão lidos
no checkout compartilhado, sem alterar esse checkout.

Modelo puro: teste vermelho local por módulo ausente, seguido de três casos
novos aprovados (cinco com os dois casos anteriores). Revisão reproduziu arrays
aceitos como enums por coerção para string; negativos acrescentados falharam,
e a correção por checagem explícita de tipo passou. Nenhuma ferramenta Rust
local foi executada. API/base: CI 41645184648 aprovado em c6bee54, oito testes
NFS-e e 235 testes API aprovados, um Ollama ignorado por configuração explícita.

Revisão da central identificou corrida de troca de sessão durante lista/detalhe
e seleção retida quando a empresa nova não permite listar. A tela agora confere
a empresa depois dessas respostas e invalida o arquivo assim que observa outro
tenant. Dois cenários browser com resposta retida/troca real de cookie foram
acrescentados; validação executável completa da interface segue pendente no CI.
Checagem estática de arquitetura sem erros; 17 testes de contratos/contexto
aprovados após reinstalar somente a dependência Ajv do diretório raiz.

CI 41648409463 aprovou build, lint, contratos, Rust e 19 de 20 casos do monitor.
O caso restante tinha seletor amplo que encontrava o aviso e o texto do cartão;
foi restrito ao role status nos dois cenários de importação. As cinco capturas
(320/390/768/1280/1920) foram inspecionadas, sem corte horizontal; o teste de
paginação e os dois cenários novos de troca de sessão passaram. CI final após
a correção do seletor ainda pendente.
