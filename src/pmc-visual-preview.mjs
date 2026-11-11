import {slots} from './engine.mjs';

// Rendering input only: never feed this temporary mapping to place(), stats(),
// persistence, export or the optimizer. The recorded weight is not consulted.
export function createPmcVisualPreview({cargo,plan,selected}) {
  const item=cargo.find(item=>item.id===selected);
  if(!item?.pmc?.items?.length)return null;
  const existing=slots.find(slot=>slot.deck==='main'&&plan[slot.id]===selected);
  const slot=existing||slots.find(slot=>slot.id==='M07');
  return {cargo:[item],plan:{[slot.id]:item.id},locked:[],selected:item.id,deck:'main',slotId:slot.id};
}
