import { render } from 'takumi-js';
import { writeFile } from 'node:fs/promises';

// Public product artwork only. Never include company records or credentials.
const html = `<div style="width:1200px;height:630px;background:#103f3b;color:#fff;padding:56px;display:flex;flex-direction:column;font-family:Geist">
  <div style="display:flex;justify-content:space-between;align-items:center;font-size:24px"><div style="display:flex;align-items:center;gap:14px"><div style="background:#c5f277;color:#103f3b;border-radius:12px;padding:9px 16px;font-weight:700">A</div><span>Ávila ERP</span></div><span style="font-size:16px;color:#b5d6cb">ÁVILA OPS / GESTÃO INTEGRADA</span></div>
  <div style="display:flex;gap:48px;align-items:center;flex:1">
    <div style="width:570px"><div style="font-size:16px;color:#c5f277;letter-spacing:3px;margin-bottom:22px">CADA ETAPA, CONECTADA.</div><div style="font-size:70px;line-height:1.04;letter-spacing:-3px;font-weight:600">Sua operação,<br/><span style="color:#c5f277">sob controle.</span></div><div style="font-size:23px;color:#d1e3dc;line-height:1.5;margin-top:25px">Produtos, vendas e financeiro.<br/>Uma visão para seguir em frente.</div></div>
    <div style="width:465px;border:1px solid #548078;background:#1c514a;border-radius:22px;padding:28px;display:flex;flex-direction:column;gap:12px"><div style="font-size:16px;color:#c5f277;margin-bottom:12px">DA BASE AO RESULTADO</div>${[['01','Cadastre','Produtos e clientes'],['02','Venda','Pedidos e próximos passos'],['03','Movimente','Estoque e recebíveis']].map(([n,t,d])=>`<div style="display:flex;gap:18px;padding:16px;background:#f4f7f1;color:#103f3b;border-radius:12px;align-items:center"><span style="font-size:18px;color:#47675c">${n}</span><div><div style="font-size:25px;font-weight:600">${t}</div><div style="font-size:16px;margin-top:4px;color:#4c655c">${d}</div></div></div>`).join('')}</div>
  </div><div style="display:flex;justify-content:space-between;border-top:1px solid #416b62;padding-top:18px;font-size:16px;color:#b5d6cb"><span>Uma equipe. A mesma informação.</span><span>avilaops.com/erp</span></div>
</div>`;
const bytes = await render(html, { width:1200, height:630 });
await writeFile(new URL('../public/erp-social.png', import.meta.url), bytes);
console.log(`Generated erp-social.png (${bytes.length} bytes)`);
