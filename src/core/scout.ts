import {z} from 'zod';
import type {Workbench} from './workbench.js';
const Entry=z.object({path:z.string().max(1024),startLine:z.number().int().min(1),endLine:z.number().int().min(1),reason:z.string().min(1).max(500)}).strict();
export function validateWorkOrder(text:string,workbench:Workbench){
  if(text.length>16000)throw new Error('Scout work order too large');
  const order=z.array(Entry).max(16).parse(JSON.parse(text.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'')));
  const reads=workbench.ledger().reads;
  for(const item of order)if(item.endLine<item.startLine||!reads.some(r=>r.discovery.path===item.path&&r.startLine<=item.startLine&&r.endLine>=item.endLine))throw new Error('Scout work order references unread lines');
  return order;
}
