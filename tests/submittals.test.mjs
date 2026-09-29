import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractionEvidence,
  productDraft,
  sameRequirement,
  SUBMITTAL_CACHE_PREFIX,
  SUBMITTAL_EXTRACTION_VERSION,
  SUBMITTAL_LOG_VERSION,
} from "../lib/domain/submittals.ts";
const ev = (id, text, page = 1) => ({
  id,
  text,
  page,
  section: "08 11 13",
  clause: "",
  source: "pdf",
  box: [0, 0, 1, 0.1],
});
test("checklist recaps are excluded but substantive late requirements remain", () => {
  const source = [
    ev("a", "SECTION 081113 - STEEL DOORS"),
    ev("b", "Submit shop drawings for steel doors."),
    ev("c", "Submit the warranty at closeout.", 9),
    ev("d", "SUBMITTAL CHECKLIST", 10),
    ev("e", "Shop drawings", 10),
    ev("f", "Warranty", 10),
  ];
  assert.deepEqual(
    extractionEvidence(source).map((e) => e.id),
    ["a", "b", "c"],
  );
});
test("a new section after a checklist resumes extraction", () => {
  assert.deepEqual(
    extractionEvidence([
      ev("a", "SUBMITTAL CHECKLIST"),
      ev("b", "Warranty"),
      ev("c", "SECTION 092900 - GYPSUM BOARD"),
      ev("d", "Submit product data."),
    ]).map((e) => e.id),
    ["c", "d"],
  );
});
test("products retain the original obligation, condition and evidence", () => {
  const parent = {
    id: "r1",
    text: "Submit product data when requested.",
    title: "Product data",
    condition: "when requested",
    type: "product_data",
    evidenceIds: ["a"],
    quote: "Submit product data when requested.",
    products: [],
    warnings: [],
    blocking: [],
    status: "approved",
  };
  const r = productDraft(parent, [{ id: "p1", name: "Steel doors" }]);
  assert.equal(r.parentId, "r1");
  assert.deepEqual(r.productIds, ["p1"]);
  assert.deepEqual(r.evidenceIds, ["a"]);
  assert.equal(r.text, parent.text);
  assert.equal(r.condition, parent.condition);
  assert.equal(r.status, "needs_review");
  assert.ok(r.warnings.length);
  assert.equal(
    sameRequirement(parent, { ...parent, title: "A different title" }),
    true,
  );
  assert.equal(
    sameRequirement(parent, { ...parent, type: "shop_drawings" }),
    false,
  );
});
test("a request to submit a schedule is not itself a recap heading", () => {
  const source = [
    ev("a", "Submit a submittal schedule for approval."),
    ev("b", "Submit product data."),
  ];
  assert.equal(extractionEvidence(source).length, 2);
});
test("repeated running section headers do not re-enable a checklist", () => {
  const source = [
    ev("a", "SECTION 081113 - STEEL DOORS"),
    ev("b", "SUBMITTAL CHECKLIST"),
    ev("c", "SECTION 081113 - STEEL DOORS"),
    ev("d", "Shop drawings"),
  ];
  assert.deepEqual(
    extractionEvidence(source).map((e) => e.id),
    ["a"],
  );
});

import { parseExtraction } from "../lib/domain/submittals.ts";
const productCandidate = (quote = "Steel doors shall be galvanized.") => ({
  name: "Steel doors",
  group: "2.1 Doors",
  evidenceIds: ["door"],
  quote,
});
test("short quotes at the reported array positions no longer reject a batch", () => {
  const products = Array.from({ length: 43 }, () => productCandidate());
  for (const i of [39, 41, 42]) products[i].quote = "Steel";
  const result = parseExtraction({ requirements: [], products }, [
    ev("door", "Steel doors shall be galvanized."),
  ]);
  assert.equal(result.products.length, 43);
  assert.equal(result.omittedProducts, 0);
  for (const i of [39, 41, 42]) {
    assert.equal(result.products[i].quote, "Steel doors shall be galvanized.");
    assert.deepEqual(result.products[i].evidenceIds, ["door"]);
  }
});
test("unverifiable products are counted without losing valid requirements or products", () => {
  const requirement = {
    title: "Product data",
    text: "Submit product data.",
    type: "product_data",
    condition: null,
    evidenceIds: ["door"],
    quote: "Submit product data.",
    products: [],
  };
  const result = parseExtraction(
    {
      requirements: [requirement],
      products: [
        productCandidate(),
        { ...productCandidate("Steel"), evidenceIds: ["unknown"] },
        productCandidate("Invented quote about doors."),
        { ...productCandidate("Steel"), name: "Unrelated product" },
        { ...productCandidate(), group: null },
      ],
    },
    [ev("door", "Steel doors shall be galvanized. Submit product data.")],
  );
  assert.equal(result.products.length, 2); // Group is now derived by the server.
  assert.equal(result.requirements.length, 1);
  assert.equal(result.omittedProducts, 3);
});
test("quote recovery stays within the cited block and preserves its page evidence", () => {
  const result = parseExtraction(
    { requirements: [], products: [productCandidate("Steel")] },
    [ev("other", "Steel doors on another page.", 2), ev("door", "Steel", 3)],
  );
  assert.equal(result.products.length, 0);
  assert.equal(result.omittedProducts, 1);
});
test("invalid mandatory requirements still pause with an extraction-specific error", () => {
  assert.throws(
    () => parseExtraction({ requirements: [{}], products: [] }, []),
    (e) =>
      e.code === "invalid_extraction" &&
      e.status === 502 &&
      e.message.includes("requirements.0"),
  );
});

import { sortSubmittals } from "../lib/domain/submittals.ts";
test("source ordering is numeric, uses evidence position and keeps children under their parent", () => {
  const r = (id, extra = {}) => ({
    id,
    title: id,
    section: "15510",
    filename: "15510 HVAC.pdf",
    docId: "doc",
    page: 1,
    sourceOrder: 1,
    clause: "1.1",
    ...extra,
  });
  const a = r("parent", { sourceOrder: 2 });
  const b = r("next", { sourceOrder: 3 });
  const child = r("child", {
    parentId: a.id,
    title: "parent - Steel Fittings",
  });
  const nextDoc = r("valves", {
    filename: "15511 VALVES.pdf",
    section: "08305 bad cross-reference",
    docId: "valves",
  });
  const result = sortSubmittals([nextDoc, b, child, a]);
  assert.deepEqual(
    result.map((x) => x.id),
    ["parent", "child", "next", "valves"],
  );
  assert.equal(
    sortSubmittals(
      [r("10", { title: "Item 10" }), r("2", { title: "Item 2" })],
      "title",
    )[0].id,
    "2",
  );
});
test("individual product titles retain the original submittal title", () => {
  const parent = {
    id: "a",
    title: "Product Data for Piping Specialties",
    warnings: [],
    products: [],
  };
  assert.equal(
    productDraft(parent, [{ id: "p", name: "Steel Fittings" }]).title,
    "Product Data for Piping Specialties - Steel Fittings",
  );
});

import { correctSections } from "../lib/domain/specifications.ts";
import { normalizeCombinedTitles, groupSubmittals } from "../lib/domain/submittals.ts";
test("section references cannot replace the owning specification number", () => {
  const source = [ev("a", "SECTION 15891 - METAL DUCTWORK"), ev("b", "SECTION 15501 , General Provisions for Heating,"), ev("c", "08305 : Access Doors and shall be not less than", 2), ev("d", "Submit shop drawings", 3), ev("e", "SECTION 15511 - VALVES", 4)];
  const result = correctSections({pages:4,evidence:source,sections:[],scannedPages:[],version:"test"});
  assert.deepEqual(result.evidence.map(e=>e.section),["15891","15891","15891","15891","15511"]);
  assert.deepEqual(correctSections({pages:1,evidence:[ev("x","SECTION 15501 , General Provisions for Heating,")]}).evidence.map(e=>e.section),["Unresolved"]);
});
test("combined titles omit products while legacy generated titles are repaired safely", () => {
  const parent = {id:"a",title:"Product Data for Piping",warnings:[],products:[]};
  const products = [{id:"p1", name:"Pipe"},{id:"p2", name:"Fittings"}];
  assert.equal(productDraft(parent,products,"combined").title,parent.title);
  assert.equal(productDraft(parent,[products[0]],"combined").title,parent.title);
  const legacy={...productDraft(parent,products),id:"b",productMode:undefined};
  const custom={...legacy,id:"c",title:"My edited title"};
  const rows=normalizeCombinedTitles([parent,legacy,custom]);
  assert.equal(rows[1].title,parent.title);
  assert.equal(rows[2].title,"My edited title");
  assert.equal(rows[1].productIds.length,2);
});
test("groups keep files separate and sort by spec number", () => {
  const r=(id,docId,section)=>({id,docId,section,filename:docId+".pdf"});
  const groups=groupSubmittals([r("b","valves","15511"),r("a","pipe","15510"),r("c","pipe","15510"),r("d","other","15510")]);
  assert.deepEqual(groups.map(g=>g.rows.map(r=>r.id)),[["d"],["a","c"],["b"]]);
});

import { assignStructure } from "../lib/domain/structure.ts";
import { assessProduct } from "../lib/domain/product-classification.ts";
test("decimal measurements retain article ownership and later paragraph sequence",()=>{
 for(const [heading,paragraph,value,expected] of [["2.01 DUCT LINER","D. Properties","1.5 .90","2.01.D"],["2.06 DOUBLE WALL DUCTWORK","A. Insulation","0.26 BTU in/h at 75 F","2.06.A"],["3.02 INSTALLATION","A. Environmental","4.0 LEED version requirements.","3.02.A"]]) {
 const source=[ev("h",heading),ev("p",paragraph),ev("v",value),ev("c","C. Materials")];
 const result=assignStructure({evidence:source,pages:1});
 assert.equal(result.evidence[2].clause,expected);
 assert.equal(result.evidence[3].clause,heading.split(" ")[0]+".C");
 }
});
test("classification rejects suppliers and bans without confusing ingredient exclusions",()=>{
 const p=(name,quote)=>({name,quote});
 assert.equal(assessProduct(p("SEMCO Incorporated","SEMCO Incorporated"),[]).selectable,false);
 assert.equal(assessProduct(p("Strap hangers","Strap hangers shall not be used in this application."),[]).selectable,false);
 assert.equal(assessProduct({...p("Duct liner","Duct liner shall not contain asbestos."),entityType:"product",usageStatus:"required",catalogRole:"standalone_item"},[]).selectable,true);
 assert.equal(assessProduct(p("Strap hangers","Strap hangers shall not be used unless approved."),[]).usageStatus,"conditional");
 assert.equal(assessProduct({...p("Acme","Acme"),entityType:"manufacturer"},[]).selectable,false);
 assert.equal(assessProduct({...p("Pipe","Provide pipe when specified."),usageStatus:"unclear"},[]).selectable,false);
});

test("product classification separates standalone items from constituent materials and generic references",()=>{
 const standalone=(name,quote,entityType="product")=>({name,quote,entityType,usageStatus:"required",catalogRole:"standalone_item"});

 const tankQuote="Boiler blowdown tank: Construct of carbon steel.";
 assert.equal(
   assessProduct(standalone("Boiler blowdown tank",tankQuote),[ev("tank",tankQuote)]).selectable,
   true,
 );
 const carbon=assessProduct(standalone("carbon steel",tankQuote,"material"),[ev("tank",tankQuote)]);
 assert.equal(carbon.selectable,false);
 assert.equal(carbon.catalogRole,"constituent_material");

 const stainlessQuote="Tank shall include a stainless steel striking or wearing plate.";
 const stainless=assessProduct(standalone("stainless steel",stainlessQuote,"material"),[ev("wear",stainlessQuote)]);
 assert.equal(stainless.selectable,false);
 assert.equal(stainless.catalogRole,"constituent_material");

 const valveQuote="Provide temperature regulating valve in water inlet.";
 assert.equal(
   assessProduct(standalone("temperature regulating valve",valveQuote),[ev("valve",valveQuote)]).selectable,
   true,
 );

 const testQuote="Hydrostatically test assembled boiler accessories.";
 const assembled=assessProduct(standalone("assembled boiler accessories",testQuote),[ev("test",testQuote)]);
 assert.equal(assembled.selectable,false);
 assert.equal(assembled.catalogRole,"generic_reference");

 const insulationQuote="Provide fiberglass insulation for piping.";
 assert.equal(
   assessProduct(standalone("fiberglass insulation",insulationQuote,"material"),[ev("insulation",insulationQuote)]).selectable,
   true,
 );

 const scopeQuote="Accessories associated with the boilers are included in this Section.";
 assert.equal(
   assessProduct(standalone("accessories associated with the boilers",scopeQuote),[ev("scope",scopeQuote)]).selectable,
   false,
 );
});

test("legacy candidates are not silently assumed to be product plus permitted",()=>{
 const result=assessProduct({name:"Valve assembly",quote:"Valve assembly."},[ev("legacy","Valve assembly.")]);
 assert.equal(result.entityType,"unclear");
 assert.equal(result.usageStatus,"unclear");
 assert.equal(result.catalogRole,"unclear");
 assert.equal(result.selectable,false);

 const reclassified=assessProduct({name:"fiberglass insulation",quote:"Provide fiberglass insulation."},[ev("legacy2","Provide fiberglass insulation.")]);
 assert.equal(reclassified.catalogRole,"standalone_item");
 assert.equal(reclassified.usageStatus,"required");
 assert.equal(reclassified.selectable,true);
});

test("validated extraction keeps non-catalog candidates inspectable but non-selectable",()=>{
 const quote="Boiler blowdown tank: Construct of carbon steel.";
 const result=parseExtraction({requirements:[],products:[{
   name:"carbon steel",
   description:"Tank construction material",
   entityType:"material",
   usageStatus:"required",
   catalogRole:"standalone_item",
   condition:"",
   evidenceIds:["steel"],
   quote,
 }]},[ev("steel",quote)]);
 assert.equal(result.products.length,1);
 assert.equal(result.products[0].selectable,false);
 assert.equal(result.products[0].catalogRole,"constituent_material");
});

test("product extraction cache and imported log versions are bumped",()=>{
 assert.equal(SUBMITTAL_EXTRACTION_VERSION,3);
 assert.equal(SUBMITTAL_LOG_VERSION,3);
 assert.equal(SUBMITTAL_CACHE_PREFIX,"cache/submittals-v3");
});
