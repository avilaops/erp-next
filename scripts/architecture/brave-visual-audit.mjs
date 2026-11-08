// Called from the supported Brave browser runtime in Node REPL. This module
// never launches a browser or reads authentication storage.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("../../artifacts/ui-audit/", import.meta.url));

export async function createVisualAudit(browser, tab) {
  const inventory = JSON.parse(await readFile(directory + "inventory.json", "utf8"));
  const previous = JSON.parse(await readFile(directory + "captures.json", "utf8"));
  const results = [...new Map(previous.map(result => [result.route, result])).values()];
  const links = new Set(JSON.parse(await readFile(directory + "links.json", "utf8")));
  const viewport = await browser.capabilities.get("viewport");

  async function capture(route, label) {
    const url = "http://localhost:3002" + route;
    if (await tab.url() !== url) await tab.goto(url);
    await tab.playwright.getByRole("heading").first().waitFor({ state: "visible", timeoutMs: 10000 }).catch(() => {});
    await tab.playwright.getByText(/^(Carregando|Consultando|Preparando|Validando)[^\n]*[.…]$/).first()
      .waitFor({ state: "hidden", timeoutMs: 15000 }).catch(() => {});
    const captures = [];
    for (const [name, size] of Object.entries(inventory.viewports)) {
      await viewport.reset();
      await viewport.set(size);
      for (let attempt = 0; attempt < 10; attempt++) {
        const width = await tab.playwright.evaluate(() => document.documentElement.clientWidth);
        if (Math.abs(width - size.width) <= 20) break;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      const state = await tab.playwright.evaluate(() => ({
        url: location.pathname + location.search,
        title: document.title,
        width: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        headings: [...document.querySelectorAll("h1")].filter(element => element.getClientRects().length).map(element => element.textContent),
        links: [...document.querySelectorAll("a[href]")].map(element => element.getAttribute("href")),
        text: [...document.querySelectorAll("main")].filter(element => element.getClientRects().length).map(element => element.innerText).join("\n").slice(0, 5000),
      }));
      if (Math.abs(state.width - size.width) > 20) throw new Error(`Viewport incorreto: ${route} ${name} ${state.width}`);
      state.links.forEach(link => { if (link?.startsWith("/") && !link.startsWith("/api/")) links.add(link); });
      const filename = (label || route.replaceAll("/", "_").replaceAll("?", "_") || "home") + "-" + name + ".jpg";
      let fullPage = state.height < 6000;
      let bytes;
      try { bytes = await tab.screenshot({ fullPage }); }
      catch { fullPage = false; bytes = await tab.screenshot({ fullPage: false }); }
      await writeFile(directory + filename, bytes);
      captures.push({ viewport: name, file: filename, fullPage, ...state, links: undefined });
    }
    const result = { route, captures, review: "pending" };
    const index = results.findIndex(item => item.route === route);
    if (index < 0) results.push(result); else results[index] = result;
    await writeFile(directory + "captures.json", JSON.stringify(results, null, 2));
    await writeFile(directory + "links.json", JSON.stringify([...links]));
    return { route, overflow: captures.some(item => item.scroll > item.width), loading: captures.some(item => /Carregando|Validando acesso/.test(item.text)), error: captures.some(item => /indisponível|Não foi possível/.test(item.text)) };
  }
  return { inventory, results, links, capture, resetViewport: () => viewport.reset() };
}
