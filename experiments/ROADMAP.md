# Roadmap do Ávila Experiments

Atualizado em 2026-10-26. Este documento planeja entregas; não certifica implantação
nem altera o estado dos artefatos empacotados. A execução em andamento está descrita
em [COPILOT-PAINEL-ML.md](COPILOT-PAINEL-ML.md).

## Princípios de execução

- Definir hipótese, critérios e evidências antes da execução. Registrar também
  erros, reprovações e resultados inconclusivos.
- Vincular resultados às versões de código, dados, parâmetros e avaliadores.
- Comparar somente execuções com premissas compatíveis.
- Distinguir teste local, integração real, implantação e verificação pública.
- Preservar arquivos históricos. Snapshots por execução não tornam o armazenamento
  inviolável; a autenticidade do trace exige evidência do executor.
- Não editar concorrentemente o mesmo escopo com agentes independentes.

## Fronteiras

| Superfície | Acesso | Conteúdo permitido |
| --- | --- | --- |
| Repositório independente | Público após revisão | Código e documentação selecionados, sem segredos ou dados privados |
| Página estática | Público | Relatórios e mídias sintéticos explicitamente selecionados |
| Painel e API de operação | Autenticado | Edição, execução, histórico e resultados autorizados |
| Annif, Ultralytics, TensorFlow/Jupyter e MCPs internos | Privado | Processamento e integrações autenticadas |
| Índice de conhecimento público | Público quando implementado | Derivações somente do corpus público aprovado |

A API HTTP atual executa o laboratório numérico. O cenário de caminho é local e
simulado, disponível em `npm run test:path`; não demonstra integração com agentes
remotos ou com um runtime THESEUS. Os datasets atuais são de desenvolvimento,
sem holdout independente declarado.

## Etapa 0 — concluir e auditar a implantação atual

Prioridade imediata. SEO, vetorização e mídia não devem atrasar esta entrega.
A última validação local do núcleo registrou 66 testes aprovados; o resultado
final do painel e do deploy deve ser registrado separadamente.

Ordem de revisão após a entrega do agente:

1. Auditar o exportador e o diretório público efetivamente servido. Conferir cada
   arquivo contra o manifesto permitido, incluindo HTML, CSS e demais assets
   gerados. Usar diretório de build isolado ou limpeza delimitada e verificável,
   evitando resíduos de builds anteriores. Não copiar a árvore do projeto inteira.
2. Confirmar exclusão de `.env`, `var/`, logs, credenciais, backups e relatórios
   privados, tanto no artefato final quanto no acesso HTTP. Repetir o build com
   um arquivo sentinela inofensivo não autorizado e comprovar sua ausência na saída.
3. Explicitar o escopo de classificação: a lista atual inclui `classification.json`
   e `classification-dataset.json`, além dos artefatos numéricos e de caminho.
   Manter sua inclusão documentada ou removê-los deliberadamente da publicação.
4. Obter o erro completo de `scripts/ui-check.mjs`. Conferir a asserção que procura
   `Output exceeds`: a base numérica conhecida falha por tolerância, sem reprovar
   o gate de faixa. Validar o gate e o motivo corretos antes de mudar o teste.
   Uma falha de teste não deve ser atribuída à aplicação sem diagnóstico.
5. Executar o fluxo visual de duas revisões concorrentes: a segunda gravação deve
   receber 412, preservar a edição local e permitir recarregar a revisão atual.
6. Verificar acesso anônimo bloqueado ao painel e aos dados da API, funcionamento
   autenticado e ausência de credenciais no bundle, HTML e artefatos públicos.
7. Reiniciar os containers sem excluir volumes e recuperar uma execução anterior.
8. Medir CPU, RAM, swap e disco antes/depois com horários e cargas comparáveis.
   Separar inventário em repouso de teste de carga; uma medição isolada não prova
   capacidade. Preservar e verificar os serviços existentes no apps-noclient.

Aceite: URLs reais verificadas, manifesto de publicação, resultados dos testes,
screenshots desktop/móvel, inventário medido e procedimento de rollback.
Até essa evidência existir, os itens permanecem não verificados.

## Etapa 1 — indexação e descoberta das páginas públicas

Depende do aceite da etapa 0.

- Gerar títulos, descrições, URLs canônicas e JSON-LD coerentes com o conteúdo.
  Avaliar `TechArticle` sem afirmar validação científica ou resultados enriquecidos
  garantidos. Dados estruturados não devem inventar autoria, datas ou métricas.
- Gerar sitemap com URLs absolutas e canônicas apenas das páginas públicas
  autorizadas. Não incluir rotas operacionais, login ou dados privados.
- Planejar `robots.txt` na raiz do host respeitando os outros serviços hospedados.
  Não inserir uma regra global que prejudique páginas públicas do mesmo domínio.
- Usar `noindex` em meta HTML e/ou `X-Robots-Tag` nas superfícies apropriadas.
  Autenticação é a fronteira de acesso; instruções a robôs não a substituem.
- Não colocar `noindex` dentro de `robots.txt`. Quando uma regra de indexação
  depender de leitura da página, considerar que `Disallow` pode impedir sua leitura.
  Isso não justifica abrir páginas privadas para rastreadores.
- Medir desempenho em condições declaradas. HTML estático não garante tempo zero,
  boas Core Web Vitals ou determinada posição nos resultados de busca.

Aceite: matriz de URLs públicas/privadas, status e cabeçalhos HTTP registrados,
sitemap sem rotas privadas e inspeção do HTML entregue. Simular User-Agent de robô
testa a resposta do servidor, não comprova indexação real por Google ou Bing.

## Etapa 2 — recuperação textual e embeddings

Depende de corpus público estável e manifesto de exportação aprovado.

- Extrair conteúdo legível do MDX confiável sem executar conteúdo arbitrário.
- Dividir por seções, preservando relações entre tabelas, regras e ressalvas.
- Registrar documento, URL, seção, versão, hash e identificador de cada trecho.
- Criar perguntas com referências, incluindo ambiguidades e ausência de evidência.
  Uma pergunta de cálculo deve distinguir tolerância de teste e política comercial.
- Comparar uma busca textual de referência com a recuperação vetorial antes de
  adicionar infraestrutura. Medir relevância, atribuição correta, latência e custo.
- Verificar modelo, licença, hardware, memória e armazenamento. A presença de
  TensorFlow/Jupyter não comprova disponibilidade de um modelo de embeddings.
- Versionar modelo, dimensões e parâmetros de divisão. Propagar correções e
  exclusões do corpus ao índice, sem misturar dados privados ao índice público.

Aceite: avaliação reproduzível com fontes recuperáveis e respostas sem evidência
explicitamente recusadas ou qualificadas. Embeddings não garantem resposta exata.

## Etapa 3 — consulta por MCP

Depende da validação da recuperação. Um MCP também pode servir busca textual;
não precisa aguardar ou exigir vetores se eles não trouxerem benefício demonstrado.

- Expor consulta somente ao corpus aprovado, com esquema de entrada e limites.
- Retornar trechos, referências e versões; distinguir recuperação de geração.
- Separar completamente a consulta pública das ferramentas operacionais privadas.
- Verificar isolamento de corpus, resultados vazios, limites e custo por consulta.

Aceite: cliente MCP real consultando fontes públicas, sem capacidade de executar
experimentos, alcançar serviços internos ou recuperar documentos privados.

## Etapa 4 — imagens, vídeos e recuperação multimodal

- Capturar screenshots, vídeos e traces com runId, versão e identificação do caso.
- Para regressão visual, começar com comparação determinística de screenshots,
  ambiente controlado e limiares declarados. Ultralytics não é necessário para
  capturar telas; qualquer avaliação por modelo deve ser validada separadamente.
- Definir formatos, tamanho, duração, retenção, permissões e orçamento de disco.
  Rejeições de mídia devem gerar erros explícitos no executor que a processa.
- Publicar somente mídias aprovadas, removendo metadados e conteúdo sensível.
  Gerar descrições acessíveis fiéis ao conteúdo, sem inventar achados.
- Adicionar extensões de sitemap de imagem/vídeo apenas para mídias públicas
  existentes e elegíveis. Não publicar gravações privadas de sessões.
- Tratar documentos fiscais e comprovantes reais como corpus privado. Avaliar
  embeddings multimodais com dados permitidos e referências antes de integrá-los.

Aceite: vínculo entre mídia e execução, tratamento de entrada inválida, orçamento
medido e testes de acesso. Não classificar mídia de desenvolvimento como holdout.

## Referências de indexação

A biblioteca local indicada pelo proprietário está em
`D:\Projetos\Docs\Google-Developers\crawling-indexing`. Os arquivos consultados
incluem frontmatter com URL de origem e data de extração; preservar os originais.

- `block-indexing.md`: [noindex](https://developers.google.com/search/docs/crawling-indexing/block-indexing?hl=pt-br).
- `control-what-you-share.md`: [controle de conteúdo](https://developers.google.com/search/docs/crawling-indexing/control-what-you-share?hl=pt-br).
- `robots/intro.md`: [limites de robots.txt](https://developers.google.com/search/docs/crawling-indexing/robots/intro?hl=pt-br).
- `robots-meta-tag.md`: [meta robots e X-Robots-Tag](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag?hl=pt-br).
- `sitemaps/build-sitemap.md`: [geração de sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap?hl=pt-br).

Revalidar as referências oficiais no momento da implementação; o acervo local
é uma captura documental, não uma garantia de atualização permanente.
