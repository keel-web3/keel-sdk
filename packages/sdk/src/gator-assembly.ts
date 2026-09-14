/** Portable reconstruction of the recovered TokenGators server stack. No filesystem or network access. */
export type GatorConfig={stack:string[];TopperEyes:string[];attributes:Record<string,{main:string;addons:string[]}>;extras:Record<string,any>};
export type GatorAssembly={kind:'token-gators@1';config:GatorConfig;files:{path:string;objectId:string}[];sourceNames?:Record<string,{attribute:string;items:Record<string,string>}>};
export const gatorTrait=(file:string)=>file.endsWith('_Cheetah_.png')?"'Cheetah'":file.endsWith('_Captain_s Hat.png')?"Captain's Hat":file.split('_').at(-1)!.slice(0,-4);
export function parseGatorAssembly(value:any):GatorAssembly{
 if(!value||value.kind!=='token-gators@1'||Object.keys(value).some(k=>!['kind','config','files','sourceNames'].includes(k))||JSON.stringify(value).length>500000)throw Error('Invalid Gator assembly.');
 const c=value.config;if(!c||Object.keys(c).some(k=>!['stack','TopperEyes','attributes','extras'].includes(k)))throw Error('Invalid Gator configuration.');
 const strings=(v:any,max:number)=>Array.isArray(v)&&v.length<=max&&v.every(x=>typeof x==='string'&&x.length<=160&&!/[\\/\u0000-\u001f]/.test(x));
 if(!strings(c.stack,64)||!strings(c.TopperEyes,128)||!c.attributes||Object.keys(c.attributes).length!==6||!['Background','Body','Eyes','Mouth','Hat','Costume'].every(k=>c.attributes[k]&&typeof c.attributes[k].main==='string'&&strings([c.attributes[k].main],1)&&strings(c.attributes[k].addons,16)))throw Error('Invalid Gator trait configuration.');
 if(!c.extras||typeof c.extras!=='object'||Array.isArray(c.extras))throw Error('Invalid Gator patch configuration.');
 if(!Array.isArray(value.files)||value.files.length>1000||value.files.some((f:any)=>!f||Object.keys(f).some(k=>!['path','objectId'].includes(k))||typeof f.path!=='string'||f.path.length>240||f.path.split('/').length!==2||f.path.split('/').some((p:string)=>!p||p==='.'||p==='..')||/[\\\u0000-\u001f]/.test(f.path)||!f.path.endsWith('.png')||!/^[a-f0-9]{64}$/.test(f.objectId)))throw Error('Invalid Gator asset inventory.');
 if(new Set(value.files.map((f:any)=>f.path)).size!==value.files.length)throw Error('Duplicate Gator asset path.');
 if(value.sourceNames!==undefined){
  const names=value.sourceNames,identity=(s:string)=>/^[a-zA-Z0-9_-]{1,100}$/.test(s);
  if(!names||typeof names!=='object'||Array.isArray(names)||Object.keys(names).length>6)throw Error('Invalid Gator source names.');
  for(const [id,binding]of Object.entries(names) as [string,any][]){
   if(!identity(id)||!binding||Object.keys(binding).some(k=>!['attribute','items'].includes(k))||!Object.hasOwn(c.attributes,binding.attribute)||!binding.items||typeof binding.items!=='object'||Array.isArray(binding.items)||Object.keys(binding.items).length>256)throw Error('Invalid Gator source binding.');
   for(const [item,name]of Object.entries(binding.items))if(!identity(item)||!strings([name],1)||!name)throw Error('Invalid Gator source trait.');
  }
 }
 return JSON.parse(JSON.stringify(value));
}
export function gatorStack(assembly:GatorAssembly,metadata:Record<string,string>){
 const {config,files}=assembly;const folders:Record<string,string[]>={};for(const f of files){const [folder,name]=f.path.split('/');(folders[folder!]??=[]).push(name!);}for(const folder of Object.keys(folders))folders[folder]!.sort();
 const directory=(folder:string)=>folders[folder]??[],path=(folder:string,name:string)=>folder+'/'+name;
 const layers=Object.entries(metadata).flatMap(([key,value])=>{const type=key[0]!.toUpperCase()+key.slice(1),spec=config.attributes[type];if(!spec)throw Error('Unknown Gator trait '+key);const main=directory(spec.main).find(f=>gatorTrait(f)===value);if(!main)throw Error(`Missing Gator ${type}: ${value}`);return [main,...spec.addons.filter(Boolean).flatMap(folder=>{const found=directory(folder).find(f=>gatorTrait(f)===value);return found?[found]:[];})];});
 let stack:string[]=layers.map(()=>'');const trace:string[]=[];
 for(const layer of layers){const parts=layer.split('_');let typeName:string|undefined,layerName:string|undefined;if(parts.length>4){typeName=parts[2];layerName=parts[3];}else if(parts.length===2){layerName=parts[0];typeName='Background';}else{layerName=parts[2];typeName=parts[3];}if(!layerName&&layer.endsWith('_Cheetah_.png'))layerName='Body';if(!layerName)throw Error('Invalid Gator layer name '+layer);
  if(typeName==='Costume'&&layerName==='DepthArm'){const index=config.stack.indexOf('Costume_DepthArm');stack[index]=path('Costume_DepthArm',layer);stack=stack.filter(file=>!file.includes('Body_BodyShadow'));for(const extra of config.extras.DepthArm??[]){if(stack.some(file=>file.endsWith('DepthArm_'+extra+'.png'))){const at=stack.findIndex(file=>file.includes('/DepthArm/')||file.startsWith('DepthArm/'));if(at>=0)stack.splice(at,1);trace.push('Costume replaces depth arm');}}}
  else {const at=config.stack.indexOf(layerName);if(at<0)throw Error('Unconfigured Gator layer '+layerName);stack[at]=path(layerName,layer);}}
 stack=stack.filter(Boolean);
 const which=layers.some(f=>f.includes('Gamer'))?'Gamer':layers.some(f=>f.includes('Bot'))?'Bot':layers.some(f=>f.includes('Monster'))?'Monster':'';
 if(which){const costumes=config.extras.Body?.Patches?.[which]??[];if(costumes.length&&stack.some(file=>costumes.some((c:string)=>file.includes(c)))){const b=layers.includes('_0018_Costume_Shadow_Grass Skirt.png'),match=which==='Monster'?(b?'Monster_B':'Monster_A'):which==='Bot'&&b?'Bot_B':which;const patch=directory('Patches').find(file=>file.includes(match));if(patch){const at=stack.findIndex(file=>file.startsWith('Body/_'));if(at>=0){stack.splice(at+1,0,path('Patches',patch));trace.push('Body/costume patch: '+match);}}}}
 for(const [layer,extra] of Object.entries(config.extras)){if(!stack.join('').includes(layer))continue;for(const value of Object.values(metadata)){const replacements=extra?.[value];if(!replacements||typeof replacements!=='object'||Array.isArray(replacements))continue;for(const [from,to] of Object.entries(replacements)){if(typeof to!=='string')continue;const at=stack.findIndex(file=>file.startsWith(from+'/'));if(at>=0){stack[at]=stack[at]!.replace(from,to);trace.push(from+' → '+to);}}}}
 if(stack.some(f=>f.includes('Frog'))&&stack.some(f=>f.includes('Rock'))){const at=stack.findIndex(f=>f.includes('_0000_Eyes_UnderEyes_Frog.png'));if(at>=0){stack.splice(at,0,'Frog/0000_Eyes_UnderEyes_PatchRockFrog.png');trace.push('Rock + Frog eye patch');}}
 const eyeFile=stack.find(f=>f.includes('Eyes')),eyes=eyeFile?gatorTrait(eyeFile):undefined;
 if(eyes&&config.TopperEyes.includes(eyes)){const hatFile=stack.find(f=>f.includes('Hat'));if(hatFile){const hat=gatorTrait(hatFile),topper=directory('TopperEyes').find(f=>f.includes(eyes+'_'+hat));if(topper){stack.push(path('TopperEyes',topper));trace.push('Eye/hat overlap: '+eyes+' + '+hat);const at=stack.findIndex(f=>f.includes('TopperMouth'));if(at>=0)stack.push(stack.splice(at,1)[0]!);}}}
 const capital=(s:string)=>s[0]!.toUpperCase()+s.slice(1),equal=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
 // Preserve recovered ordering, including middle insertion based on the current stack length.
 for(const [key,value] of Object.entries(metadata)){const name=capital(key)+'_'+capital(value)+'.png';for(const folder of ['SuperTop','Top','Bottom','Middle']){const file=directory(folder).find(f=>equal(f,name));if(file){const at=folder==='Bottom'?1:folder==='Middle'?Math.floor(stack.length/2):stack.length;stack.splice(at,0,path(folder,file));trace.push(folder+': '+name);}}}
 for(const [key,value] of Object.entries(metadata))for(const [other,otherValue] of Object.entries(metadata)){if(other===key)continue;const name=[key,value,otherValue].map(capital).join('_')+'.png';for(const folder of ['Bottom','Middle','Top','SuperTop']){const file=directory(folder).find(f=>equal(f,name));if(file){const at=folder==='Bottom'?1:folder==='Middle'?Math.floor(stack.length/2)+2:stack.length;stack.splice(at,0,path(folder,file));trace.push(folder+': '+name);}}}
 const inventory=new Map(files.map(f=>[f.path,f.objectId]));for(const file of stack)if(!inventory.has(file))throw Error('Gator assembly needs missing image '+file);
 return {stack:stack.map(file=>({path:file,objectId:inventory.get(file)!})),trace};
}
