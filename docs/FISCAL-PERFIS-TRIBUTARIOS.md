# Perfis tributários reutilizáveis

Os perfis continuam versionados por empresa em `registration_settings`, com
permissão de gestão, revisão otimista e auditoria. Salvar ou aplicar um perfil
não cria emissão, reserva número ou transmite dados à SEFAZ.

Além da natureza, PIS/COFINS e classificação IBS/CBS existentes, o campo
opcional `defaults` guarda CSTs de ICMS, PIS, COFINS e IPI, enquadramento do
IPI, alíquotas IBS estadual/municipal e CBS e as opções de consumidor final,
inclusão do IPI no ICMS e exclusão do ICMS das contribuições.

Perfis antigos sem esse campo mantêm seu comportamento. Campos opcionais
vazios não escolhem tratamento fiscal. Alíquotas aceitam até quatro casas e
são armazenadas com quatro casas; zero e `false` são valores declarados.
Códigos preservam zeros à esquerda e são limitados ao recorte do emissor.

## Aplicação ao rascunho

A aplicação explícita mantém o comportamento de copiar natureza, PIS/COFINS
e classificação IBS/CBS. Os padrões adicionais completam apenas campos
vazios: CSTs dos itens, IPI, alíquotas IBS/CBS e opções das bases. Valores já
declarados, incluindo `false` e alíquota zero, permanecem no rascunho. CST do
ICMS não substitui CSOSN. CFOP, origem, condição de contribuinte e alíquotas de
ICMS/IPI continuam dependentes dos itens e da operação.

## Valores fornecidos pela Ludus

As imagens `031855`, `031910`, `031946` e `031959`, de 05/11/2026, documentam
as linhas importada e nacional. Os dois padrões têm ICMS 00, PIS/COFINS 01,
alíquotas 1,65% e 7,6%, IBS/CBS 000/000001, IBS 0,1% estadual e 0% municipal,
CBS 0,9% e as três opções de venda/bases marcadas. O IPI é CST 50 na importada
e 53 na nacional, com enquadramento 999. Não há alíquota única de IPI declarada
para todos os produtos.

Naturezas correspondentes conservam os CFOPs fornecidos: 5101/6101 na
importada e 5102/6102 na nacional. O cadastro separado de naturezas mantém a
seleção explícita dos CFOPs; este registro transcreve a origem e não revisa
o enquadramento fiscal da empresa.
