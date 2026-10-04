import { planKeelAssetPresentation } from '@keel/sdk/presentation';
import { layeredHTML } from './layered-project.mjs';

/** Measure the creator's direct presentation without adding verification code.
 * Electron's existing direct-preview routes still serve files and objects;
 * unsupported publication inputs are reported without replacing that route. */
export async function creatorOwnedPreviewMeasurement({ store, project, sdk, payloadStorage }) {
  const objects = store.read().state.objects;
  const selected = project.presentation.entryObjectId && objects.find(object => object.id === project.presentation.entryObjectId);
  const attached = objects.filter(object => project.objectIds.includes(object.id));
  const files = project.files ?? [];
  const runtimeModules = project.runtimeModules ?? [];
  const htmlType = type => /^text\/html(?:;|$)/iu.test(type ?? '');
  const entry = files.find(file => file.name === 'index.html' && htmlType(file.type));
  const source = selected ? store.object(selected.id) : project.layered
    ? Buffer.from(layeredHTML(project.layered, undefined, true, Object.fromEntries(objects.map(object => [object.id, object.type]))))
    : entry ? Buffer.from(entry.content) : undefined;
  let html;
  let malformedHTML = false;
  if (source && (!selected || htmlType(selected.type))) {
    try { html = new TextDecoder('utf-8', { fatal: true }).decode(source); }
    catch { malformedHTML = true; }
  }
  // A selected object is exactly the direct object response. Other project
  // files are not part of that response. An ordinary project entry can use its
  // adjacent files, objects and runtimes through the existing local protocol.
  const originalByteLength = selected ? source.byteLength
    : files.reduce((sum, file) => sum + Buffer.byteLength(file.content), 0)
      + attached.reduce((sum, object) => sum + object.byteLength, 0)
      + runtimeModules.reduce((sum, module) => sum + module.byteLength, 0);
  const unsupported = reason => {
    const plan = planKeelAssetPresentation({ originalByteLength, compressedByteLength: originalByteLength, mode: project.presentation.delivery, viewer: 'none' });
    plan.warnings.push({ code: 'creator-owned-publication-unsupported', message: reason,
      remedy: 'Keep the direct preview and source bytes. Publication needs an explicit compatible creator-owned reader/composer; no verification wrapper or encoded sibling is generated.' });
    return { payloadStorage, viewer: 'none', canonicalProtection: false, html,
      byteLength: source?.byteLength, saver: null, uploads: null, plan,
      publicationMeasurement: { status: 'unsupported', reason, graphByteLength: null, completeTokenUriByteLength: null },
      evidence: 'local-source-measurement-only', published: false };
  };
  if (malformedHTML) return unsupported('Creator-owned Inline publication measurement requires valid UTF-8 HTML. The supplied source bytes remain unchanged.');
  if (!source || html === undefined) return unsupported('Creator-owned Inline publication measurement currently requires self-contained UTF-8 HTML. Direct media retains its existing direct preview and immutable source.');
  if (!selected && (project.layered || files.some(file => file !== entry) || attached.length || runtimeModules.length)) {
    return unsupported('This creator-owned direct preview uses separate project inputs. Its publication graph has not been measured with a compatible creator-owned reader/composer.');
  }
  let prepared;
  try { prepared = await sdk.buildKeelCreatorOwnedInlineDocument({ source, payloadStorage }); }
  catch (error) { return unsupported(`Creator-owned Inline publication measurement is unavailable: ${error instanceof Error ? error.message : 'the source is unsupported'}`); }
  const { root, graph } = prepared;
  const saver = { carriage: 'raw-percent', completeDocumentBase64Layers: 0,
    graphByteLength: graph.fragmentBytes.byteLength, creatorPublicationBytes: graph.creatorPublicationBytes,
    requiredBuilder: 'KeelRawTokenURIBuilder' };
  const uploads = { creatorByteLength: source.byteLength, creatorCompressedByteLength: source.byteLength,
    creatorPublicationBytes: graph.creatorPublicationBytes, sharedOriginalByteLength: 0,
    sharedCompressedByteLength: 0, sharedPublicationBytes: 0, modules: [], reuseStatus: 'creator-owned-no-canonical-bindings' };
  return { payloadStorage, viewer: 'none', canonicalProtection: false,
    storageEncoding: 'prepared-raw-percent-fragment', html: Buffer.from(root.rootBytes).toString('utf8'),
    byteLength: root.byteLength, saver, uploads,
    plan: planKeelAssetPresentation({ originalByteLength: source.byteLength, compressedByteLength: source.byteLength,
      graphByteLength: saver.graphByteLength, mode: project.presentation.delivery, viewer: 'none' }),
    publicationMeasurement: { status: 'measured', scope: 'creator-owned-prepared-copy-graph', completeTokenUriByteLength: null },
    evidence: 'local-byte-verification-only', published: false };
}
