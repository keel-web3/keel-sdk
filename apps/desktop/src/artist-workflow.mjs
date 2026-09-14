import { KEEL_ENGINE_CHOICES, planKeelProject, parseKeelEngineIntent } from '@keel/sdk/engine';

// Presentation copy only. Available choices and validation stay in the shared SDK.
export const CHOICE_COPY = {
  outcome: {
    explore: ['Keep creating', 'Work privately on this computer. No wallet or network needed.'],
    'storage-only': ['Preserve a work', 'Store the original without offering a collectible.'],
    release: ['Offer a collectible', 'Prepare a unique work, edition, series or auction.'],
    module: ['Share a creative resource', 'Prepare reusable code or resources for other works.'],
  },
  runtime: {
    'static-media': ['Image, film, sound or model', 'Start with a file you have already made.'],
    html: ['Interactive webpage', 'Your HTML, styles and scripts work together.'],
    p5: ['p5.js sketch', 'Creative coding with the p5.js library.'],
    three: ['3D with Three.js', 'A scene using the Three.js runtime.'],
    'doom-wasm': ['Playable Doom work', 'A game using the declared Doom runtime.'],
    'flash-ruffle': ['Flash work', 'A Flash animation or game played through Ruffle.'],
  },
  family: { ethereum: ['EVM networks', 'Ethereum and compatible networks.'], tezos: ['Tezos', 'Use a Tezos network and its own release tools.'] },
  storage: {
    inline: ['Complete onchain presentation', 'Open the work as one self-contained file. Size and read limits still apply.'],
    native: ['Original files onchain', 'Preserve files as contract objects, with direct retrieval.'],
    hybrid: ['Onchain with network loading', 'The viewer assembles onchain files through network calls.'],
    ipfs: ['IPFS file storage', 'Keep files on IPFS with an onchain reference. Availability needs a gateway or IPFS client.'],
    wake: ['Transaction-history archive', 'Advanced route. Recovery and viewer support need additional checks.'],
  },
  releaseType: {
    'one-of-one': ['One unique work', 'A single collectible.'],
    'limited-edition': ['Limited edition', 'A fixed number of copies.'],
    'open-edition': ['Open edition', 'No fixed supply in this plan; set the collection window later.'],
    series: ['A series', 'Several distinct works in a collection.'],
  },
  collection: {
    'tezos-fa2': ['My Tezos collection', 'A Tezos FA2 collection with standard collectible metadata.'],
    erc721a: ['My own collection', 'A dedicated collection for unique works (ERC-721A).'],
    erc721: ['Standard unique-work collection', 'A dedicated ERC-721 collection for compatibility.'],
    erc1155: ['My own editions', 'A dedicated collection with a supply for each work (ERC-1155).'],
    'shared-erc1155': ['Shared collection infrastructure', 'Your editions use a shared ERC-1155 contract.'],
    existing: ['Use a collection I already have', 'Choose its exact contract on the selected network.'],
    external: ['Use another custom contract', 'Import its controls and check whether its release method is supported.'],
  },
  mintSystem: {
    'admin-mint': ['Send to chosen recipients', 'You decide which wallets receive the work.'],
    'mint-gate': ['A sale or claim', 'Set who can collect, with optional eligibility rules.'],
    'one-mint': ['A drop in phases', 'Arrange allowlist, public, claim or other supported phases.'],
    'fray-auction': ['A Fray auction', 'Continue with the four-preset Fray auction intake.'],
  },
  access: {
    public: ['Anyone', 'No eligibility gate.'], allowlist: ['People on a list', 'An allowlist with proofs.'],
    erc20: ['Token holders', 'Require a balance of a chosen ERC-20 token.'],
    erc721: ['Collection holders', 'Require a work from an ERC-721 collection.'],
    'erc721-token': ['A particular NFT holder', 'Require ownership of one exact token.'],
    erc1155: ['Edition holders', 'Require a balance of a chosen ERC-1155 item.'],
    custom: ['A custom rule', 'A compatible contract checks eligibility.'],
  },
  gateLogic: { all: ['Every rule', 'A collector must meet all selected rules.'], any: ['At least one rule', 'Meeting any selected rule is enough.'] },
  signature: {
    none: ['No extra signature', 'Use the eligibility rules above.'],
    creator: ['My signature', 'Require a creator-signed authorization.'],
    platform: ['The platform’s signature', 'Require authorization from the configured platform.'],
    either: ['Either signature', 'Accept a creator or platform authorization.'],
  },
  stage: {
    allowlist: ['Allowlist', 'Open to an approved list.'], public: ['Public', 'Open to everyone.'],
    'token-payment': ['Token payment', 'Collect with a specified payment token.'],
    claim: ['Claim', 'Use an owned entitlement once.'], premint: ['Creator allocation', 'Reserve authority-controlled minting.'],
  },
};

export const artistOptions = (field) => KEEL_ENGINE_CHOICES[field].map((value) => ({ value, title: CHOICE_COPY[field][value][0], description: CHOICE_COPY[field][value][1] }));
export const choiceTitle = (field, value) => CHOICE_COPY[field]?.[value]?.[0] ?? 'Not chosen';

export function changeIntent(current, field, value) {
  const next = { ...current };
  if (value === '' || value === undefined || Array.isArray(value) && !value.length) delete next[field];
  else next[field] = value;
  if (field === 'outcome' && value !== 'release') for (const name of ['releaseType', 'collection', 'collectionAddress', 'mintSystem', 'access', 'gateLogic', 'signature', 'stages', 'supply']) delete next[name];
  if (field === 'family') { delete next.chainId; delete next.network; if(value==='tezos'&&next.collection&&!['tezos-fa2','existing','external'].includes(next.collection)||value==='ethereum'&&next.collection==='tezos-fa2')delete next.collection; }
  if (['family', 'chainId', 'network'].includes(field) && current[field] !== value) delete next.collectionAddress;
  if (field === 'releaseType') delete next.supply;
  if (field === 'collection') delete next.collectionAddress;
  if (field === 'mintSystem') for (const name of ['access', 'gateLogic', 'signature', 'stages']) delete next[name];
  if (field === 'access' && (!next.access || next.access.length < 2)) delete next.gateLogic;
  return parseKeelEngineIntent(next);
}

export function workPlan(project, objects = []) {
  const displayed = objects.find((object) => object.id === project.presentation.entryObjectId);
  return planKeelProject({ ...project.intent, ...(displayed ? { runtime: displayed.type === 'text/html' ? 'html' : 'static-media' } : {}) });
}

export function releaseSteps(project) {
  return ['work', ...(project.intent.outcome !== 'explore' ? ['network'] : []), ...(project.intent.outcome === 'release' ? ['collecting', 'access'] : []), 'audience', 'review'];
}

export const STEP_COPY = {
  work: ['Your work', 'Start with what you want to make.'], network: ['Where it lives', 'Choose a network and how the files are kept.'],
  collecting: ['Collecting', 'Choose the edition, collection and release method.'], access: ['Who can collect', 'Set who can collect and whether they need your approval.'],
  audience: ['Audience & discovery', 'Describe the work and see where it can be found.'], review: ['Review', 'Save the plan and see what still needs setup.'],
};
const STEP_FIELDS = { work: ['outcome', 'runtime'], network: ['family', 'chainId', 'network', 'storage'], collecting: ['releaseType', 'collection', 'collectionAddress', 'mintSystem', 'supply'], access: ['access', 'gateLogic', 'signature', 'stages'] };
export const questionsForStep = (plan, step) => (plan.questions ?? plan.nextQuestions).filter((question) => (STEP_FIELDS[step] ?? []).includes(question.field));

export function matchesArtwork(project, query) {
  const listing = project.listing ?? {};
  const words = [project.title, listing.artist, project.metadata?.description, project.metadata?.name, ...(listing.tags ?? []), ...project.files.map((file) => file.name)];
  return words.join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}
