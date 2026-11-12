# Clientes e fornecedores: dados fiscais e recuperação

Execução autorizada pelo usuário em 12/11/2026, após a auditoria dos cadastros. Este documento registra decisões de implementação; não representa revisão separada pelo usuário.

O cadastro deve guardar a classificação ICMS declarada (1 contribuinte, 2 contribuinte isento, 9 não contribuinte) e a IE. Ausência de informação permanece desconhecida. A consulta de CNPJ não declara situação tributária. `fiscal` omitido preserva o valor no PUT; null limpa; objeto substitui atomicamente. Registros antigos continuam válidos. Revisão, permissões, isolamento por empresa, auditoria e idempotência existentes são preservados.

Edições ficam em sessionStorage, isoladas por empresa, sessão e cadastro. Recuperação conserva a revisão original, o comando POST e sua chave, inclusive após resposta perdida. Conteúdo inválido ou armazenamento indisponível gera mensagem e impede um novo POST sem proteção. Navegação pede confirmação quando há edição, gravação pendente ou resultado incerto. Respostas tardias não podem navegar ou gravar rascunhos de outra instância.

A seleção de cliente na NF-e copia a classificação declarada, sem inferir alíquotas, CFOP, consumidor final ou regime. Indicador desconhecido continua exigindo preenchimento. O motor mantém compatibilidade com o booleano legado; indicador explícito deve ser consistente com ele. Isento não envia IE; não contribuinte pode ter IE. NFC-e e exterior mantêm seus recortes. Referências: XSD oficial vendorizado leiauteNFe_v4.00.xsd e MOC 7, https://www.confaz.fazenda.gov.br/legislacao/arquivo-manuais/moc7-anexo-i-leiaute-e-rv.pdf.

O pacote inclui testes de contrato e navegador, publicação verificável e preenchimento IBGE apenas quando CEP, município e UF conferirem. Nenhuma inscrição ou classificação fiscal real será inventada. Demais pacotes continuam: categorias/subcategorias, acabamentos independentes fiéis ao catálogo, importação/exportação ampliada e aceitação integrada. Durante a execução, o usuário suspendeu o preenchimento nacional/Core e excluiu os dez modelos sem correspondente do escopo de cadastro.
