export function modelProfile(small:boolean){return {name:small?'small':'standard',contextBytes:small?6000:24000,readLines:small?80:200,readBytes:small?4000:8000,iterationLimit:small?24:30};}
/** Provider input tokens contain harness overhead; only comparable output text is calibrated. */
export class TokenEstimate {
  #ratios=new Map<string,{ratio:number;samples:number}>();
  observeOutput(model:string,text:string,tokens:number){if(!Number.isSafeInteger(tokens)||tokens<8||!text)return;const ratio=Buffer.byteLength(text)/tokens;if(ratio<0.5||ratio>12)return;const old=this.#ratios.get(model);this.#ratios.set(model,{ratio:old?old.ratio*0.8+ratio*0.2:ratio,samples:(old?.samples??0)+1});}
  estimate(model:string,text:string){const sample=this.#ratios.get(model);return {approxTokens:Math.ceil(Buffer.byteLength(text)/(sample?.ratio??4)),approximate:true,calibration:sample?'observed output only':'4-byte heuristic',samples:sample?.samples??0};}
}
