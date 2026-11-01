# Organização do ERP

Cada pasta responde a duas perguntas: qual responsabilidade tem e a quem pertence
o assunto. Esta é a estrutura do código, não um indicador de funcionalidades
prontas. O estado funcional continua em `docs/STATUS-ERP.md` e nas evidências.

As regras estão no [Ávila Experiments](https://ml.avilaops.com/experiments/policies),
nas fichas `ERP-STRUCTURE-001`, `ERP-STRUCTURE-002` e `ERP-STRUCTURE-003`.
O Experiments guarda decisões e evidências. A aplicação das regras ocorre no
repositório e no CI. Uma ficha cadastrada não executa uma refatoração nem comprova
o funcionamento do ERP.

## Aplicações e responsabilidades

```text
erp-next/
├── apps/
│   ├── web/                     interface Next.js e BFF da sessão
│   │   └── src/
│   │       ├── app/             URLs, páginas, layouts e entradas HTTP
│   │       │   └── api/         endpoints do BFF: auth, erp e health
│   │       ├── features/        funcionalidades por assunto de negócio
│   │       ├── components/      elementos visuais reutilizáveis
│   │       │   ├── ui/          botões, campos, diálogos e outros elementos básicos
│   │       │   ├── shell/       estrutura do aplicativo, navegação e tema
│   │       │   └── feedback/    avisos, recuperação de acesso e prévias
│   │       ├── hooks/           comportamento React compartilhado
│   │       ├── lib/             utilitários e cliente HTTP sem segredos
│   │       │   └── api/         cliente do BFF e tipos gerados do OpenAPI
│   │       ├── server/          código exclusivo do servidor Next.js
│   │       │   ├── auth/        sessão, cookies e configuração privada
│   │       │   └── bff/         encaminhamento autenticado para serviços
│   │       └── content/         textos MDX da ajuda
│   ├── api/                     aplicação Rust e autoridade do ERP
│   │   └── src/
│   │       ├── http/            rotas, contrato OpenAPI e testes HTTP
│   │       ├── domains/         regras comerciais e persistência por domínio
│   │       │   ├── finance/     configuração financeira junto ao financeiro
│   │       │   └── fiscal/      estado fiscal, autorização, documentos e filas
│   │       └── platform/        identidade, empresas e operação da conta ERP
│   └── fiscal-engine/           adaptador interno XML, assinatura A1, XSD e SOAP
├── migrations/                  evolução do banco
├── architecture/                mapa, regras e cadastro para o Experiments
├── verification/                catálogo de contratos, fluxos e suas evidências
├── scripts/                     ferramentas de manutenção e CI
├── docs/                        decisões e documentação funcional
└── deploy/                      configuração de publicação
```

`src/proxy.ts` e os arquivos especiais do Next.js permanecem onde o framework
os exige. `components/page-header.tsx` é um componente visual compartilhado.
Não é necessário criar uma pasta para cada arquivo.

## Onde encontrar uma funcionalidade

`features/` usa nomes técnicos em inglês. URLs e textos do produto permanecem em
português. Subpastas representam partes da mesma funcionalidade; um formulário,
hook ou configuração exclusivo de um domínio fica com esse domínio.

| Pasta em `features/` | Responsabilidade |
| --- | --- |
| `access/` | Associação à empresa, usuários, papéis e auditoria; inclui `users/`, `roles/` e `audit/` |
| `company/` | Cadastro e seleção da empresa, perfil e `account/` para assinatura do ERP |
| `fiscal/` | Documentos, emissão, recebimento, monitor, `settings/` e `certificates/` |
| `finance/` | Contas a receber, comissões e `settings/` financeiras |
| `sales/` | Pedidos de venda e demais telas comerciais |
| `purchasing/` | Pedidos de compra, recebimentos e contas a pagar vinculadas à compra |
| `returns/` | Cancelamentos comerciais e estornos de recebimentos de compra |
| `catalog/` | Produtos, variações e catálogo |
| `parties/` | Clientes e fornecedores |
| `records/` | Visão de cadastros, `details/` e formulários reutilizados em `reference/` |
| `inventory/`, `production/`, `logistics/` | Estoque, produção e logística, respectivamente |
| `contracts/`, `services/`, `staff/` | Contratos comerciais, serviços e equipe |
| `preferences/` | Busca e navegação das preferências em `search/`; preferências pessoais em `system/` |
| `data/` | `import/`, `export/` e histórico `legacy/` |
| `integrations/` | Catálogo de integrações e chaves de serviço |
| `dashboard/`, `reports/` | Painéis e relatórios |
| `assistant/`, `help/`, `workspace/` | Assistente, ajuda e aplicativos/eventos/novidades do ambiente |

As telas existentes podem ser persistentes ou demonstrativas. Reorganizar um
arquivo não muda essa condição. `lib/demonstration-routes.ts` conserva a indicação
das rotas demonstrativas. Não apagar módulos pelo nome ou pela aparência de
duplicação sem verificar quem os importa e qual comportamento atendem.

## Por que há mais de um caminho fiscal e duas APIs

O assunto é o mesmo; as responsabilidades e os processos são diferentes:

```text
app/fiscal/page.tsx                    define o endereço da tela
    → features/fiscal/                apresenta e coleta dados do usuário
    → app/api/erp/fiscal/.../route.ts  recebe a chamada no BFF
    → server/bff/erp-fiscal-proxy.ts   confere sessão, origem e limites de transporte
    → apps/api/src/domains/fiscal/    autoriza por empresa e controla a operação
    → apps/fiscal-engine/             executa a adaptação técnica XML/A1/XSD/SOAP
```

O navegador não recebe credenciais de serviço nem acessa o motor fiscal.
`app/api/erp` mantém o contrato HTTP usado pela interface e não é outro ERP.
Regras de autorização, transações e persistência pertencem à API Rust.
Os proxies possuem limites distintos de corpo, resposta e tempo; não podem ser
substituídos por um encaminhador irrestrito para simplificar a árvore.

`platform/` reúne a operação da própria plataforma: autenticação, associação a
empresas, onboarding, convites, auditoria, preferências, assinatura da conta ERP,
estado da aplicação e observabilidade. `subscriptions/` cobra o uso do ERP;
`domains/finance` trata as finanças comerciais da empresa. Configurações
financeiras comerciais foram retiradas de `platform/` e estão em
`domains/finance/settings.rs`. Uma nova regra de venda, estoque ou tributação
pertence ao domínio correspondente.

## Regras para criar ou alterar arquivos

1. Se define uma URL, use `app/`; mantenha ali a composição da página ou a entrada HTTP.
2. Se pertence a uma funcionalidade, use `features/<domínio>/`. Configurações
   ficam dentro do domínio que configuram.
3. Se contém sessão, credencial ou encaminhamento privado, use `server/` com
   `import "server-only"`. Nunca importe esse módulo em código cliente, inclusive
   por intermédio de outro módulo.
4. Se é uma peça visual reutilizável, use `components/`; elementos básicos de
   `ui/` não dependem de funcionalidades. `shell/` pode compor navegação e busca.
5. Se é um hook compartilhado, use `hooks/`. Se atende só uma funcionalidade,
   mantenha-o nela. `use-operation.ts` mantém consulta, revisão e repetição de
   comandos; não contém regras de venda ou tributação.
6. Use `lib/` para utilitários e cliente HTTP compartilhados. Ela não importa
   funcionalidades, componentes, rotas ou código privado do servidor.
7. Registre uma responsabilidade concreta em `structure.json` antes de criar um
   novo domínio. `misc`, `common` ou `utils` não explicam um assunto de negócio.

## Verificação e atualização do Experiments

O job obrigatório `context-source` executa os testes de arquitetura e
`pnpm check:architecture`, publica `architecture.json` e gera os contextos ERP.
O verificador usa a AST TypeScript para percorrer imports, reexports e imports
dinâmicos literais. Detecta cliente alcançando servidor, dependências proibidas,
retorno a locais retirados e domínios sem responsabilidade registrada. Imports
construídos dinamicamente não são resolvidos por essa inspeção; o build Next.js
e o marcador `server-only` complementam a verificação.

A superfície registrada contém 299 arquivos de página, layout e endpoint.
Alterações legítimas de URLs exigem revisão explícita e atualização de
`routeSurface` com a saída de `node scripts/architecture/check.mjs --print-routes`.
O hash verifica caminhos, não o funcionamento das rotas nem seus métodos HTTP.
Os contratos OpenAPI, testes Rust, build web e testes de navegador permanecem
obrigatórios para esses outros aspectos.

`experiments-policies.json` é a declaração versionada para o caderno privado.
Após o merge, a ficha verificada deve apontar para o commit e a execução de CI
exatos. Use a API do Experiments com `If-Match`, preserve fichas existentes e
releia a gravação. A sincronização de contextos publica o código capturado;
publicação em produção e execução funcional têm verificações separadas.
