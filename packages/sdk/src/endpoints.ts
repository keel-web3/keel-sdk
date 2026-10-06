import { KEEL_SEPOLIA_PUBLIC_RPC_URLS, normalizeKeelRpcUrl, resolveKeelRpcConfiguration, type KeelRpcEnvironment } from "./rpc.js";
export const KEEL_TEST_STUDIO_URL = "https://keel-test.149-28-255-65.sslip.io" as const;
export const KEEL_TEST_PUBLIC_RPC_URL = KEEL_SEPOLIA_PUBLIC_RPC_URLS[0]!;
export const KEEL_LEGACY_STRATUS_TEST_STUDIO_URL = "https://stratus-test.149-28-255-65.sslip.io" as const;
export const KEEL_LEGACY_STRATUS_TEST_PUBLIC_RPC_URL = "https://rpc.stratus-test.149-28-255-65.sslip.io" as const;

export type KeelEndpointSource = "explicit" | "environment" | "canonical-default";

export interface KeelEndpointOverrides {
  readonly studioUrl?: string;
  readonly publicRpcUrl?: string;
  readonly publicRpcUrls?: readonly string[];
  readonly indexerUrl?: string;
}

export interface KeelEndpointEnvironment extends KeelRpcEnvironment {
  readonly KEEL_STUDIO_URL?: string;
  /** Public read-only RPC override. Provider API keys must remain local. */
  readonly KEEL_PUBLIC_RPC_URL?: string;
  readonly KEEL_INDEXER_URL?: string;
  /** Deprecated compatibility input. Prefer KEEL_STUDIO_URL. */
  readonly FRAY_STUDIO_URL?: string;
}

export interface ResolvedKeelEndpoints {
  readonly schema: "keel-endpoints@1";
  readonly studioUrl: string;
  readonly publicRpcUrl: string;
  readonly publicRpcUrls: readonly string[];
  readonly indexerUrl?: string;
  readonly sources: {
    readonly studioUrl: KeelEndpointSource;
    readonly publicRpcUrl: KeelEndpointSource;
    readonly indexerUrl?: Exclude<KeelEndpointSource, "canonical-default">;
  };
  readonly compatibilityAliases: {
    readonly studioUrl: typeof KEEL_LEGACY_STRATUS_TEST_STUDIO_URL;
    readonly publicRpcUrl: typeof KEEL_LEGACY_STRATUS_TEST_PUBLIC_RPC_URL;
  };
}

/** Resolve public KEEL endpoints without reading process.env, keeping the SDK browser-safe. */
export function resolveKeelEndpoints(
  overrides: KeelEndpointOverrides = {},
  environment: KeelEndpointEnvironment = {},
): ResolvedKeelEndpoints {
  const studio = chooseEndpoint(
    overrides.studioUrl,
    environment.KEEL_STUDIO_URL ?? environment.FRAY_STUDIO_URL,
    KEEL_TEST_STUDIO_URL,
    "studioUrl",
  );
  const rpc = resolveKeelRpcConfiguration({
    ...(overrides.publicRpcUrl === undefined ? {} : { rpcUrl: overrides.publicRpcUrl }),
    ...(overrides.publicRpcUrls === undefined ? {} : { rpcUrls: overrides.publicRpcUrls }),
  }, environment);
  const publicRpcUrls = Object.freeze(rpc.rpcUrls.map(url => normalizeKeelRpcUrl(url)));
  const publicRpc = { url: publicRpcUrls[0]!, source: rpc.source === "public-default" ? "canonical-default" as const : rpc.source as "explicit" | "environment" };
  const indexer = chooseOptionalEndpoint(overrides.indexerUrl, environment.KEEL_INDEXER_URL, "indexerUrl");

  return Object.freeze({
    schema: "keel-endpoints@1",
    studioUrl: studio.url,
    publicRpcUrl: publicRpc.url,
    publicRpcUrls,
    ...(indexer === undefined ? {} : { indexerUrl: indexer.url }),
    sources: Object.freeze({
      studioUrl: studio.source,
      publicRpcUrl: publicRpc.source,
      ...(indexer === undefined ? {} : { indexerUrl: indexer.source }),
    }),
    compatibilityAliases: Object.freeze({
      studioUrl: KEEL_LEGACY_STRATUS_TEST_STUDIO_URL,
      publicRpcUrl: KEEL_LEGACY_STRATUS_TEST_PUBLIC_RPC_URL,
    }),
  });
}

function chooseEndpoint(
  explicit: string | undefined,
  environment: string | undefined,
  fallback: string,
  label: string,
): { readonly url: string; readonly source: KeelEndpointSource } {
  const validate = (value: string) => publicHttpsOrigin(value, label);
  if (explicit !== undefined) return { url: validate(explicit), source: "explicit" };
  if (environment !== undefined) return { url: validate(environment), source: "environment" };
  return { url: validate(fallback), source: "canonical-default" };
}

function chooseOptionalEndpoint(
  explicit: string | undefined,
  environment: string | undefined,
  label: string,
): { readonly url: string; readonly source: "explicit" | "environment" } | undefined {
  if (explicit !== undefined) return { url: publicHttpsOrigin(explicit, label), source: "explicit" };
  if (environment !== undefined) return { url: publicHttpsOrigin(environment, label), source: "environment" };
  return undefined;
}

function publicHttpsOrigin(value: string, label: string): string {
  if (value.length === 0 || value.length > 512) throw new TypeError(`${label} must be a bounded HTTPS URL.`);
  const url = new URL(value);
  if (
    url.protocol !== "https:"
    || url.username.length > 0
    || url.password.length > 0
    || url.search.length > 0
    || url.hash.length > 0
    || (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new TypeError(`${label} must be a credential-free HTTPS origin.`);
  }
  return url.origin;
}
