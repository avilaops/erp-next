import { readFileSync } from "node:fs";
import { ICP_BRASIL_ROOT_V10 } from "@/lib/fiscal/icp-brasil";
import { transmit } from "@/lib/fiscal/sefaz";

/** How an envelope reaches SEFAZ: the real channel in production, a stand-in in the tests. */
export type Send = (url: string, action: string, envelope: string, certificate: { pfx: Buffer; passphrase: string }) => Promise<string>;

/** The real channel: the company's certificate, trusting only the root of ICP-Brasil (or the file that replaces it). */
export const sendToSefaz: Send = (url, action, envelope, certificate) => {
  const roots = process.env.NFE_CA_FILE;
  return transmit(url, action, envelope, { ...certificate, ca: roots ? readFileSync(roots) : ICP_BRASIL_ROOT_V10 });
};
