import { isEventDelta, mergeEventDelta, type TrueForgeApi as TrueForge } from '@truefoundry/trueforge-sdk';

/** Replayed shells replace folded messages; deltas with the same ID are not duplicates. */
export class Timeline {
  #events = new Map<string,TrueForge.TurnStreamingEvent>();
  #bytes = 0;
  resetForReplay() { this.#events.clear(); this.#bytes = 0; }
  add(event: TrueForge.TurnStreamingEvent) {
    this.#bytes += Buffer.byteLength(JSON.stringify(event));
    if (this.#bytes > 8_000_000 || this.#events.size >= 10000) throw new Error('Timeline capacity reached');
    if (isEventDelta(event)) {
      const base = this.#events.get(event.id);
      if (!base || base.type !== 'model.message') throw new Error('Missing message shell; replay the turn');
      mergeEventDelta(base,event);
    } else this.#events.set(event.id,structuredClone(event));
  }
  snapshot() { return structuredClone([...this.#events.values()]); }
  display() {
    return [...this.#events.values()].map(e => e.type === 'model.message'
      ? { id:e.id,type:e.type,text:typeof e.content === 'string' ? e.content : JSON.stringify(e.content ?? ''),tools:e.toolCalls?.map(t=>t.function.name) ?? [] }
      : {id:e.id,type:e.type,text:'state' in e ? JSON.stringify(e.state) : '',tools:[]});
  }
}
