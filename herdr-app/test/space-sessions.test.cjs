const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const folder=path.join(__dirname,'../mods/space-sessions');
function setup(saved=null){
 const storage=new Map(saved===null?[]:[['collapsed-spaces',saved]]);
 const ids=[];
 function el(){let proxy;proxy=new Proxy({}, {get(_target,key){return (...args)=>{
  if(key==='id')ids.push(args[0]);
  if(key==='when'&&args[0])args[1](proxy);
  return proxy;
 };}});return proxy;}
 const cx={focus_handle:()=>({}),notify(){}};
 const context={View:class{},div:el,h_flex:el,v_flex:el,svg:el,image:el,
  checking:()=>true,props:()=>({experiment:'space-summaries'}),
  localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)}};
 const model=fs.readFileSync(path.join(folder,'model.js'),'utf8').replace(/^export /gm,'');
 const source=fs.readFileSync(path.join(folder,'main.js'),'utf8').replace(/^import .*;\n/gm,'').replace('export default class ','globalThis.Mod = class ');
 vm.runInNewContext(model+'\n'+source,context);
 const mod=new context.Mod();mod.init({},cx);
 return {mod,cx,ids,storage};
}
test('all spaces render an expanded session group by default',()=>{
 const {mod,ids}=setup();mod.renderSpaces({},'space-summaries');
 for(const space of mod.allSpaces())assert.ok(ids.includes('sessions-'+space.id),space.name);
});
test('each space collapses independently and its choice persists',()=>{
 const {mod,cx,ids,storage}=setup();mod.toggleSpace('herdr',cx);mod.renderSpaces({},'space-summaries');
 assert.ok(!ids.includes('sessions-herdr'));assert.ok(ids.includes('sessions-training'));
 assert.equal(JSON.parse(storage.get('collapsed-spaces'))[0],'herdr');
 const reloaded=setup(storage.get('collapsed-spaces'));assert.ok(reloaded.mod.collapsed.has('herdr'));
 mod.toggleSpace('herdr',cx);assert.equal(mod.collapsed.size,0);
});
test('malformed persisted collapse state falls back to expanded',()=>{
 for(const state of ['bad json','{}','null'])assert.equal(setup(state).mod.collapsed.size,0);
});
test('a tab with several agents lists each agent under it',()=>{
 const {mod,ids}=setup();mod.renderSpaces({},'space-summaries');
 assert.ok(ids.includes('panes-builder'));
 assert.ok(ids.includes('agent-sample-builder'));assert.ok(ids.includes('agent-sample-builder-review'));
 assert.ok(!ids.includes('panes-design'));
});
