import test from 'node:test';
import assert from 'node:assert/strict';
import {createPmcVisualPreview} from '../src/pmc-visual-preview.mjs';
import {initialCargo,initialPlan,place,violations,stats} from '../src/engine.mjs';
import {pmcBoxTransforms} from '../src/pmc-aircraft.mjs';

const item={id:'PAL-09',name:'PMC 01',weight:120000,l:317.5,w:243.84,h:140,priority:1,pmc:{items:[{id:'box-1',l:100,w:80,h:140,x:8.5,y:8.5,z:0,color:'#ff0000'}]}};
function freeze(value){Object.freeze(value);for(const child of Object.values(value))if(child&&typeof child==='object'&&!Object.isFrozen(child))freeze(child);return value;}
test('overweight PMC can be visually isolated without changing data or weakening placement',()=>{
 const input=freeze({cargo:[...initialCargo,item],plan:{...initialPlan},selected:item.id});
 const before=JSON.stringify(input),summary=stats(input.plan,input.cargo),errors=violations(input.plan,input.cargo);
 const preview=createPmcVisualPreview(input);
 assert.equal(preview.cargo.length,1);assert.equal(preview.cargo[0],item);
 assert.deepEqual(preview.plan,{M07:'PAL-09'});assert.equal(preview.deck,'main');
 assert.equal(preview.cargo[0].weight,120000);
 assert.equal(pmcBoxTransforms(preview.cargo[0],{x:0,y:0,z:0}).length,1);
 assert.equal(JSON.stringify(input),before);
 assert.deepEqual(stats(input.plan,input.cargo),summary);
 assert.deepEqual(violations(input.plan,input.cargo),errors);
 assert.match(place(input.plan,input.cargo,item.id,'M01').error,/ağırlık|sınır/);
});
test('preview reuses a selected main-deck reference only and never includes other pallets',()=>{
 const input={cargo:[...initialCargo,item],plan:{...initialPlan,M12:item.id},selected:item.id};
 assert.deepEqual(createPmcVisualPreview(input).plan,{M12:item.id});
 const lower=createPmcVisualPreview({...input,plan:{L01:item.id}});
 assert.deepEqual(lower.plan,{M07:item.id});
 assert.equal(createPmcVisualPreview({...input,selected:'PAL-01'}),null);
 assert.equal(createPmcVisualPreview({...input,selected:'unknown'}),null);
});
