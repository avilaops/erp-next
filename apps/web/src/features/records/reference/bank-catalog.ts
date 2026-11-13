/** Visual identification catalog, not a list of regulated institutions.
 * Logos: Tgentil/Bancos-em-SVG at fe1d43f0cf379135bd01c987bc147a04fdf48c6d.
 * See public/banks/README.md and source-manifest.json for brand rights and provenance.
 * Codes are a deliberately small subset verified in each bank's own documentation.
 */
export type Bank = { id: string; name: string; aliases: readonly string[]; logo: string | null; code?: string; codeSource?: string; codeVerifiedAt?: string }

export const banks: readonly Bank[] = [
  {
    "id": "abc-brasil",
    "name": "ABC Brasil",
    "aliases": [
      "ABC Brasil"
    ],
    "logo": "/banks/abc-brasil.svg"
  },
  {
    "id": "ailos",
    "name": "Ailos",
    "aliases": [
      "Ailos"
    ],
    "logo": "/banks/ailos.svg"
  },
  {
    "id": "almah-conta",
    "name": "Almah Conta",
    "aliases": [
      "Almah Conta"
    ],
    "logo": "/banks/almah-conta.svg"
  },
  {
    "id": "artta",
    "name": "Artta",
    "aliases": [
      "Artta"
    ],
    "logo": "/banks/artta.svg"
  },
  {
    "id": "asaas-ip-s-a",
    "name": "Asaas IP S.A",
    "aliases": [
      "Asaas IP S.A"
    ],
    "logo": "/banks/asaas-ip-s-a.svg"
  },
  {
    "id": "bk-bank",
    "name": "BK Bank",
    "aliases": [
      "BK Bank"
    ],
    "logo": "/banks/bk-bank.svg"
  },
  {
    "id": "bnp-paripas",
    "name": "BNP Paribas",
    "aliases": [
      "BNP Paripas"
    ],
    "logo": "/banks/bnp-paripas.svg"
  },
  {
    "id": "brb-banco-de-brasilia",
    "name": "BRB - Banco de Brasília",
    "aliases": [
      "BRB - Banco de Brasilia"
    ],
    "logo": "/banks/brb-banco-de-brasilia.svg"
  },
  {
    "id": "banco-arbi",
    "name": "Banco Arbi",
    "aliases": [
      "Banco Arbi",
      "Arbi"
    ],
    "logo": "/banks/banco-arbi.svg"
  },
  {
    "id": "banco-bmg",
    "name": "Banco BMG",
    "aliases": [
      "Banco BMG",
      "BMG"
    ],
    "logo": "/banks/banco-bmg.svg"
  },
  {
    "id": "banco-bmp",
    "name": "Banco BMP",
    "aliases": [
      "Banco BMP"
    ],
    "logo": "/banks/banco-bmp.svg"
  },
  {
    "id": "banco-bs2-s-a",
    "name": "Banco BS2 S.A",
    "aliases": [
      "Banco BS2 S.A",
      "BS2"
    ],
    "logo": "/banks/banco-bs2-s-a.svg"
  },
  {
    "id": "banco-btg-pacutal",
    "name": "Banco BTG Pactual",
    "aliases": [
      "Banco BTG Pacutal",
      "BTG",
      "BTG Pactual"
    ],
    "logo": "/banks/banco-btg-pacutal.svg"
  },
  {
    "id": "banco-c6-s-a",
    "name": "Banco C6 S.A",
    "aliases": [
      "Banco C6 S.A",
      "C6",
      "C6 Bank"
    ],
    "logo": "/banks/banco-c6-s-a.svg"
  },
  {
    "id": "banco-daycoval",
    "name": "Banco Daycoval",
    "aliases": [
      "Banco Daycoval"
    ],
    "logo": "/banks/banco-daycoval.svg"
  },
  {
    "id": "banco-industrial-do-brasil-s-a",
    "name": "Banco Industrial do Brasil S.A",
    "aliases": [
      "Banco Industrial do Brasil S.A"
    ],
    "logo": "/banks/banco-industrial-do-brasil-s-a.svg"
  },
  {
    "id": "banco-inter-s-a",
    "name": "Banco Inter S.A",
    "aliases": [
      "Banco Inter S.A",
      "Inter"
    ],
    "logo": "/banks/banco-inter-s-a.svg",
    "code": "077",
    "codeSource": "https://ajuda.inter.co/conta-digital-pessoa-fisica-e-mei/qual-e-o-codigo-e-agencia-do-inter",
    "codeVerifiedAt": "2026-11-12"
  },
  {
    "id": "banco-mercantil-do-brasil-s-a",
    "name": "Banco Mercantil do Brasil S.A",
    "aliases": [
      "Banco Mercantil do Brasil S.A"
    ],
    "logo": "/banks/banco-mercantil-do-brasil-s-a.svg"
  },
  {
    "id": "banco-original-s-a",
    "name": "Banco Original S.A",
    "aliases": [
      "Banco Original S.A"
    ],
    "logo": "/banks/banco-original-s-a.svg"
  },
  {
    "id": "banco-pan",
    "name": "Banco Pan",
    "aliases": [
      "Banco Pan"
    ],
    "logo": "/banks/banco-pan.svg"
  },
  {
    "id": "banco-paulista",
    "name": "Banco Paulista",
    "aliases": [
      "Banco Paulista"
    ],
    "logo": "/banks/banco-paulista.svg"
  },
  {
    "id": "banco-pine",
    "name": "Banco Pine",
    "aliases": [
      "Banco Pine"
    ],
    "logo": "/banks/banco-pine.svg"
  },
  {
    "id": "banco-rendimento",
    "name": "Banco Rendimento",
    "aliases": [
      "Banco Rendimento"
    ],
    "logo": "/banks/banco-rendimento.svg"
  },
  {
    "id": "banco-safra-s-a",
    "name": "Banco Safra S.A",
    "aliases": [
      "Banco Safra S.A"
    ],
    "logo": "/banks/banco-safra-s-a.svg"
  },
  {
    "id": "banco-santander-brasil-s-a",
    "name": "Banco Santander Brasil S.A",
    "aliases": [
      "Banco Santander Brasil S.A",
      "Santander"
    ],
    "logo": "/banks/banco-santander-brasil-s-a.svg",
    "code": "033",
    "codeSource": "https://investimentos.santander.com.br/select/seguranca-rentabilidade",
    "codeVerifiedAt": "2026-11-12"
  },
  {
    "id": "banco-sofisa",
    "name": "Banco Sofisa",
    "aliases": [
      "Banco Sofisa"
    ],
    "logo": "/banks/banco-sofisa.svg"
  },
  {
    "id": "banco-topazio",
    "name": "Banco Topazio",
    "aliases": [
      "Banco Topazio"
    ],
    "logo": "/banks/banco-topazio.svg"
  },
  {
    "id": "banco-triangulo-tribanco",
    "name": "Banco Triângulo - Tribanco",
    "aliases": [
      "Banco Triângulo - Tribanco"
    ],
    "logo": "/banks/banco-triangulo-tribanco.svg"
  },
  {
    "id": "banco-votorantim",
    "name": "Banco BV",
    "aliases": [
      "Banco Votorantim",
      "BV",
      "Votorantim"
    ],
    "logo": null
  },
  {
    "id": "banco-da-amazonia-s-a",
    "name": "Banco da Amazônia S.A",
    "aliases": [
      "Banco da Amazônia S.A"
    ],
    "logo": "/banks/banco-da-amazonia-s-a.svg"
  },
  {
    "id": "banco-do-brasil-s-a",
    "name": "Banco do Brasil S.A",
    "aliases": [
      "Banco do Brasil S.A",
      "BB",
      "Banco do Brasil"
    ],
    "logo": "/banks/banco-do-brasil-s-a.svg",
    "code": "001",
    "codeSource": "https://blog.bb.com.br/golpe-do-falso-boleto/",
    "codeVerifiedAt": "2026-11-12"
  },
  {
    "id": "banco-do-estado-do-espirito-santo",
    "name": "Banestes",
    "aliases": [
      "Banco do Estado do Espirito Santo",
      "Banco do Estado do Espírito Santo"
    ],
    "logo": "/banks/banco-do-estado-do-espirito-santo.svg"
  },
  {
    "id": "banco-do-estado-do-para",
    "name": "Banpará",
    "aliases": [
      "Banco do Estado do Para",
      "Banco do Estado do Pará"
    ],
    "logo": "/banks/banco-do-estado-do-para.svg"
  },
  {
    "id": "banco-do-estado-do-sergipe",
    "name": "Banese",
    "aliases": [
      "Banco do Estado do Sergipe",
      "Banco do Estado de Sergipe"
    ],
    "logo": "/banks/banco-do-estado-do-sergipe.svg"
  },
  {
    "id": "banco-do-nordeste-do-brasil-s-a",
    "name": "Banco do Nordeste do Brasil S.A",
    "aliases": [
      "Banco do Nordeste do Brasil S.A",
      "BNB",
      "Banco do Nordeste"
    ],
    "logo": "/banks/banco-do-nordeste-do-brasil-s-a.svg"
  },
  {
    "id": "bank-of-america",
    "name": "Bank of America",
    "aliases": [
      "Bank of America"
    ],
    "logo": "/banks/bank-of-america.svg"
  },
  {
    "id": "banrisul",
    "name": "Banrisul",
    "aliases": [
      "Banrisul"
    ],
    "logo": "/banks/banrisul.svg"
  },
  {
    "id": "bees-bank",
    "name": "Bees Bank",
    "aliases": [
      "Bees Bank"
    ],
    "logo": "/banks/bees-bank.svg"
  },
  {
    "id": "bradesco-s-a",
    "name": "Bradesco S.A",
    "aliases": [
      "Bradesco S.A",
      "Bradesco"
    ],
    "logo": "/banks/bradesco-s-a.svg",
    "code": "237",
    "codeSource": "https://banco.bradesco/html/classic/produtos-servicos/mais-produtos-servicos/segunda-via-boleto.shtm",
    "codeVerifiedAt": "2026-11-12"
  },
  {
    "id": "caixa-economica-federal",
    "name": "Caixa Econômica Federal",
    "aliases": [
      "Caixa Econômica Federal",
      "Caixa",
      "CEF"
    ],
    "logo": "/banks/caixa-economica-federal.svg",
    "code": "104",
    "codeSource": "https://www.caixa.gov.br/seguranca/medidas-de-seguranca/Paginas/default.aspx",
    "codeVerifiedAt": "2026-11-12"
  },
  {
    "id": "capitual",
    "name": "Capitual",
    "aliases": [
      "Capitual"
    ],
    "logo": "/banks/capitual.svg"
  },
  {
    "id": "conta-simples-solucoes-em-pagamentos",
    "name": "Conta Simples Soluções em Pagamentos",
    "aliases": [
      "Conta Simples Soluções em Pagamentos"
    ],
    "logo": "/banks/conta-simples-solucoes-em-pagamentos.svg"
  },
  {
    "id": "contbank",
    "name": "Contbank",
    "aliases": [
      "Contbank"
    ],
    "logo": "/banks/contbank.svg"
  },
  {
    "id": "cora-sociedade-credito-direto-s-a",
    "name": "Cora",
    "aliases": [
      "Cora Sociedade Credito Direto S.A",
      "Cora"
    ],
    "logo": "/banks/cora-sociedade-credito-direto-s-a.svg"
  },
  {
    "id": "credisis",
    "name": "Credisis",
    "aliases": [
      "Credisis"
    ],
    "logo": "/banks/credisis.svg"
  },
  {
    "id": "cresol",
    "name": "Cresol",
    "aliases": [
      "Cresol"
    ],
    "logo": "/banks/cresol.svg"
  },
  {
    "id": "dock",
    "name": "Dock",
    "aliases": [
      "Dock"
    ],
    "logo": "/banks/dock.svg"
  },
  {
    "id": "duepay",
    "name": "DuePay",
    "aliases": [
      "DuePay"
    ],
    "logo": null
  },
  {
    "id": "efi-gerencianet",
    "name": "Efí - Gerencianet",
    "aliases": [
      "Efí - Gerencianet",
      "Efí",
      "Efi",
      "Gerencianet"
    ],
    "logo": "/banks/efi-gerencianet.svg"
  },
  {
    "id": "grafeno",
    "name": "Grafeno",
    "aliases": [
      "Grafeno"
    ],
    "logo": "/banks/grafeno.svg"
  },
  {
    "id": "ifood-pago",
    "name": "Ifood Pago",
    "aliases": [
      "Ifood Pago"
    ],
    "logo": "/banks/ifood-pago.svg"
  },
  {
    "id": "infinitepay",
    "name": "InfinitePay",
    "aliases": [
      "InfinitePay"
    ],
    "logo": "/banks/infinitepay.svg"
  },
  {
    "id": "ip4y",
    "name": "Ip4y",
    "aliases": [
      "Ip4y"
    ],
    "logo": "/banks/ip4y.svg"
  },
  {
    "id": "itau-unibanco-s-a",
    "name": "Itaú Unibanco S.A",
    "aliases": [
      "Itaú Unibanco S.A",
      "Itaú",
      "Itau"
    ],
    "logo": "/banks/itau-unibanco-s-a.svg",
    "code": "341",
    "codeSource": "https://download.itau.com.br/bankline/vendor_400.pdf",
    "codeVerifiedAt": "2026-11-12"
  },
  {
    "id": "iugo",
    "name": "Iugu",
    "aliases": [
      "Iugo",
      "Iugu"
    ],
    "logo": "/banks/iugo.svg"
  },
  {
    "id": "lets-bank-s-a",
    "name": "Lets Bank S.A",
    "aliases": [
      "Lets Bank S.A"
    ],
    "logo": "/banks/lets-bank-s-a.svg"
  },
  {
    "id": "linker",
    "name": "Linker",
    "aliases": [
      "Linker"
    ],
    "logo": "/banks/linker.svg"
  },
  {
    "id": "mufg",
    "name": "MUFG",
    "aliases": [
      "MUFG"
    ],
    "logo": "/banks/mufg.svg"
  },
  {
    "id": "magalupay",
    "name": "MagaluPay",
    "aliases": [
      "MagaluPay"
    ],
    "logo": "/banks/magalupay.svg"
  },
  {
    "id": "mercado-pago",
    "name": "Mercado Pago",
    "aliases": [
      "Mercado Pago",
      "MercadoPago"
    ],
    "logo": "/banks/mercado-pago.svg"
  },
  {
    "id": "modobank",
    "name": "ModoBank",
    "aliases": [
      "ModoBank"
    ],
    "logo": "/banks/modobank.svg"
  },
  {
    "id": "multiplo-bank",
    "name": "Múltiplo Bank",
    "aliases": [
      "Multiplo Bank"
    ],
    "logo": "/banks/multiplo-bank.svg"
  },
  {
    "id": "neon",
    "name": "Neon",
    "aliases": [
      "Neon"
    ],
    "logo": "/banks/neon.svg"
  },
  {
    "id": "nu-pagamentos-s-a",
    "name": "Nubank",
    "aliases": [
      "Nu Pagamentos S.A",
      "Nu",
      "Nu Pagamentos",
      "Nubank"
    ],
    "logo": "/banks/nu-pagamentos-s-a.svg",
    "code": "260",
    "codeSource": "https://blog.nubank.com.br/ispb-o-que-e-para-que-serve/",
    "codeVerifiedAt": "2026-11-12"
  },
  {
    "id": "omie-cash",
    "name": "Omie.Cash",
    "aliases": [
      "Omie.Cash"
    ],
    "logo": "/banks/omie-cash.svg"
  },
  {
    "id": "omni",
    "name": "Omni",
    "aliases": [
      "Omni"
    ],
    "logo": "/banks/omni.svg"
  },
  {
    "id": "orionpay",
    "name": "OrionPay",
    "aliases": [
      "OrionPay"
    ],
    "logo": "/banks/orionpay.svg"
  },
  {
    "id": "pagseguro-internet-s-a",
    "name": "PagBank / PagSeguro",
    "aliases": [
      "PagSeguro Internet S.A",
      "PagBank",
      "PagSeguro"
    ],
    "logo": "/banks/pagseguro-internet-s-a.svg"
  },
  {
    "id": "paycash",
    "name": "PayCash",
    "aliases": [
      "PayCash"
    ],
    "logo": "/banks/paycash.svg"
  },
  {
    "id": "picpay",
    "name": "PicPay",
    "aliases": [
      "PicPay"
    ],
    "logo": "/banks/picpay.svg"
  },
  {
    "id": "pinbank",
    "name": "PinBank",
    "aliases": [
      "PinBank"
    ],
    "logo": "/banks/pinbank.svg"
  },
  {
    "id": "quality-digital-bank",
    "name": "Quality Digital Bank",
    "aliases": [
      "Quality Digital Bank"
    ],
    "logo": "/banks/quality-digital-bank.svg"
  },
  {
    "id": "recargapay",
    "name": "RecargaPay",
    "aliases": [
      "RecargaPay"
    ],
    "logo": "/banks/recargapay.svg"
  },
  {
    "id": "sicoob",
    "name": "Sicoob",
    "aliases": [
      "Sicoob"
    ],
    "logo": "/banks/sicoob.svg"
  },
  {
    "id": "sicredi",
    "name": "Sicredi",
    "aliases": [
      "Sicredi"
    ],
    "logo": "/banks/sicredi.svg"
  },
  {
    "id": "sisprime",
    "name": "Sisprime",
    "aliases": [
      "Sisprime"
    ],
    "logo": "/banks/sisprime.svg"
  },
  {
    "id": "squid-solucoes-financeiras",
    "name": "Squid Soluções Financeiras",
    "aliases": [
      "Squid Soluções Financeiras"
    ],
    "logo": "/banks/squid-solucoes-financeiras.svg"
  },
  {
    "id": "starbank",
    "name": "StarBank",
    "aliases": [
      "StarBank"
    ],
    "logo": "/banks/starbank.svg"
  },
  {
    "id": "stone-pagamentos-s-a",
    "name": "Stone Pagamentos S.A",
    "aliases": [
      "Stone Pagamentos S.A"
    ],
    "logo": "/banks/stone-pagamentos-s-a.svg"
  },
  {
    "id": "sulcredi",
    "name": "Sulcredi",
    "aliases": [
      "Sulcredi"
    ],
    "logo": "/banks/sulcredi.svg"
  },
  {
    "id": "transfera",
    "name": "Transfeera",
    "aliases": [
      "Transfera",
      "Transfeera"
    ],
    "logo": "/banks/transfera.svg"
  },
  {
    "id": "unicred",
    "name": "Unicred",
    "aliases": [
      "Unicred"
    ],
    "logo": "/banks/unicred.svg"
  },
  {
    "id": "uniprime",
    "name": "Uniprime",
    "aliases": [
      "Uniprime"
    ],
    "logo": "/banks/uniprime.svg"
  },
  {
    "id": "uzzipay",
    "name": "UzziPay",
    "aliases": [
      "UzziPay"
    ],
    "logo": "/banks/uzzipay.svg"
  },
  {
    "id": "xp-investimentos",
    "name": "XP Investimentos",
    "aliases": [
      "XP Investimentos"
    ],
    "logo": "/banks/xp-investimentos.svg"
  },
  {
    "id": "zemo-bank",
    "name": "Zemo Bank",
    "aliases": [
      "Zemo Bank"
    ],
    "logo": "/banks/zemo-bank.svg"
  }
]

export function normalizeBankSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, " ").trim()
}

export function searchBanks(query: string): readonly Bank[] {
  const normalized = normalizeBankSearch(query)
  if (!normalized) return banks
  const terms = normalized.split(/\s+/)
  const code = /^\d{1,3}$/.test(normalized) ? normalized.padStart(3, "0") : null
  return banks.filter(bank => {
    if (code && bank.code === code) return true
    const haystack = normalizeBankSearch([bank.name, ...bank.aliases, bank.code || ""].join(" "))
    return terms.every(term => haystack.includes(term))
  }).sort((a, b) => Number(b.code === code) - Number(a.code === code))
}

// Recognition never rewrites the original value. Only an explicit option selection
// stores bank.name; legacy names, unknown banks and manual entries remain strings.
export function identifyBank(value: string | null | undefined): Bank | undefined {
  const query = normalizeBankSearch(value || "")
  if (!query) return undefined
  return banks.find(bank => [bank.name, ...bank.aliases].some(name => normalizeBankSearch(name) === query))
}
