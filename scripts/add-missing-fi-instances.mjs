import fs from 'fs';
import path from 'path';

const registryPath = path.join('public','assets','data','fi_registry.json');
const dailyDir = path.join('data','daily');
const normalizeFi = (val='')=>val.toString().trim().toLowerCase();
const normalizeInst = (val='')=>{
  const s = val.toString().trim().toLowerCase();
  return s || 'unknown';
};
const makeKey=(fi,inst)=>`${normalizeFi(fi)}__${normalizeInst(inst)}`;

function loadJSON(file){
  return JSON.parse(fs.readFileSync(file,'utf8'));
}

function collectDailyCombos(){
  const combos=new Map();
  const files=fs.readdirSync(dailyDir).filter(f=>f.endsWith('.json')).sort();
  for(const file of files){
    const data=loadJSON(path.join(dailyDir,file));
    const fiInst=data.fi_instances||{};
    for(const [key,val] of Object.entries(fiInst)){
      const fi = val.fi_lookup_key||val.fi_name||val.fi||key.split('__')[0];
      const inst = val.instance||key.split('__')[1]||'unknown';
      if(!fi) continue;
      const k=makeKey(fi,inst);
      if(!combos.has(k)) combos.set(k,{fi,instance:inst});
    }
    const fiEntries=data.fi||{};
    for(const [fiName,entry] of Object.entries(fiEntries)){
      const insts=Array.isArray(entry.ga_instances)&&entry.ga_instances.length?entry.ga_instances:
        entry.instance?[entry.instance]:['unknown'];
      insts.forEach(inst=>{
        const k=makeKey(fiName,inst);
        if(!combos.has(k)) combos.set(k,{fi:fiName,instance:inst});
      });
    }
  }
  return combos;
}

const registry=loadJSON(registryPath);
const existing=new Set(Object.keys(registry).map(k=>k.toLowerCase()));
const combos=collectDailyCombos();
let added=0;
for(const [key,{fi,instance}] of combos){
  if(existing.has(key)) continue;
  const guessIntegration=/dev|test/.test(instance)?'TEST':'NON-SSO';
  registry[key]={
    fi_name: fi,
    fi_lookup_key: normalizeFi(fi),
    instance,
    integration: guessIntegration,
    integration_type: guessIntegration,
    partner: registry[key]?.partner||'Unknown'
  };
  added++;
}

fs.writeFileSync(registryPath, JSON.stringify(registry,null,2));
console.log(`Added ${added} missing entries. Total now ${Object.keys(registry).length}`);
