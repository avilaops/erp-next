import assert from "node:assert/strict"
import { test } from "node:test"
import { parseRegistryQuery, registryQueryString } from "../src/features/records/registry-query.ts"
import { referenceHierarchy, availableParents, loadReferenceHierarchy } from "../src/features/records/reference/reference-hierarchy.ts"

const a="11111111-1111-4111-8111-111111111111", b="22222222-2222-4222-8222-222222222222", c="33333333-3333-4333-8333-333333333333", d="44444444-4444-4444-8444-444444444444"
const node = (id,name,parentId=null,sortOrder=0,status="active")=>({id,name,parentId,sortOrder,status})

test("registry URLs bound pagination, reject invalid filters and keep each list's own roles",()=>{
 assert.deepEqual(parseRegistryQuery(new URLSearchParams("q= Casa &status=active&role=supplier&offset=49"),"party"),{q:"Casa",status:"active",role:"supplier",offset:25})
 assert.equal(parseRegistryQuery(new URLSearchParams("role=supplier"),"staff").role,"")
 assert.equal(parseRegistryQuery(new URLSearchParams("role=seller"),"staff").role,"seller")
 for(const offset of ["-25","Infinity","1e4","100001","999999999999","25abc"]) assert.equal(parseRegistryQuery(new URLSearchParams({offset}),"reference").offset,0)
 const query=parseRegistryQuery(new URLSearchParams({q:"x".repeat(200),status:"invalid",role:"employee",offset:"100000"}),"reference")
 assert.equal(query.q.length,160); assert.equal(query.status,""); assert.equal(query.role,""); assert.equal(query.offset,100000)
 assert.equal(registryQueryString({q:"Casa & filial",status:"archived",role:"customer",offset:25}),"q=Casa+%26+filial&status=archived&role=customer&offset=25")
 assert.equal(registryQueryString({q:"",status:"",role:"",offset:0}),"")
})

test("category paths retain sibling order and prevent self/descendant parenting",()=>{
 const options=referenceHierarchy([node(c,"Série B",a,2),node(a,"Premium",null,1),node(b,"Core",null,0),node(d,"Série A",a,1)])
 assert.deepEqual(options.map(x=>x.path),["Core","Premium","Premium / Série A","Premium / Série B"])
 assert.equal(options.find(x=>x.id===d).depth,1)
 assert.deepEqual(availableParents(options,a).map(x=>x.id),[b])
 assert.deepEqual(availableParents(options,d).map(x=>x.id),[b,a,c])
})

test("invalid hierarchies fail visibly instead of losing or silently reparenting records",()=>{
 for(const nodes of [[node(a,"A",b)], [node(a,"A",b),node(b,"B",a)], [node(a,"A"),node(a,"Again")], [node(a,"A",a)]]) assert.throws(()=>referenceHierarchy(nodes))
 const deep=Array.from({length:70},(_,index)=>node(`00000000-0000-4000-8000-${String(index).padStart(12,"0")}`,`N${index}`,index?`00000000-0000-4000-8000-${String(index-1).padStart(12,"0")}`:null))
 assert.throws(()=>referenceHierarchy(deep),/profundidade/)
})

test("archived ancestors and incompatible financial nature are excluded from new choices",()=>{
 const options=referenceHierarchy([{...node(a,"Receitas"),direction:"income"},{...node(b,"Despesas"),direction:"expense"},{...node(c,"Antiga",null,0,"archived"),direction:"income"},{...node(d,"Filha",c),direction:"income"}])
 assert.deepEqual(availableParents(options,null,"income").map(x=>x.id),[a])
 assert.equal(options.find(x=>x.id===d).available,false)
})

test("category pagination rejects a different company and incomplete/changing snapshots",async()=>{
 const reply=value=>Promise.resolve(new Response(JSON.stringify(value),{status:200,headers:{"Content-Type":"application/json"}}))
 const rows=[node(a,"Premium"),node(b,"Linha",a)]
 const calls=[]
 const options=await loadReferenceHierarchy("product-categories",a,new AbortController().signal,async(url,init)=>{calls.push({url,tenant:init.headers["X-Tenant-Id"]});return reply({tenantId:a,total:2,data:calls.length===1?[rows[0]]:[rows[1]]})})
 assert.deepEqual(options.map(x=>x.path),["Premium","Premium / Linha"])
 assert.equal(calls[1].url,"/api/erp/product-categories?limit=100&offset=1");assert.equal(calls[0].tenant,a)
 await assert.rejects(loadReferenceHierarchy("product-categories",a,new AbortController().signal,()=>reply({tenantId:b,total:0,data:[]})),/empresa/)
 await assert.rejects(loadReferenceHierarchy("product-categories",a,new AbortController().signal,()=>reply({tenantId:a,total:1,data:[]})),/completa/)
 let page=0
 await assert.rejects(loadReferenceHierarchy("product-categories",a,new AbortController().signal,()=>reply({tenantId:a,total:++page===1?2:3,data:[rows[page===1?0:1]]})),/mudaram/)
})
