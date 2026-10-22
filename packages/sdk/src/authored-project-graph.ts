import { canonicalJson, createIntegrity, type Integrity } from "@keel/protocol";
import type { KeelStudioStagedProjectFile } from "./studio-upload.js";

export const KEEL_AUTHORED_PROJECT_PROTOCOL = "keel-authored-project@1" as const;
/** Retained private source metadata; never a paid collector resource. */
export const KEEL_AUTHORED_PROJECT_DESCRIPTOR_PATH = "keel-authored-project.json" as const;
export interface KeelAuthoredModule {
  /** Stable functional name, independent of bytes, version and storage chunks. */
  readonly id: string;
  readonly purpose: string;
  readonly source: string;
}
export interface KeelAuthoredProjectInput {
  readonly title: string;
  readonly chainId: number;
  readonly modules: readonly KeelAuthoredModule[];
  readonly start: { readonly module: string; readonly export: string };
  readonly stylesheet?: string;
  readonly assets?: readonly { readonly path: string; readonly purpose: string; readonly mediaType: string; readonly bytes: Uint8Array }[];
}
export interface KeelAuthoredProjectNode {
  readonly id: string;
  readonly path: string;
  readonly purpose: string;
  readonly mediaType: string;
  readonly role: "entrypoint" | "module" | "style" | "data";
  readonly format: "asset" | "es-module";
  readonly integrity: Integrity & { readonly byteLength: number };
}
export interface KeelAuthoredProjectEdge {
  readonly consumer: string;
  readonly dependency: string;
  readonly specifier: string;
}
export interface KeelAuthoredProjectGraph {
  readonly schema: typeof KEEL_AUTHORED_PROJECT_PROTOCOL;
  readonly origin: "agent-authored";
  readonly architecture: "logical-es-modules";
  readonly chainId: number;
  readonly entrypoint: "index.html";
  readonly nodes: readonly KeelAuthoredProjectNode[];
  readonly edges: readonly KeelAuthoredProjectEdge[];
  readonly digest: Integrity;
  readonly publicationReady: false;
}

/** Browser-safe exact commitment boundary; Node authoring also parses imports. */
export async function assertKeelAuthoredProjectCommitments(graph: KeelAuthoredProjectGraph, files: readonly KeelStudioStagedProjectFile[]): Promise<void> {
  if (!graph || graph.schema !== KEEL_AUTHORED_PROJECT_PROTOCOL || graph.origin !== "agent-authored" || graph.architecture !== "logical-es-modules" || graph.entrypoint !== "index.html" || graph.publicationReady !== false || !Number.isSafeInteger(graph.chainId) || graph.chainId < 1 || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || graph.nodes.length < 4 || graph.nodes.length > 131 || graph.edges.length > 4096) throw new TypeError("Invalid authored project graph.");
  if (Object.keys(graph).some(key => !["schema", "origin", "architecture", "chainId", "entrypoint", "nodes", "edges", "digest", "publicationReady"].includes(key))) throw new TypeError("Unsupported authored graph field.");
  const { digest, ...content } = graph;
  if (canonicalJson(await createIntegrity(new TextEncoder().encode(canonicalJson(content)))) !== canonicalJson(digest)) throw new TypeError("Authored graph commitment changed.");
  if (files.length !== graph.nodes.length || new Set(files.map(file => file.path)).size !== files.length || new Set(graph.nodes.map(node => node.id)).size !== graph.nodes.length || new Set(graph.nodes.map(node => node.path)).size !== graph.nodes.length) throw new TypeError("Authored staging membership changed.");
  const ids = new Set(graph.nodes.map(node => node.id));
  for (const edge of graph.edges) if (!ids.has(edge.consumer) || !ids.has(edge.dependency) || typeof edge.specifier !== "string" || !edge.specifier || /[\\?#\u0000-\u001f\u007f]/u.test(edge.specifier)) throw new TypeError("Invalid authored dependency edge.");
  for (const node of graph.nodes) {
    if (node.id !== node.path || !/^(?:index\.html|main\.js|style\.css|modules\/[a-z][a-z0-9-]*\.js|assets\/[a-z][a-z0-9._-]*)$/u.test(node.path)) throw new TypeError("Authored logical identity changed.");
    const file = files.find(item => item.path === node.path);
    if (!file || file.role !== node.role || file.format !== node.format || file.mediaType !== node.mediaType) throw new TypeError(`Authored component changed: ${node.path}.`);
    const bytes = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(await file.bytes.arrayBuffer());
    if (canonicalJson(await createIntegrity(bytes)) !== canonicalJson(node.integrity)) throw new TypeError(`Authored source changed after planning: ${node.path}.`);
  }
}
