import {dialog,type BrowserWindow} from 'electron';
import {writeFile} from 'node:fs/promises';
export async function saveRenderedImage(window:BrowserWindow,dataUrl:string,name='Artwork'){
  if(dataUrl.length>90_000_000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(dataUrl))throw Error('Choose a rendered image.');
  const format=dataUrl.slice(11,dataUrl.indexOf(';')),bytes=Buffer.from(dataUrl.slice(dataUrl.indexOf(',')+1),'base64');
  const valid=format==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):format==='jpeg'?bytes[0]===255&&bytes[1]===216:bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
  if(!valid)throw Error('Encoded image format does not match its file type.');
  const selected=await dialog.showSaveDialog(window,{title:'Save rendered image',defaultPath:name.replace(/[^a-zA-Z0-9 _-]/g,'_')+'.'+format,filters:[{name:format.toUpperCase(),extensions:[format]}]});
  if(selected.canceled||!selected.filePath)return null;
  await writeFile(selected.filePath,bytes,{flag:'wx'});return {saved:true};
}
