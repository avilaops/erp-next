# Prompt para o Copilot: painel, evidências públicas e implantação

Copie o texto abaixo para o agente com acesso ao projeto e ao SSH.

---

Implemente e publique o painel Ávila Experiments. Execute até verificar a URL real;
entregue código funcional, testes e evidências de implantação.

## Origem e decisões

- Código local: `D:\Projetos\SaaS\erp-next\experiments`.
- Leia as instruções do checkout, `README.md`, `API.md`, `src/types.ts`,
  `src/lab/` e `examples/path-policy.mjs` antes de editar. A arquitetura do ERP
  também pode estar em `docs/.old/architecture.md`; confirme a localização.
- Preserve alterações existentes no ERP, versões 0.1/0.2/0.3 empacotadas,
  relatórios e diretórios por runId. Não sobrescreva artefatos publicados ou antigos.
- O núcleo é 0.3.0, privado e UNLICENSED. A extensão HTTP está no código de trabalho.
  O código público foi autorizado; prepare um repositório independente para este
  pacote, sem publicar o ERP inteiro. Verifique o remoto da organização antes de
  criar/reutilizar um repositório. Não escolha uma licença em nome do proprietário:
  registre a pendência se não houver escolha explícita. Não execute npm publish.
- São três fronteiras: código/documentação públicos; evidências sintéticas
  selecionadas em página pública; API de execução, edição e serviços ML privados.

## API existente: use o contrato real

- Node.js 24+, TypeScript; sem dependências de runtime no serviço atual.
- Comandos: `npm ci`, `npm test`, `npm run api`.
- Base local: `http://127.0.0.1:3300`; contrato: `/openapi.json`; guia: `API.md`.
- 66 testes passaram ao preparar este prompt; execute novamente e reporte o total real.
- `GET /api/v1/suite` fornece `revision`, `dataset`, `settings`, `hypothesis` e ETag.
- `PUT /api/v1/suite` recebe `{hypothesis,cases,settings}`, exige If-Match com o ETag.
  Em 412, preserve a edição local e ofereça recarregar; não sobrescreva a outra revisão.
- `POST /api/v1/runs` recebe `{revision}`, grava snapshot e retorna execução completa.
  HTTP 201 significa registro: use os verdicts, erros e inconclusivos para a conclusão.
- `GET /api/v1/runs` lista histórico paginado; `GET /api/v1/runs/{id}` retorna evidência.
- `POST /api/v1/comparisons` recebe:

```json
{
  "baseline": { "runId": "UUID_REAL", "variant": "baseline" },
  "candidate": { "runId": "UUID_REAL", "variant": "candidate" }
}
```

Se `comparable` for falso, mostre os motivos e não apresente uma melhoria válida.
Associe os casos dos relatórios às referências de `run.suite.dataset.cases` usando
seus identificadores. Renderize entrada, referência, saída, gates e motivos.

## Painel privado e identidade

Crie o frontend em `experiments/dashboard`, seguindo as convenções verificadas do
projeto. Use uma implementação simples em React/TypeScript com renderização no
servidor ou BFF para proteger as credenciais da API. Mantenha a biblioteca independente
do ERP. Não copie o visual do n8n. Identidade Ávila: branco, verde-petróleo `#0f766e`,
tipografia legível, contraste e foco de teclado, layout responsivo em português.

Implemente:

1. Visão geral com contagens, taxas, erros, inconclusivos, duração e cobertura de uso.
2. Editor de casos e parâmetros numéricos com validação e controle de revisão.
3. Execução real com estados de envio, conflito, erro e conclusão.
4. Histórico persistente, detalhe por caso e comparação entre variantes e execuções.
5. Download de evidência JSON e links para contrato/documentação.

Não invente gráficos, custos ou execuções. `null` em tokens/custo significa
“Não medido”. Tempos deste demo não são benchmark estatístico. Não declare cobertura
de código de 100% com base na quantidade de testes aprovados.

## Página pública de evidências

Implemente exportação estática reproduzível de relatórios selecionados. Use MDX
para narrativa e componentes de gráficos; carregue números dos JSONs exportados.
MDX deve ser fonte confiável do repositório, nunca conteúdo arbitrário enviado pelo
usuário e compilado no servidor. A página pública não terá ações de executar/editar.

Use uma lista explícita de artefatos sintéticos permitidos. Não copie `var/`, `.env`,
logs, tokens ou o diretório inteiro de relatórios para o site. Inclua versão,
proveniência, data, tamanho e split do dataset, critérios e limitações da evidência.
Mostre falhas e inconclusivos com o mesmo destaque que aprovações.

O exemplo de caminho é local e tem seis resultados esperados: um aprovado, quatro
reprovados e um inconclusivo. Isso testa o avaliador, não comprova segurança geral
ou integração com agentes reais. Extraia o resultado do exemplo real, sem hardcode
de números de aprovação. Não chame cumprimento de política de prova de ética.
Se apresentar uma métrica própria de caminho, documente sua definição e denominador;
não a rotule como PED/F1 do THESEUS sem implementação correspondente.

## Servidor e Docker

Use o alias SSH `apps-noclient`. Faça inventário antes de alterar o host.
O último diagnóstico encontrou 2 vCPUs, 3,7 GiB de RAM, aproximadamente 1,9 GiB
disponível e 9,8 GB de disco livre. Esses números são snapshots; meça novamente.
Preserve DocuSeal/PostgreSQL, TensorFlow/Jupyter, Ultralytics, Annif e os dois MCPs.
Não reinstale NocoDB, RustDesk, Notas ou ArxisVR. Não instale a stack Langfuse neste
escopo. MCP `langfuse-docs` dá acesso à documentação, não é o produto instalado.

Crie Dockerfiles e Compose enxutos, builds em múltiplas etapas, usuário sem root,
healthcheck e reinício controlado. Use um único processo/replica da API: o armazenamento
atual em arquivos não tem coordenação entre réplicas. Inclua a suíte inicial de 14
casos na imagem; só copiar `dist` faria a CLI usar os dois casos de fallback.

Configure `LAB_HOST=0.0.0.0` dentro do container, `LAB_PORT`, `LAB_API_TOKEN` secreto,
`LAB_DATA_DIR` em volume persistente e origens exatas quando necessário. Vincule
portas do host a `127.0.0.1`. Não entregue LAB_API_TOKEN ao navegador ou ao site público.
Proteja o painel privado com autenticação real; um proxy que injeta token mas permite
qualquer visitante executar não atende à fronteira de acesso.

Inspecione o Caddy e `/etc/caddy/ml.avilaops.com.caddy`. Escolha uma rota livre no
domínio já administrado, preserve serviços e faça backup antes da edição. Valide
Caddy antes de recarregar. Informe as URLs efetivamente implantadas; não presuma
DNS, certificados ou rotas. O site estático público deve ser separado do painel privado.

Jupyter pode receber um notebook cliente que consulta a API por HTTP com credenciais
em variáveis de ambiente. Não hospede a API dentro de um notebook nem exponha Jupyter
sem autenticação. Annif, Ultralytics e MCPs continuam privados. Não fabrique adapters:
confira contratos e autenticação antes de integrar, e preserve este escopo numérico.

THESEUS não foi confirmado como serviço neste host. `pathFidelity` é um avaliador
local inspirado no tema, sem runtime externo integrado. Não anuncie integração com
TensorFlow, THESEUS ou ERP sem chamada real instrumentada e evidência reproduzível.

## Verificação e entrega

Execute os testes do núcleo, `npm run test:custom`, `npm run test:path`, build do
frontend e testes HTTP. Valide com navegador desktop e móvel: editar, executar,
consultar histórico, inspecionar falha e inconclusivo, e tratar conflito de revisão.
Valide em Docker que uma execução permanece após reinício sem remover o volume.
Verifique acesso anônimo ao site público e bloqueio anônimo ao painel/API privada.
Confirme que nenhum serviço ML ficou exposto e que os serviços preservados funcionam.

Entregue URLs reais, screenshots, comandos de reprodução, contagens observadas,
arquivos modificados, consumo medido e procedimento de rollback. Diferencie o que
foi implementado, testado localmente, implantado e verificado publicamente. Nunca
inclua segredos no relatório. Se DNS, credencial ou licença bloquear alguma etapa,
complete as etapas independentes e registre exatamente a dependência restante.
