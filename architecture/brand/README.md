# Identidade das aplicações • Avila Ops

O símbolo oficial é o mesmo em todas as aplicações: arco amarelo, diagonal
vermelha e triângulo azul. Reutilizar os arquivos de `assets/`, sem redesenhar,
recolorir ou substituir pela marca de um cliente.

## Nomes e títulos

Marca: **Avila Ops**, sem acento. Produtos: **Mail, CRM, ERP, E-Commerce, CMS
e TMS**. Os serviços de acesso são **Auth** e **Conta**. Preservar os domínios,
rotas e identificadores técnicos existentes.

Usar o separador **•** nos textos e títulos. Exemplos: `ERP • Avila Ops`,
`Produtos • ERP`, `Conta • Avila Ops`. Operadores e sintaxe de código mantêm
os caracteres necessários ao seu funcionamento.

## Arquivos e distribuição

`applications.json` registra os hashes SHA-256 e somente os destinos
corporativos autorizados. Os quatro ícones básicos vêm dos arquivos já usados
pelo Auth; os ícones de instalação vêm do Mail. O desenho existente é preservado.
Os ativos são locais a cada aplicação; nenhuma aba depende de uma consulta ao
site institucional para conseguir mostrar o ícone.

```powershell
node scripts/brand/application-icons.mjs --app erp --check
node scripts/brand/application-icons.mjs --all --check --source-root C:/Users/nicol/source
node scripts/brand/application-icons.mjs --all --write --source-root C:/Users/nicol/source
```

O modo padrão apenas verifica. `--write` copia os arquivos declarados após
conferir todos os hashes e caminhos. O comando não altera metadados, não faz
commit e não publica aplicações. Incluir os destinos ao adicionar um produto.

Em E-Commerce, a marca da plataforma aplica-se somente a `lojas.avilaops.com`.
Favicons, logotipos e manifestações de identidade de lojistas continuam sendo
dados de cada loja. Em CMS, os ativos corporativos pertencem ao painel; o
favicon de um site publicado continua sendo definido pelo proprietário do site.

Conferir favicon SVG, PNG 96 × 96, ICO, Apple 180 × 180, instalação 192/512
e a variante maskable separadamente. Não declarar um ícone comum como maskable
sem respeitar sua área segura. Títulos e nomes dos manifestos seguem a mesma
identidade e preservam os caminhos de abertura, escopos e permissões.

## Publicação e buscadores

Arquivo corrigido localmente não significa aplicação publicada. Verificar o
HTML e os arquivos entregues pelo domínio após o deploy. Registrar separadamente
domínios indisponíveis e mudanças ainda não publicadas.

O Google processa ícones por hostname e a atualização pode levar dias ou
semanas; a lista do Search Console não comprova a versão atual do servidor.
Preservar as regras de privacidade e `noindex` das aplicações internas.
Referência: [favicons no Google Search](https://developers.google.com/search/docs/appearance/favicon-in-search).
