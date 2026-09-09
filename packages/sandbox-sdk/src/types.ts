import type {
  ArtifactManifest,
  ManifestValidationIssue,
  ProjectComponentCommitmentEntry,
  ProjectRevisionEvaluation,
  KeelComponentFormat,
  KeelComponentRole,
  KeelComponentUpdatePolicy,
} from "@keel/protocol";
import type { KeelDataValue } from "@keel/sdk/onchain-data";
import type { PreparedStudioArtifact, StudioStackComponentInput } from "@keel/studio-core";
import type { ResolutionAudit, SandboxDocument } from "@keel/viewer";

export type SandboxDiagnosticLevel = "pass" | "info" | "warning" | "error";

export interface SandboxDiagnostic {
  readonly level: SandboxDiagnosticLevel;
  readonly code: string;
  readonly title: string;
  readonly message: string;
  readonly componentId?: string;
}

/** One on-chain data fragment found in a project, and what it will publish. */
export interface SandboxDataLayer {
  readonly resourceId: string;
  readonly phase: "data";
  readonly weight: number;
  /** Position among the project's scripts once the data phase has sorted. */
  readonly order: number;
  /** The global creator code reads, e.g. `KEEL` for `KEEL.data.health`. */
  readonly globalName: string;
  readonly chainId: number;
  readonly blockNumber: number;
  readonly variables: readonly string[];
  readonly values: Readonly<Record<string, KeelDataValue>>;
}

export interface SandboxDataLayerFault {
  readonly resourceId: string;
  readonly message: string;
}

export interface SandboxInspectionReport {
  readonly schema: "keel-sandbox-report@1";
  readonly valid: boolean;
  readonly manifestId: string;
  readonly revision: number;
  readonly protocolIssues: readonly ManifestValidationIssue[];
  readonly diagnostics: readonly SandboxDiagnostic[];
  /** Canonical hashes consumed by Studio, updater apps, CI, and AI tooling. */
  readonly componentCommitments: readonly ProjectComponentCommitmentEntry[];
  readonly projectRevision?: ProjectRevisionEvaluation;
  /** Empty unless the caller supplied resource bytes to read the fragments from. */
  readonly dataLayers: readonly SandboxDataLayer[];
  readonly summary: {
    readonly resources: number;
    readonly components: number;
    readonly libraries: number;
    readonly decodedBytesDeclared: number;
    readonly locked: number;
    readonly manual: number;
    readonly automatic: number;
    readonly dataVariables: number;
  };
}

export interface SandboxProjectFile {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly mediaType?: string;
  readonly component?: StudioStackComponentInput;
}

export interface SandboxProjectInput {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly files: readonly SandboxProjectFile[];
  readonly creator?: string;
  readonly revision?: number;
  readonly parentRevision?: number;
  readonly previousManifest?: ArtifactManifest;
  readonly manualApproval?: boolean;
}

export interface PreparedSandboxProject {
  readonly prepared: PreparedStudioArtifact;
  readonly report: SandboxInspectionReport;
  readonly audit: ResolutionAudit;
  readonly sandbox: SandboxDocument;
}

export interface DetectedComponent {
  readonly label: string;
  readonly role: KeelComponentRole;
  readonly format: KeelComponentFormat;
  readonly updates: KeelComponentUpdatePolicy;
}
