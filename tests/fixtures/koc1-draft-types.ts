import type { Koc1StudioDraft, Koc1DraftPrepareRequest, Koc1DraftPrepareResponse, Koc1DraftErrors } from '@keel/mcp';
const draft: Koc1StudioDraft = {
  mode:'first',open:'100',close:'200',cap:'21',price:'1000',challengeWindow:'6',collectAfter:'6',refundAfter:'18',notice:'3',
  earlyRefund:true,pausable:true,blind:true,cycle:false,treasuryKey:'',writerKeys:['','',''],writers:['','',''],metadataRoot:'',metadataCount:'21',artName:'',
};
const request: Koc1DraftPrepareRequest = {mode:'draft',draft,feeRate:2};
// @ts-expect-error The public request discriminant cannot select mint mode.
request.mode = 'mint';
// @ts-expect-error Fee rates are numeric, not form strings.
request.feeRate = '2';
function review(response: Koc1DraftPrepareResponse): string {
  const errors: Koc1DraftErrors = response.errors;
  const size: number | null = response.recipeByteLength;
  const bytes: string | null = response.recipeBytes;
  const ready: false = response.publicationReady;
  return JSON.stringify({errors,size,bytes,ready,cost:response.mintCost?.revealSpendSats});
}
void review;
