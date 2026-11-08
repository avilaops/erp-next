# Organização da interface

O frontend permanece em Next.js e React. MDX contém apresentação e composição;
hooks e modelos de domínio continuam em TypeScript. URLs existentes são
preservadas.

| Camada | Responsabilidade | Limite |
| --- | --- | --- |
| `app` | Rotas, metadados e composição no servidor | Não concentrar regras de negócio |
| `content` | Conteúdo e composição MDX | Não consultar APIs, sessão ou banco |
| `features` | Telas e comportamento por domínio | Não importar rotas de `app` |
| `components/workspace` | Títulos, tabelas, paginação e estados | Receber dados por propriedades; não importar domínios |
| `components/ui` | Controles básicos | Não conhecer domínios nem servidor |
| `hooks` | Comportamento React compartilhado | Hooks exclusivos ficam em `features` |
| `lib` | Utilitários puros e cliente HTTP | Não importar camadas superiores |
| `server` | Sessão e adaptadores BFF | Exigir `server-only`; não importar interface |

Em relatórios, `report-model.ts` calcula indicadores e prepara linhas;
`use-report-data.ts` consulta os recursos; as telas compõem a apresentação.
`lib/csv-export.ts` serializa e exporta CSV. O componente cliente de Serviços
não importa mais a verificação de sessão de Contas a Receber: a rota de
cobranças faz essa composição no servidor.

## Contrato visual

- Títulos usam `PageHeader` ou `PageTitle`.
- Tabelas de domínio usam `DataTable`, mantendo HTML semântico e propriedades
  nativas. O contêiner da tela controla rolagem horizontal.
- Controles usam os tokens e componentes compartilhados. O CSS do workspace
  padroniza campos, tabelas, abas e ações; a apresentação pública tem direção
  visual própria.
- Navegação mantém divisores entre grupos; subtítulos redundantes são omitidos.
- Estados de carregamento, erro e vazio possuem componentes comuns.
- Formulários e dados operacionais preservam autorização, revisão e auditoria.

## Verificação

`pnpm check:architecture` verifica também imports MDX e dependências transitivas
entre cliente e servidor. `pnpm test:architecture` inclui os testes de limites
e dos modelos de relatórios. ESLint impede novos títulos e tabelas nativos
nas funcionalidades, e imports de domínio nos componentes básicos.

A superfície de rotas foi reconciliada com 470 arquivos de página, layout e
endpoint. Os 20 novos arquivos já presentes no trabalho incluem 19 endpoints
de lançamentos/transferências financeiras, inventários, logística e ordens de
serviço, além da página do relatório executivo. O verificador considera arquivos
novos e exclui arquivos removidos do diretório de trabalho.

## Auditoria visual

`node scripts/architecture/visual-inventory.mjs` enumera todas as páginas em
`artifacts/ui-audit/inventory.json`. O inventário não declara aprovação visual.
Capturas desktop (1440 × 1000) e mobile (390 × 844) ficam nesse diretório.
Rotas dinâmicas exigem registros e links reais observados na interface.

`brave-visual-audit.mjs` recebe a aba autorizada do runtime Brave. Não inicia um
navegador independente nem lê o armazenamento da sessão. `visual-review.py`
monta folhas de comparação locais; `visual-report.py` gera a galeria `index.html`
e o inventário de limitações em `report.json`. Imagens reduzidas pelo navegador,
capturas parciais e módulos indisponíveis são identificados, não aprovados
automaticamente.

Falhas de consulta só oferecem recuperação de login quando o status é 401.
Indisponibilidade do serviço não equivale a sessão expirada. Mensagens de parser
e transporte em logística e serviços usam `lib/api/error-message.ts`.

Cada captura deve registrar URL, tamanho, carregamento concluído, redirecionamento,
eventual erro e revisão visual. Abas, menus e estados relevantes precisam de
capturas adicionais. Tela de login ou indisponibilidade não comprova a interface
operacional. A revisão confere hierarquia, espaçamento, tabelas, formulários,
contraste, foco e rolagem; erros encontrados precisam de nova captura após ajuste.
