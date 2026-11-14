import { render } from 'takumi-js';
import { readFile, writeFile } from 'node:fs/promises';

// Public product artwork only. Never include company records or credentials.
const symbol = await readFile(new URL('../public/brand/avila-erp-symbol.svg', import.meta.url));
const symbolUrl = `data:image/svg+xml;base64,${symbol.toString('base64')}`;
const html = `<div style="width:1200px;height:630px;background:#17202c;color:#fff;padding:56px;display:flex;flex-direction:column;font-family:Geist">
  <div style="display:flex;justify-content:space-between;align-items:center;font-size:24px"><div style="display:flex;align-items:center;gap:14px"><img src="${symbolUrl}" width="50" height="50"/><span>ERP</span></div><span style="font-size:16px;color:#d6dce5">AVILA OPS • GESTÃO INTEGRADA</span></div>
  <div style="display:flex;gap:48px;align-items:center;flex:1">
    <div style="width:570px"><div style="font-size:16px;color:#ffbf00;letter-spacing:3px;margin-bottom:22px">CADA ETAPA, CONECTADA.</div><div style="font-size:70px;line-height:1.04;letter-spacing:-3px;font-weight:600">Sua operação,<br/><span style="color:#fff">sob controle.</span></div><div style="font-size:23px;color:#d6dce5;line-height:1.5;margin-top:25px">Produtos, vendas e financeiro.<br/>Uma visão para seguir em frente.</div></div>
    <div style="width:465px;border:1px solid #536172;background:#263343;border-radius:22px;padding:28px;display:flex;flex-direction:column;gap:12px"><div style="font-size:16px;color:#ffbf00;margin-bottom:12px">DA BASE AO RESULTADO</div>${[['01','Cadastre','Produtos e clientes'],['02','Venda','Pedidos e próximos passos'],['03','Movimente','Estoque e recebíveis']].map(([n,t,d])=>`<div style="display:flex;gap:18px;padding:16px;background:#fff;color:#17202c;border-radius:12px;align-items:center"><span style="font-size:18px;color:#0759f8">${n}</span><div><div style="font-size:25px;font-weight:600">${t}</div><div style="font-size:16px;margin-top:4px;color:#526176">${d}</div></div></div>`).join('')}</div>
  </div><div style="display:flex;justify-content:space-between;border-top:1px solid #536172;padding-top:18px;font-size:16px;color:#d6dce5"><span>Uma equipe. A mesma informação.</span><span>avilaops.com/erp</span></div>
</div>`;
const bytes = await render(html, { width:1200, height:630 });
await writeFile(new URL('../public/erp-social.png', import.meta.url), bytes);
console.log(`Generated erp-social.png (${bytes.length} bytes)`);
