/** Synthetic schema fixture. Signature bytes are deliberately NOT a valid signature. */
export const recipientTaxId = "19131243000197";
export const issuerTaxId = "04252011000110";
export const nfseKey = `3550308${1}${2}${issuerTaxId}${"1".padStart(13, "0")}2611${"1".padStart(9, "0")}0`;

export function nationalNfseXml(version = "1.01"): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="${version}">
  <infNFSe Id="NFS${nfseKey}">
    <xLocEmi>São Paulo</xLocEmi><xLocPrestacao>São Paulo</xLocPrestacao>
    <nNFSe>1</nNFSe><xTribNac>Serviço sintético de teste</xTribNac>
    <verAplic>fixture-1</verAplic><ambGer>1</ambGer><tpEmis>1</tpEmis>
    <cStat>100</cStat><dhProc>2026-11-03T10:00:01-03:00</dhProc><nDFSe>1</nDFSe>
    <emit><CNPJ>${issuerTaxId}</CNPJ><xNome>Serviços &amp; Companhia</xNome>
      <enderNac><xLgr>Rua de teste</xLgr><nro>1</nro><xBairro>Centro</xBairro><cMun>3550308</cMun><UF>SP</UF><CEP>01001000</CEP></enderNac>
    </emit>
    <valores><vLiq>123.00</vLiq></valores>
    <DPS versao="${version}"><infDPS Id="DPS35503082${issuerTaxId}00001000000000000001">
      <tpAmb>2</tpAmb><dhEmi>2026-11-03T10:00:00-03:00</dhEmi><verAplic>fixture-1</verAplic>
      <serie>1</serie><nDPS>1</nDPS><dCompet>2026-11-03</dCompet><tpEmit>1</tpEmit><cLocEmi>3550308</cLocEmi>
      <prest><CNPJ>${issuerTaxId}</CNPJ><xNome>Prestador sintético</xNome><regTrib><opSimpNac>1</opSimpNac><regEspTrib>0</regEspTrib></regTrib></prest>
      <toma><CNPJ>${recipientTaxId}</CNPJ><xNome>Tomador sintético</xNome></toma>
      <serv><locPrest><cLocPrestacao>3550308</cLocPrestacao></locPrest><cServ><cTribNac>010101</cTribNac><xDescServ>Inspeção offline — sem transmissão.</xDescServ></cServ></serv>
      <valores><vServPrest><vServ>123.45</vServ></vServPrest><trib><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>1</tpRetISSQN></tribMun><totTrib><indTotTrib>0</indTotTrib></totTrib></trib></valores>
    </infDPS></DPS>
  </infNFSe>
  <Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo>
    <CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>
    <SignatureMethod Algorithm="${version === "1.00" ? "http://www.w3.org/2000/09/xmldsig#rsa-sha1" : "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"}"/>
    <Reference URI="#NFS${nfseKey}"><Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/><Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/></Transforms><DigestMethod Algorithm="${version === "1.00" ? "http://www.w3.org/2000/09/xmldsig#sha1" : "http://www.w3.org/2001/04/xmlenc#sha256"}"/><DigestValue>AA==</DigestValue></Reference>
  </SignedInfo><SignatureValue>AA==</SignatureValue><KeyInfo><X509Data><X509Certificate>AA==</X509Certificate></X509Data></KeyInfo></Signature>
</NFSe>
`;
}
