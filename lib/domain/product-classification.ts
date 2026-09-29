import type { Evidence } from "./models";
import { normalize } from "./models";
export type EntityType = "product"|"material"|"manufacturer"|"model"|"standard"|"performance_property"|"unclear";
export type UsageStatus = "required"|"permitted"|"conditional"|"prohibited"|"unclear";
export function assessProduct(p:{name:string;quote:string;entityType?:EntityType;usageStatus?:UsageStatus;condition?:string}, source:Evidence[]) {
  const name=normalize(p.name), quote=normalize(p.quote);
  const context=source.map(e=>e.context || "").join(" ");
  let entityType:EntityType=p.entityType || "product";
  let usageStatus:UsageStatus=p.usageStatus || "permitted";
  let reason="";
  if (/\b(?:incorporated|inc\.?|llc|ltd\.?|corporation)\s*$/i.test(p.name) || (/^(?:approved |acceptable )?manufacturers?\s*[:.]?$/i.test(context.trim()) && !/\b(?:manufactured by|product|material|valve|duct|pipe)\b/i.test(p.quote))) {
    entityType="manufacturer"; reason="Manufacturer names are attributes, not selectable products.";
  }
  if (/^(?:ASTM|ANSI|ISO|ASHRAE|SMACNA|NFPA)\s+[\w.-]+$/i.test(p.name)) {entityType="standard";reason="Reference standard, not a product.";}
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  // Require the prohibition to target this candidate. Ingredient exclusions
  // such as 'shall not contain asbestos' do not prohibit the whole product.
  const subjectBan=new RegExp('(?:^|[.;]\\s*)'+escaped+'\\s+(?:(?:shall|must)\\s+not\\s+(?:be\\s+)?(?:used|provided|installed|permitted)|(?:is|are)\\s+(?:not\\s+permitted|prohibited))');
  const objectBan=new RegExp('\\bdo not (?:use|install|provide)\\s+'+escaped+'(?:\\b|$)');
  if(subjectBan.test(quote)||objectBan.test(quote)) {
    usageStatus=/\b(?:unless|except|only if)\b/.test(quote)?"conditional":"prohibited";
    reason=usageStatus==="prohibited"?"Source explicitly prohibits this item in the stated application.":"Source contains an exception; verify applicability before selection.";
  }
  if(p.usageStatus!=="unclear" && (p.usageStatus==="conditional" || /\b(?:unless|only where|only if|where indicated|when specified)\b/.test(quote))) usageStatus=usageStatus==="prohibited"?usageStatus:"conditional";
  if(source.some(e=>e.structuralWarning)) {reason=reason || "Source structure is uncertain; verify this candidate.";}
  const selectable=["product","material"].includes(entityType) && ["required","permitted","conditional"].includes(usageStatus);
  if(!selectable && !reason) reason=entityType==="product"||entityType==="material"?"Usage is prohibited or unclear.":"Candidate is not a verified product or material.";
  return {entityType,usageStatus,condition:usageStatus==="conditional"?(p.condition || p.quote):"",selectable,classificationReason:reason};
}
