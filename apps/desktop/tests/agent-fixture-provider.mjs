// Native UI acceptance only. This module is never part of the production build.
export async function runAgentProvider({chat,messages,tools,onText,signal}){
  const prompt=messages.at(-1).content;
  const invoke=(name,input)=>tools.find(t=>t.name===name).invoke(input);
  if(prompt.includes('Search my memory')){
    if(chat.contextMode==='none'){
      if(tools.some(t=>!['keel_search_chat','keel_sdk_catalog'].includes(t.name)))throw Error('Disabled workspace tools were advertised.');
      onText('Use saved work above the message box to search your memories.');
    }else{
      const notes=JSON.parse(await invoke('keel_search_memory',{query:'Visual direction'}));
      if(notes.length!==1)throw Error('Expected the saved project memory.');
      onText(`Found your saved memory: ${notes[0].content}`);
    }
    return {text:''};
  }
  if(prompt.includes('slow')){onText('Saved partial reply.');await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('Stopped')),{once:true}));}
  else if(prompt.includes('edit')){
    await invoke('keel_edit_project',{projectId:chat.projectId,summary:'Add artist metadata',metadataJson:'{"name":"Native Sketch","description":"A violet garden of light."}'});
    await invoke('keel_remember',{projectId:chat.projectId,title:'Visual direction',content:'Use violet and cream in this piece.'});
    onText('I prepared the metadata edit and a memory for your review.');
  }else if(prompt.includes('show')){
    await invoke('keel_open_view',{page:'Projects',projectId:chat.projectId,tab:'Metadata'});onText('Opening the metadata editor.');
  }else{
    await invoke('keel_create_project',{title:'Native Sketch',html:'<!doctype html><html><body style="background:#171627;color:#c7b8ff;font:40px Georgia;display:grid;place-items:center;height:100vh">Native Sketch</body></html>',description:'An editor acceptance fixture.'});
    onText('Created **Native Sketch** as a local artwork draft.\n\nIt uses the KEEL verification shell. Open it below to keep working.');
  }
  return {text:''};
}
