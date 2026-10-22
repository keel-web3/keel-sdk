import { canonicalJson } from "@keel/protocol";
import { loadStudioAgentToken, studioConnectionOrigin } from "@keel/sdk/studio-connection-node";
import type { KeelAuthoredPublishedModuleInput } from "@keel/sdk/authored-project-graph";
import type { ToolContext } from "./types.js";

/** Current configured Studio resolves the exact maintained closure. No source,
 * provider, URL or binding override is accepted from the ordinary author flow. */
export async function resolveAuthoredRuntime(context: ToolContext, input: { readonly runtime: "three"; readonly version: string; readonly chainId: number; readonly studioUrl?: string }) {
  const origin = studioConnectionOrigin(input.studioUrl);
  const token = await loadStudioAgentToken({ workspace: context.workspace.root, studioUrl: origin });
  const url = new URL("/api/agent/staging", origin);
  url.searchParams.set("runtime", input.runtime); url.searchParams.set("version", input.version); url.searchParams.set("chainId", String(input.chainId));
  const signal = AbortSignal.any([AbortSignal.timeout(90_000), ...(context.signal ? [context.signal] : [])]);
  const response = await fetch(url, { method: "GET", redirect: "error", headers: { authorization: `Bearer ${token}` }, signal });
  if (!response.ok) throw new Error(`Studio published-runtime resolution failed (HTTP ${response.status}). Preserve the project and recheck its current connection/module configuration.`);
  if (response.redirected || !/^application\/json(?:;|$)/iu.test(response.headers.get("content-type") ?? "") || Number(response.headers.get("content-length") ?? 0) > 1_200_000) throw new TypeError("Studio returned an unsupported runtime response.");
  const reader = response.body?.getReader(); if (!reader) throw new TypeError("Studio runtime response is empty.");
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 1_200_000) throw new RangeError("Studio runtime response exceeds its bounded public profile."); chunks.push(next.value); } }
  finally { await reader.cancel().catch(() => undefined); }
  const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))) as Record<string, unknown>;
  if (!body || typeof body !== "object" || Object.keys(body).some(key => !["schema", "runtime", "version", "chainId", "pin", "reader", "modules", "publicationReady", "signing", "submission"].includes(key))
    || body.schema !== "keel-authored-runtime-resolution@1" || body.runtime !== input.runtime || body.version !== input.version || body.chainId !== input.chainId || body.publicationReady !== false || body.signing !== "not-performed" || body.submission !== "not-performed"
    || !Array.isArray(body.modules) || body.modules.length !== 2) throw new TypeError("Studio resolved a different runtime, chain or authority boundary.");
  const pin = body.pin as Record<string, unknown>, selectedReader = body.reader as Record<string, unknown>;
  if (!pin || Object.keys(pin).some(key => !["blockNumber", "blockHash"].includes(key)) || typeof pin.blockNumber !== "string" || !/^\d{1,24}$/u.test(pin.blockNumber) || !/^0x[0-9a-f]{64}$/u.test(String(pin.blockHash))
    || !selectedReader || selectedReader.chainId !== input.chainId || !/^0x[0-9a-f]{64}$/u.test(String(selectedReader.builderDeploymentTransactionHash))) throw new TypeError("Studio runtime resolution lost its pinned reader receipt boundary.");
  const { authoredPublishedRuntimeProfiles, qualifyAuthoredPublishedModules } = await import("@keel/sdk/authored-project/node");
  const profiles = authoredPublishedRuntimeProfiles(input.runtime, input.version);
  const sources: KeelAuthoredPublishedModuleInput[] = [];
  for (const [index, value] of body.modules.entries()) {
    const module = value as Record<string, unknown>, profile = profiles[index]!;
    if (!module || Object.keys(module).some(key => !["binding", "sourceIntegrity", "sourceBase64", "license", "execution", "aliases", "dependencies", "fragment"].includes(key))
      || typeof module.sourceBase64 !== "string" || module.sourceBase64.length > 520_000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(module.sourceBase64)
      || module.license !== profile.license || module.execution !== profile.execution || canonicalJson(module.aliases) !== canonicalJson(profile.aliases) || canonicalJson(module.dependencies) !== canonicalJson(profile.dependencies)) throw new TypeError("Studio runtime source, license, interface or aliases changed.");
    const source = Uint8Array.from(Buffer.from(module.sourceBase64, "base64"));
    if (source.length !== profile.byteLength || Buffer.from(source).toString("base64") !== module.sourceBase64) throw new TypeError("Studio runtime source encoding changed.");
    const fragment = module.fragment as Record<string, unknown>, integrity = fragment?.integrity as Record<string, unknown>;
    if (!fragment || Object.keys(fragment).some(key => !["objectId", "integrity", "mediaType", "compression"].includes(key)) || !/^0x[0-9a-f]{64}$/u.test(String(fragment.objectId)) || fragment.compression !== "none" || fragment.mediaType !== "application/vnd.keel.token-uri-raw-percent-fragment"
      || !integrity || integrity.algorithm !== "sha256" || !/^0x[0-9a-f]{64}$/u.test(String(integrity.digest)) || !Number.isSafeInteger(integrity.byteLength) || Number(integrity.byteLength) < 1 || Number(integrity.byteLength) > 2_000_000) throw new TypeError("Studio runtime fragment commitment is invalid.");
    sources.push({ binding: module.binding as KeelAuthoredPublishedModuleInput["binding"], source });
  }
  const qualified = await qualifyAuthoredPublishedModules(sources, input.chainId);
  for (const [index, module] of body.modules.entries()) if (canonicalJson((module as Record<string, unknown>).sourceIntegrity) !== canonicalJson(qualified[index]!.sourceIntegrity)) throw new TypeError("Studio runtime decoded source commitment changed.");
  return { sources, pin: { blockNumber: pin.blockNumber, blockHash: String(pin.blockHash) }, reader: { chainId: input.chainId, builderDeploymentTransactionHash: String(selectedReader.builderDeploymentTransactionHash) } };
}
