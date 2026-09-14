import React, { useMemo, useState } from 'react';
import { createSVGRendererRecipe, prepareSVGRenderer, previewSVGRenderer, SVG_RENDERER_VARIABLES, type SVGRendererRecipe } from '@keel/sdk/svg-renderer-authoring';
import type { Project, Shared } from './types';
import { Field } from './ui';
import { api } from './client';

export function SVGRendererBuilder({project,change,action}:{project:Project;change:(patch:Partial<Project>)=>void;action:Shared['action']}) {
  const recipe=project.svgRenderer ?? createSVGRendererRecipe();
  const [token,setToken]=useState('1');
  const result=useMemo(()=>{try{return {value:prepareSVGRenderer(recipe),preview:previewSVGRenderer(recipe,token)};}catch(e){return {error:e instanceof Error?e.message:'Check your SVG.'};}},[recipe,token]);
  const update=(patch:Partial<SVGRendererRecipe>)=>change({svgRenderer:{...recipe,...patch}});
  return <div className="content-pad svg-builder">
    <div className="section-intro"><h2>Create an SVG renderer</h2><p>Design once. Let your contract generate the art for every token.</p></div>
    <div className="inline-actions" role="group" aria-label="SVG starting designs">
      <button onClick={()=>change({svgRenderer:createSVGRendererRecipe('orbit')})}>Start with orbits</button>
      <button onClick={()=>change({svgRenderer:createSVGRendererRecipe('blocks')})}>Start with blocks</button>
      <button onClick={()=>change({svgRenderer:createSVGRendererRecipe('blank')})}>Start blank</button>
    </div>
    <div className="svg-builder-columns"><section>
      <Field label="Renderer name"><input value={recipe.name} onChange={e=>update({name:e.target.value})} /></Field>
      <div className="form-grid"><Field label="Canvas width"><input type="number" min="16" max="4096" value={recipe.width} onChange={e=>update({width:Number(e.target.value)})} /></Field><Field label="Canvas height"><input type="number" min="16" max="4096" value={recipe.height} onChange={e=>update({height:Number(e.target.value)})} /></Field></div>
      <div className="svg-builder-colors">{(['background','primary','accent'] as const).map(key=><Field label={key[0].toUpperCase()+key.slice(1)} key={key}><input type="color" value={recipe.colors[key]} onChange={e=>update({colors:{...recipe.colors,[key]:e.target.value}})} /></Field>)}</div>
      <p>Colors and positions can vary by token. The same collection seed and token ID always produce the same art, including onchain.</p>
      <details className="disclosure"><summary>Edit SVG & contract values</summary>
        <p>Paste passive SVG shapes here. Replace values with the placeholders below to make them come from the contract.</p>
        <textarea className="svg-builder-code" aria-label="SVG renderer artwork" rows={10} value={recipe.artwork} onChange={e=>update({artwork:e.target.value})} spellCheck={false} />
        <div className="svg-builder-values">{SVG_RENDERER_VARIABLES.map(name=><code key={name}>{`{{${name}}}`}</code>)}</div>
        <Field label="Collection seed"><input value={recipe.seed} onChange={e=>update({seed:e.target.value as `0x${string}`})} /></Field>
      </details>
    </section><section className="svg-builder-preview" aria-label="SVG renderer preview">
      {result.preview?<img alt={`SVG design for token ${token}`} src={`data:image/svg+xml,${encodeURIComponent(result.preview.source)}`} />:<div className="cover-empty">Fix the SVG to preview your design.</div>}
      <div className="inline-actions"><button disabled={BigInt(/^\d+$/.test(token)?token:'0')<=0n} onClick={()=>setToken(String(BigInt(token)-1n))}>Previous token</button><Field label="Preview token"><input value={token} onChange={e=>setToken(e.target.value)} inputMode="numeric" /></Field><button disabled={!/^\d+$/.test(token)} onClick={()=>setToken(String(BigInt(token)+1n))}>Next token</button></div>
      <small>Local preview · no wallet or deployment needed.</small>
    </section></div>
    {result.error&&<p role="alert">{result.error}</p>}
    <div className="inline-actions"><button className="primary" disabled={!result.value} onClick={()=>void action(async()=>{await api('svgRendererExport',{recipe});})}>Export Solidity renderer</button>
      {result.preview&&<a download={`${recipe.name}-token-${token}.svg`} href={`data:image/svg+xml,${encodeURIComponent(result.preview.source)}`}>Save preview SVG</a>}
    </div>
    <p className="section-intro">The exported renderer connects to your ERC-721 or ERC-721A collection. It reads the token from the contract, generates the SVG and includes KEEL provenance. It does not create a proof system or mint tokens.</p>
    <details className="disclosure"><summary>Generated contract</summary><pre className="svg-builder-code">{result.value?.solidity ?? 'Fix the design to prepare its contract.'}</pre></details>
  </div>;
}
