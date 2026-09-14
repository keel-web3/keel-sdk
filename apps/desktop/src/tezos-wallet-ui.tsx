import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, queryClient } from './client';
import { Badge, Field } from './ui';

const refresh = () => queryClient.invalidateQueries({queryKey:['tezos-wallets']});
const tez = (value: string) => { const n=BigInt(value); return `${n/1000000n}.${(n%1000000n).toString().padStart(6,'0')}`; };
function mutez(value: string) { if (!/^\d+(\.\d{1,6})?$/.test(value)) throw Error('Enter a tez amount with up to six decimal places.'); const [whole,part='']=value.split('.'); return (BigInt(whole)*1000000n+BigInt(part.padEnd(6,'0'))).toString(); }

export function TezosWalletHub({ installed, installer, preferredInstallationId }: { installed: any[]; installer?: React.ReactNode; preferredInstallationId?: string }) {
  const wallets=useQuery({queryKey:['tezos-wallets'],queryFn:()=>api('tezosWallets'),refetchInterval:5000});
  const networks=useQuery({queryKey:['network-profiles'],queryFn:()=>api('networkProfiles')});
  const [id,setId]=useState('beacon');
  useEffect(()=>{if(preferredInstallationId)setId(preferredInstallationId);},[preferredInstallationId]); const [profileId,setProfileId]=useState('tezos-mainnet');
  const [busy,setBusy]=useState(''); const [error,setError]=useState(''); const lock=useRef(false); const [balance,setBalance]=useState<any>(); const [proof,setProof]=useState<any>();
  const session=wallets.data?.sessions.find((row:any)=>row.id===id); const connection=session?.connection;
  const run=async(label:string,action:()=>Promise<unknown>)=>{if(lock.current)return;lock.current=true;setBusy(label);setError('');try{await action();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{lock.current=false;setBusy('');await refresh();}};
  const same=(value:any)=>value?.address===connection?.address&&value?.network===connection?.network;
  useEffect(()=>{setBalance(undefined);setProof(undefined);},[id,connection?.address,connection?.network]);
  return <section className="tezos-wallets connected-wallet"><div className="section-line"><div><h2>Tezos wallets</h2><p>Temple · Kukai · Umami · AirGap · other Beacon wallets</p></div><Badge tone="cool">TEZOS</Badge></div>
    <p>Install a wallet inside KEEL and create or restore it in its own window. Or use Beacon to pair a web, desktop, or phone wallet you already have.</p>{installer}
    <div className="wallet-account-grid"><Field label="Where is your wallet?"><select value={id} disabled={!!busy} onChange={e=>setId(e.target.value)}><option value="beacon">Beacon · pair another wallet</option>{installed.filter(w=>w.loaded).map(w=><option key={w.installationId} value={w.installationId}>{w.name} · inside KEEL</option>)}</select></Field>
      <Field label="Project network"><select value={profileId} disabled={!!busy} onChange={e=>setProfileId(e.target.value)}><option value="tezos-mainnet">Tezos Mainnet</option><option value="tezos-shadownet">Tezos Shadow Net · NetXsqzbfFenSTS</option>{networks.data?.filter((n:any)=>n.family==='tezos').map((n:any)=><option key={n.id} value={n.id}>{n.label} · {n.chainIdentity}</option>)}</select></Field></div>
    <div className="button-row"><button className="primary" disabled={!!busy||session?.pending} onClick={()=>void run('Choose your wallet and approve the connection.',()=>api('connectTezosWallet',{id,profileId}))}>{connection?'Change account or network':id==='beacon'?'Connect with Beacon':'Connect installed Tezos wallet'}</button>{id!=='beacon'&&<button onClick={()=>void run('Opening wallet…',()=>api('openWalletExtension',id))}>Open wallet</button>}</div>
    <small>For an imported extension, choose a Tezos-capable wallet. Its Beacon support determines whether it can connect.</small>
    <small>Add a custom Tezos network in Viewing or Release to use it here.</small>
    {connection&&<div className="tezos-account"><Badge tone="cool">Connected</Badge><p>{connection.networkLabel}</p><code>{connection.address}</code><div className="button-row"><button disabled={!!busy||session.pending} onClick={()=>void run('Reading tez balance…',async()=>setBalance(await api('tezosWalletBalance',id)))}>Show balance</button><button disabled={!!busy||session.pending} onClick={()=>void run('Approve the connection check in your wallet. No gas is charged.',async()=>setProof(await api('verifyTezosWallet',id)))}>Check signing connection</button><button disabled={!!busy||session.pending} onClick={()=>void run('Disconnecting…',()=>api('disconnectTezosWallet',id))}>Disconnect</button></div>
      {same(balance)&&<p>{tez(balance.balanceMutez)} tez</p>}{same(proof)&&<p className="success-text">Signature verified for this account.</p>}
      <TezosAction key={`${id}:${connection.address}:${connection.network}`} walletId={id} connection={connection} />
    </div>}
    {busy&&<p className="notice" role="status">{busy} You can cancel in the wallet or close its pairing window.</p>}{(error||wallets.error)&&<p role="alert" className="notice error">{error||wallets.error?.message}</p>}
    {!!wallets.data?.activity.filter((r:any)=>!['review','cancelled','expired'].includes(r.status)).length&&<details className="wallet-activity"><summary>Tezos activity</summary>{wallets.data.activity.filter((r:any)=>!['review','cancelled','expired'].includes(r.status)).map((r:any)=><article key={r.id}><Badge>{r.status.replaceAll('-',' ')}</Badge><h3>{r.label}</h3><p>{r.networkLabel} · {new Date(r.createdAt).toLocaleString()}</p>{r.hash&&<code>{r.hash}</code>}{r.message&&<p>{r.message}</p>}{r.receipt&&<p>Block {r.receipt.level} · {r.receipt.confirmations} confirmations</p>}{r.hash&&<button disabled={!!busy} onClick={()=>void run('Checking the selected chain…',()=>api('tezosReceipt',r.id))}>Check transaction</button>}</article>)}</details>}
  </section>;
}

function TezosAction({walletId,connection}:{walletId:string;connection:any}) {
  const [label,setLabel]=useState('Tezos transfer'); const [destination,setDestination]=useState(''); const [amount,setAmount]=useState('0'); const [entrypoint,setEntrypoint]=useState('default'); const [parameters,setParameters]=useState('');
  const [review,setReview]=useState<any>(); const [busy,setBusy]=useState(''); const [error,setError]=useState(''); const lock=useRef(false); const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>()=>{if(review?.status==='review')void api('cancelTezosTransaction',review.id).catch(()=>{});},[review?.id]);
  const edit=(setter:React.Dispatch<React.SetStateAction<string>>)=>(e:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>)=>{if(review?.status==='review')void api('cancelTezosTransaction',review.id);setReview(undefined);setter(e.target.value);};
  const run=async(text:string,fn:()=>Promise<void>)=>{if(lock.current)return;lock.current=true;setBusy(text);setError('');try{await fn();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy('');lock.current=false;await refresh();}};
  return <details className="wallet-write"><summary>Send tez or use a Tezos contract</summary><p>Review the destination, network, and estimated costs here, then approve the final request in your wallet.</p>
    <fieldset disabled={!!busy}><Field label="Activity name"><input value={label} onChange={edit(setLabel)} /></Field><Field label="Destination address"><input value={destination} onChange={edit(setDestination)} placeholder="tz1… or KT1…" /></Field><Field label="Amount in tez"><input inputMode="decimal" value={amount} onChange={edit(setAmount)} /></Field><details><summary>Contract call parameters</summary><Field label="Entrypoint"><input value={entrypoint} onChange={edit(setEntrypoint)} /></Field><Field label="Micheline JSON"><textarea value={parameters} onChange={edit(setParameters)} placeholder={'{"prim":"Unit"}'} /></Field><small>Leave this empty for a transfer. Contract tools and prepared project requests supply these fields.</small></details></fieldset>
    {!review&&<button disabled={!!busy||!destination||!label} onClick={()=>void run('Simulating and estimating fees…',async()=>{const result=await api('prepareTezosTransaction',{walletId,label,destination,amountMutez:mutez(amount),...(parameters.trim()?{entrypoint,parameters}: {})});if(mounted.current)setReview(result);else await api('cancelTezosTransaction',result.id);})}>Review transaction</button>}
    {review&&<div className="wallet-call-review"><Badge>{review.status.replaceAll('-',' ')}</Badge><h3>{review.label}</h3><p>{connection.networkLabel} · {tez(review.operation.amount)} tez</p><code>{review.operation.destination}</code><p>Estimated fee: {tez(review.estimate.feeMutez)} tez<br/>Estimated storage burn: {tez(review.estimate.storageBurnMutez)} tez</p><small>Your wallet shows the final fee and any account reveal cost.</small><details><summary>Exact request</summary><pre>{JSON.stringify(review.operation,null,2)}</pre></details>{review.status==='review'&&<div className="button-row"><button className="primary" disabled={!!busy} onClick={()=>void run('Approve or reject this transaction in your wallet.',async()=>{try{setReview(await api('sendTezosTransaction',{id:review.id,reviewed:true}));}finally{const rows=await api('tezosWallets');setReview(rows.activity.find((r:any)=>r.id===review.id));}})}>Continue to wallet approval</button><button disabled={!!busy} onClick={()=>{void api('cancelTezosTransaction',review.id);setReview(undefined);}}>Cancel review</button></div>}{review.hash&&<code>{review.hash}</code>}{review.message&&<p>{review.message}</p>}</div>}
    {busy&&<p role="status">{busy}</p>}{error&&<p role="alert" className="notice error">{error}</p>}
  </details>;
}
