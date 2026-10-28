# Integração do laboratório no ERP — 28/10/2026

Destino: `avilaops/erp-next`, pasta `experiments/`, a partir de `1569e8f`.
Origem: `avilaops/experiments`, revisão `fb2262d`.
Base de comparação: primeiro commit independente, `5eec1b7`.

## Conteúdo integrado

Importados os arquivos versionados da origem, com merge de três vias nos
arquivos já existentes. Permanecem os documentos, evidências, scripts,
consumidor de verificação e ZIPs históricos exclusivos da cópia no ERP.
Nenhum `.git`, dependência instalada, configuração privada ou artefato local
não versionado foi copiado. O checkout independente permanece inalterado.

Conflitos resolvidos:

- `API.md`: preservada a documentação existente e acrescentado o contrato de
  importação de políticas.
- `dashboard/build.mjs`: mantida a publicação limpa de evidências e incorporada
  a folha de estilos das políticas tanto no painel quanto na exportação.
- `dashboard/test/export.test.mjs`: adotada a fixture da origem, que conserva
  a estrutura relativa necessária ao contrato compartilhado de políticas.

O workflow aninhado da origem não foi copiado: GitHub Actions só descobre
workflows na raiz do repositório. Sua validação foi incorporada ao job
`experiments` do CI existente do ERP, usando os lockfiles npm do laboratório.
O laboratório continua separado dos workspaces pnpm e da API transacional do ERP.
Não há execução, build, migração ou deploy de aplicação no servidor nesta integração.

## Verificação

O job `experiments` executa testes do núcleo, build e testes do dashboard,
regressões Chromium e o harness de interface. Evidências ficam no artefato
`experiments-ui-<run>-<attempt>`. A execução e seu resultado devem ser consultados
no PR desta integração. Evidências históricas importadas não são resultados
de uma nova execução nem comprovam a implantação desta cópia.

O workflow independente de imagens e seu processo de deploy continuam sob
`avilaops/experiments`; esta integração não publica imagens nem altera produção.
