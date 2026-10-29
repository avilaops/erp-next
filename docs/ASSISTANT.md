# Assistente do ERP

O assistente usa Next.js para interface e sessão, Rust para autorização e ferramentas,
e Qwen3 1.7B Q4_K_M via Ollama para inferência local. Não existe fallback pago,
RAG, banco vetorial ou ferramenta de escrita.

## Contrato e autorização

`POST /api/erp/assistant` recebe `{ "questions": ["Busque o SKU PROD-123"] }`.
O BFF exige cookie de sessão válido, origem do ERP e `X-Tenant-Id` igual à empresa
da sessão. Encaminha o bearer da pessoa e o tenant da sessão para
`POST /api/v1/assistant`. Campos extras, incluindo tenant no corpo, são recusados.

Rust verifica a identidade pelo Auth e a associação ativa à empresa antes da
inferência. Cada ferramenta revalida direitos e usa os handlers existentes:

| Ferramenta | Consulta | Permissão |
| --- | --- | --- |
| `buscar_produtos` | `catalog::list`, até 5 registros por nome ou SKU | `catalog.products.read` |
| `consultar_estoque` | `inventory::balances`, até 5 registros | `inventory.stock.read` |
| `localizar_funcionalidade` | Rotas implementadas, catálogo fechado no Rust | Permissão de leitura da tela |

As ferramentas não recebem tenant, SQL, URL, caminho de arquivo ou comandos.
Clientes, pedidos e financeiro têm navegação nesta versão; suas consultas de dados
ainda não fazem parte das ferramentas. A UI identifica a empresa ativa.

O protocolo de resposta é NDJSON com eventos `status`, `tool`, `source`, `answer`,
`error` e `done`. `source` contém somente campos selecionados pelo servidor,
origem, links internos gerados pelo Rust e total de resultados. O texto livre do
modelo é exibido como texto, sem HTML, Markdown executável ou links automáticos.

Resultados vazios e erros têm respostas determinadas pelo servidor. Falhas e
recusas de permissão encerram a consulta sem síntese. Para resultados válidos,
uma segunda inferência resume os registros; não recebe ferramentas executáveis.
Dados de ferramenta são delimitados como conteúdo não confiável. As fontes são
exibidas separadamente e continuam sendo a referência para valores exatos.
Um resumo gerado por modelo pode errar; ele não é rotulado como dado confirmado.

Histórico limitado a seis perguntas, 1.000 caracteres por pergunta e 6.000 bytes
no total; duas ferramentas por pergunta, cinco registros por ferramenta, contexto
de 4.096 tokens e até 256 tokens de saída. Uma solicitação simultânea por processo
Rust; concorrência extra recebe 429, sem fila ilimitada. A geração completa tem
timeout de 100 segundos. Cancelar fecha o stream e cancela o trabalho Rust.
O BFF propaga o cancelamento; Ollama também limita paralelismo e fila.

Conversas ficam em memória na tela e não são persistidas pelo módulo. Não são
registrados prompts, respostas, bearer tokens ou dados empresariais em logs.
Não enviar conversas reais para o repositório, CI ou fixtures.

## Modelo, licença e infraestrutura

Modelo: `qwen3:1.7b`, digest observado `8f68893c685c`, pesos Q4_K_M de 1,4 GB.
A [model card oficial](https://huggingface.co/Qwen/Qwen3-1.7B) descreve capacidade
multilíngue e ferramentas. A [licença Apache 2.0](https://huggingface.co/Qwen/Qwen3-1.7B/blob/main/LICENSE)
permite uso comercial, observadas suas condições de licença e avisos.
O nome oficial não inclui o sufixo `Instruct`.

O [protocolo de ferramentas do Ollama](https://docs.ollama.com/capabilities/tool-calling)
é usado diretamente, sem SDK externo e sem MCP administrativo. As ferramentas
MCP descobertas para contexto do ERP são documentais e não substituem o acesso
aos dados autorizado por pessoa/empresa.

Auditoria de 29/10/2026: todos os hosts têm 2 vCPUs e aproximadamente 3,7 GiB de RAM.
`applications` tinha 716 MiB disponíveis e disco em 98%; não recebeu inferência.
`apps-noclient` tinha 2,3 GiB disponíveis e 12 GB livres. Não foi identificada GPU
dedicada para inferência; o dispositivo gráfico é VirtIO, não acelerador NVIDIA.
`orchestrator` tinha 3 GiB disponíveis e 17 GB livres, mas não tinha Docker.
Não foi encontrado serviço Ollama/vLLM reaproveitável nas portas/processos auditados.

Distribuição de runtime: [alpine-docker/ollama](https://github.com/alpine-docker/ollama),
Ollama 0.40.11 para CPU, fixada por digest em `deploy/assistant-compose.yaml`.
É uma distribuição mantida por terceiros, não a imagem publicada por Ollama.
Seu Dockerfile reaproveita o binário e bibliotecas CPU da imagem upstream.
A imagem padrão do Ollama ocupava 8,48 GB; foi substituída e somente essa imagem,
instalada nesta tarefa e sem consumidores, foi removida. O volume dos pesos foi
preservado; o servidor voltou a ter aproximadamente 12 GB livres (70% de uso).

O contêiner tem limite de 2 GiB de RAM sem swap adicional e 1,5 vCPU. Uma medição
com a distribuição inicial encontrou 1,78 GiB de uso com o modelo carregado.
Primeiro teste curto: 11,2 s incluindo carga e aproximadamente 6,7 tokens/s;
chamada estruturada isolada: 11,8 s. São amostras, não SLA. Perguntas completas
incluem autorização, processamento de prompt, ferramentas e segunda inferência,
portanto demoram mais. O modelo pequeno exige perguntas objetivas e pode errar
a seleção de ferramenta ou o resumo. Fontes permanecem disponíveis para conferência.

Não há tarifa de API por token, cartão ou contratação adicional. O servidor
existente continua tendo seu custo mensal; o valor contratado não foi consultado.
CPU, memória, disco, manutenção e eventual expansão são custos de infraestrutura,
portanto a operação não deve ser descrita como custo total zero.

## Operação

Compose instalado em `apps-noclient:/opt/erp-assistant/assistant-compose.yaml`.
Ollama escuta somente `127.0.0.1:11434`. O gateway Caddy escuta na VPN,
`10.10.0.4:11436`, e permite somente `POST /api/chat` vindo de `10.10.0.2`.
UFW permite essa porta apenas de `applications`, pela interface `wg0`.
O gateway não publica pull, delete, listagem ou administração de modelos.
Não existe endpoint público de inferência. O navegador só chama o BFF.

Na API Rust, configurar em ambiente privado de deploy:

```dotenv
ERP_ASSISTANT_OLLAMA_URL=http://10.10.0.4:11436
ERP_ASSISTANT_MODEL=qwen3:1.7b
```

Sem a URL, a rota retorna 503 explícito; não muda para demonstração ou provedor pago.
As imagens do ERP devem ser construídas pelo workflow `production-release.yml`.
Nenhum build, migration ou execução de código de desenvolvimento em `applications`.
Os outros trabalhos concorrentes devem ser integrados antes de atualizar a versão
em produção; esta branch não inclui suas alterações locais não commitadas.

Para instalar a inferência em um host equivalente, criar o volume
`erp-assistant-ollama`, copiar os dois arquivos `deploy/assistant*`, executar
`docker compose -f assistant-compose.yaml up -d --no-build` e carregar
`qwen3:1.7b` pelo CLI dentro do contêiner. A regra privada de firewall e os IPs do
gateway precisam corresponder à rede autorizada. Não publicar a porta 11434.
Rollback do assistente: retirar a URL da API e reiniciar pela rotina de release;
o restante do ERP continua funcionando. Parar apenas o projeto Compose
`erp-assistant` libera RAM. Preservar o volume de modelos.

## Verificação reproduzível

`cargo test --locked --workspace -- --test-threads=2`, `cargo clippy --locked
--workspace --all-targets -- -D warnings`, `cargo fmt --all --check`, lint e build
do frontend. Testes Rust usam PostgreSQL isolado e papel sem bypass de RLS.

O workflow `assistant.yml` executa o navegador contra BFF, Rust e PostgreSQL reais,
autenticação de fixture e o modelo local real em CPU. Nada usa dados de produção.
O teste móvel intercepta apenas a resposta de inferência para reproduzir erro,
retry e interrupção de forma determinística; não representa validação de produção.

Localmente, construir a API e o frontend; iniciar um PostgreSQL isolado e Ollama.
Executar `node scripts/verify-company.mjs` com `COMPANY_TEST_DATABASE_URL`,
`PG_BINDIR`, `ERP_TEST_API_BINARY`, `ERP_ASSISTANT_OLLAMA_URL` e
`ERP_TEST_BROWSER_CONFIG=playwright.assistant.config.ts`. No Windows sem Chrome,
usar `ERP_BROWSER_CHANNEL=msedge`. O harness cria e remove somente seu banco
efêmero e seu papel de teste; não usa o banco do ERP.
