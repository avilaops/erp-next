# Identidade e metadados públicos • Validação de 14/11/2026

## Entrega e limites

O kit fixa sete arquivos oficiais por hash e declara 52 destinos em oito
aplicações locais. Esta PR integra o kit, a identidade do ERP e seus metadados
públicos. As alterações de marca dos demais repositórios continuam locais.

Os sitemaps publicam somente a apresentação do Mail e o acesso do ERP. O estado
de manutenção do ERP, a ausência de runtime conectado e a restauração do banco
são uma entrega distinta; responder XML não torna a operação disponível.

## Evidência

- 95 testes Cloudflare aprovados, incluindo GET/HEAD, rejeição de POST,
  independência de APP/R2/cache e paridade dos metadados com o web.
- 3 testes do utilitário de marca aprovados: caminhos externos recusados,
  integridade, ausência de escrita em erro e repetição sem alterações.
- 35 testes da infraestrutura de CI aprovados; typecheck do ERP aprovado.
- Typechecks locais de Auth, CRM, Mail e TMS aprovados antes desta integração;
  o check do site aprovou 1.091 arquivos da marca e os 81 arquivos Astro.
- A revisão independente encontrou um problema importante: nomes antigos na
  apresentação e sete títulos literais que repetiam o nome do produto.
- Dois testes de navegador reproduziram a apresentação e o título incorretos.
  Após corrigir os textos e os títulos, ambos passaram com canonical e robots.
  A verificação de navegação anterior passou inicialmente em três testes.
- Em execução posterior com quatro casos, as duas navegações privadas
  excederam a espera do título, e uma nova inicialização de desenvolvimento
  excedeu 180 s. Houve avisos de instant navigation e pouca memória local.
  Essas execuções não são apresentadas como suíte totalmente aprovada.
- O CI executa os dois testes de metadados públicos no navegador em seu runner,
  além das verificações normais. A validação completa das telas privadas
  permanece necessária antes de ativar um runtime produtivo.

## Decisões da revisão

- Ruling • Outras aplicações não entram neste merge do ERP. Seus arquivos
  locais permanecem preservados e são verificáveis pelo kit. Custo se errado:
  divergência até que cada aplicação seja integrada e publicada.
- Ruling • Disponibilidade pública e atualização dos buscadores exigem
  verificação após deploy. Custo se errado: comunicar uma publicação que o
  usuário ainda não consegue acessar.
- Ruling • O gate adicional cobre metadados públicos e títulos. Não promove
  testes sintéticos a homologação de negócios ou disponibilidade do ERP.
  Custo se errado: um problema privado escapar antes da ativação do runtime.

Não houve finding minor na revisão. A correção dos nomes não altera acesso,
dados, preços, regras fiscais nem a autenticação.

## Mail

[PR 24 do Mail](https://github.com/avilaops/mail.avilaops.com/pull/24) integrou
somente `webmail/public/robots.txt` e `sitemap.xml`, após os checks de build e
navegador. Commit integrado `c0a0b58d36cc1105dc9fdb52d321c24b982af976`.
O Render publicou esse commit no serviço existente, deploy
`dep-dbs0utd6e07s738h4en0`; ambos os endpoints retornaram HTTP 200 e o XML foi
analisado novamente, contendo somente `https://mail.avilaops.com/`.
