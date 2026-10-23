import type { KeelPlanChoice, KeelPlanField, KeelPlanMatrix, KeelPlanPredicate, KeelPlanResource } from "./studio-project-planner.js";

export interface KeelPlanningRoute extends KeelPlanChoice {
  /** Required parameters come from this exact supported route, not an invented generic contract. */
  readonly parameters: readonly KeelPlanField[];
}
export interface KeelStudioPlanningCapabilities {
  readonly revision: string;
  readonly networks: readonly KeelPlanChoice[];
  readonly shells: readonly KeelPlanningRoute[];
  readonly delivery: readonly KeelPlanningRoute[];
  readonly newCollections: readonly KeelPlanningRoute[];
  readonly existingCollection: KeelPlanChoice;
  readonly saleRoutes: readonly KeelPlanningRoute[];
  readonly accessRoutes: readonly KeelPlanningRoute[];
  readonly moduleChoices: readonly KeelPlanChoice[];
  readonly revisionModes: readonly KeelPlanChoice[];
}

const choices = (routes: readonly KeelPlanChoice[]) => routes.map(({value,label,status,explanation}) => ({value,label,status,...(explanation === undefined ? {} : {explanation})}));
const available = (value: string, label: string): KeelPlanChoice => ({value,label,status:"available"});
const eq = (field: string, equals: string | boolean): KeelPlanPredicate => ({field,equals});
const all = (...conditions: KeelPlanPredicate[]): KeelPlanPredicate => ({all:conditions});

function mappedPredicate(predicate: KeelPlanPredicate, names: ReadonlyMap<string,string>): KeelPlanPredicate {
  if ("constant" in predicate) return predicate;
  if ("field" in predicate) return {...predicate,field:names.get(predicate.field) ?? predicate.field};
  if ("not" in predicate) return {not:mappedPredicate(predicate.not,names)};
  return "all" in predicate ? {all:predicate.all.map(item=>mappedPredicate(item,names))} : {any:predicate.any.map(item=>mappedPredicate(item,names))};
}
function parameters(prefix: string, route: KeelPlanningRoute, when: KeelPlanPredicate): KeelPlanField[] {
  const names = new Map(route.parameters.map(field=>[field.id,`${prefix}.${route.value}.${field.id}`]));
  return route.parameters.map(field=>({...field,id:names.get(field.id)!,
    dependencies:[...(field.dependencies ?? []).map(id=>names.get(id) ?? id),"network"],
    when:field.when ? all(when,mappedPredicate(field.when,names)) : when}));
}

/** Capability adapters supply only verified available routes and explicit unavailable explanations. */
export function buildKeelStudioDecisionMatrix(capabilities: KeelStudioPlanningCapabilities, resources: readonly KeelPlanResource[]): KeelPlanMatrix {
  const release = eq("outcome","release");
  const local = resources.some(resource=>resource.source.kind==="local");
  const executable = resources.some(resource=>/^(?:text\/(?:html|javascript)|application\/(?:javascript|wasm))$/iu.test(resource.mediaType));
  const fields: KeelPlanField[] = [
    {id:"title",label:"What is the project called?",kind:"text",maximum:160,required:true},
    {id:"description",label:"What are you making?",explanation:"A short description helps the agent choose the right questions.",kind:"text",maximum:2000,required:true},
    {id:"outcome",label:"What would you like to do with it?",kind:"choice",required:true,allowDefault:true,
      choices:[available("storage-only","Store and verify the files"),available("release","Make a collectible or release"),available("module","Make a reusable module or asset")]},
    {id:"network",label:"Which network should it use?",kind:"choice",choices:choices(capabilities.networks),required:true,allowDefault:true},
    {id:"viewer",label:"How should people open it?",kind:"choice",choices:choices(capabilities.shells),dependencies:["network"],required:true,allowDefault:true,
      explanation:"The verification interface, file compression, and delivery method are separate choices."},
  ];
  for(const shell of capabilities.shells) fields.push(...parameters("viewer",shell,eq("viewer",shell.value)));
  fields.push({id:"payloadStorage",when:{constant:local},label:"How should new files be stored?",kind:"choice",required:true,allowDefault:true,recommendation:"compact",
    choices:[available("compact","Smaller, lossless files"),available("raw","Keep the supplied bytes unchanged")],
    explanation:"Existing onchain objects are reused exactly; this choice affects only new supplied files."});
  {
    fields.push({id:"useModules",when:{constant:executable},label:"Add reusable JavaScript libraries?",kind:"boolean",required:true,allowDefault:true});
    fields.push({id:"modules",label:"Which libraries should it use?",kind:"multi-choice",choices:choices(capabilities.moduleChoices),
      dependencies:["network"],when:all({constant:executable},eq("useModules",true)),required:true,advanced:true,
      explanation:"Only the selected network's verified bindings can be used for publication."});
  }
  fields.push(
    {id:"delivery",label:"How should collectors load the work?",kind:"choice",choices:choices(capabilities.delivery),dependencies:["network","viewer"],when:release,required:true,allowDefault:true},
    {id:"collectionMode",label:"Use an existing collection or make a new one?",kind:"choice",dependencies:["network"],when:release,required:true,
      choices:[{...capabilities.existingCollection,value:"existing"},capabilities.newCollections.some(route=>route.status==="available")
        ? available("new","Create a collection") : {value:"new",label:"Create a collection",status:"configuration-required",explanation:"No compatible creation route is available on this network."}]},
    {id:"collectionAddress",label:"Which existing collection?",kind:"address",dependencies:["network"],when:all(release,eq("collectionMode","existing")),required:true,
      explanation:"Its owner, roles, supply, and reader compatibility are checked before a wallet action."},
    {id:"collectionTemplate",label:"What kind of collection?",kind:"choice",choices:choices(capabilities.newCollections),dependencies:["network"],when:all(release,eq("collectionMode","new")),required:true},
    {id:"saleRoute",label:"How should people collect it?",kind:"choice",choices:choices(capabilities.saleRoutes),dependencies:["network","collectionMode","collectionTemplate","collectionAddress"],when:release,required:true,allowDefault:true},
    {id:"accessRoute",label:"Who can collect it?",kind:"choice",choices:choices(capabilities.accessRoutes),dependencies:["network","saleRoute"],when:release,required:true,allowDefault:true},
  );
  for(const route of capabilities.delivery) fields.push(...parameters("delivery",route,all(release,eq("delivery",route.value))));
  for(const route of capabilities.newCollections) fields.push(...parameters("collection",route,all(release,eq("collectionMode","new"),eq("collectionTemplate",route.value))));
  for(const route of capabilities.saleRoutes) fields.push(...parameters("sale",route,all(release,eq("saleRoute",route.value))));
  for(const route of capabilities.accessRoutes) fields.push(...parameters("access",route,all(release,eq("accessRoute",route.value))));
  // Group policy questions by media type; immutable object bytes are never edited in place.
  for(const mediaType of [...new Set(resources.map(resource=>resource.mediaType))].sort()) {
    const key=[...new TextEncoder().encode(mediaType)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
    fields.push({id:`revision.${key}`,label:`Should ${mediaType} files have future versions?`,kind:"choice",choices:choices(capabilities.revisionModes),
      required:true,advanced:true,allowDefault:true,defaultKey:"resourceUpdateMode",defaultMediaType:mediaType,
      explanation:"A new version preserves earlier onchain bytes and updates only supported revision bindings."});
  }
  return {schema:"keel-studio-plan-matrix@1",capabilityRevision:capabilities.revision,fields};
}
