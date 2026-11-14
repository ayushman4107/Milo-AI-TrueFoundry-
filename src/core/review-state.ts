export type ReviewAction='next'|'previous'|'accept'|'reject'|'undoDecision'|'rejectNoise';
export class ReviewState {
  #at=0;#selected=new Set<string>();#history:{id:string;before:boolean}[]=[];
  constructor(readonly rows:readonly {id:string;formattingOnly:boolean}[]){if(new Set(rows.map(r=>r.id)).size!==rows.length)throw new Error('Duplicate hunk ID');for(const r of rows)if(!r.formattingOnly)this.#selected.add(r.id);}
  snapshot(){return {activeId:this.rows[this.#at]?.id??null,selected:this.rows.filter(r=>this.#selected.has(r.id)).map(r=>r.id)};}
  choose(id:string,value:boolean){const at=this.rows.findIndex(r=>r.id===id);if(at<0)throw new Error('Unknown review hunk');this.#at=at;this.#history.push({id,before:this.#selected.has(id)});if(value)this.#selected.add(id);else this.#selected.delete(id);}
  dispatch(action:ReviewAction){const row=this.rows[this.#at];switch(action){
    case 'next':this.#at=Math.min(this.rows.length-1,this.#at+1);break;
    case 'previous':this.#at=Math.max(0,this.#at-1);break;
    case 'accept':if(row)this.choose(row.id,true);break;
    case 'reject':if(row)this.choose(row.id,false);break;
    case 'undoDecision':{const old=this.#history.pop();if(old){this.#at=this.rows.findIndex(r=>r.id===old.id);if(old.before)this.#selected.add(old.id);else this.#selected.delete(old.id);}break;}
    case 'rejectNoise':for(const r of this.rows)if(r.formattingOnly)this.choose(r.id,false);break;
  }return this.snapshot();}
}
