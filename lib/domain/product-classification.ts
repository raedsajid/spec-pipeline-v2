import type { Evidence } from "./models";
import { normalize } from "./models";

export type EntityType =
  | "product"
  | "material"
  | "manufacturer"
  | "model"
  | "standard"
  | "performance_property"
  | "unclear";
export type UsageStatus =
  | "required"
  | "permitted"
  | "conditional"
  | "prohibited"
  | "unclear";
export type CatalogRole =
  | "standalone_item"
  | "constituent_material"
  | "attribute"
  | "integral_component"
  | "generic_reference"
  | "unclear";

type Candidate = {
  name: string;
  quote: string;
  entityType?: EntityType;
  usageStatus?: UsageStatus;
  catalogRole?: CatalogRole;
  condition?: string;
};

const escapeRegex = (s: string) =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const genericHeads =
  /\b(?:accessories|assemblies|components|equipment|items|materials|products|work)\b$/i;
const genericModifiers =
  /^(?:all|assembled|associated|complete|entire|general|miscellaneous|related|various)\b/i;
const genericRelations =
  /\b(?:associated with|related to|required for|used with|in connection with)\b/i;
const referenceOnlyAction =
  /^(?:(?:hydrostatically|visually|thoroughly|properly)\s+)?(?:test|inspect|clean|adjust|balance|commission|flush|maintain|operate|paint|protect|service|start|test-and-balance)\b/i;
const installationOnlyAction =
  /^(?:install|erect|apply|connect|mount|place|set)\b/i;
const standaloneProvisionVerb =
  /\b(?:provide|furnish|supply|procure)\b/i;
const componentHeads =
  "body|housing|casing|shell|frame|plate|seat|disc|stem|shaft|cover|liner|lining|coating|finish|gasket|seal|trim|wearing plate|striking plate|impeller|wheel|blade|tube|sheet|jacket";

function labelText(source: Evidence[]) {
  return normalize(
    source
      .flatMap((e) => [e.articleTitle || "", e.context || ""])
      .filter(Boolean)
      .join(" "),
  );
}

function looselySameLabel(a: string, b: string) {
  const clean = (s: string) =>
    normalize(s)
      .replace(/^\d+(?:\.\d+)*\s+/, "")
      .replace(/\b([a-z]{4,})s\b/g, "$1");
  const x = clean(a),
    y = clean(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}

function isLabelLike(s: string) {
  const text = normalize(s);
  return (
    !!text &&
    text.length <= 140 &&
    text.split(/\s+/).length <= 14 &&
    !/[.;]/.test(text) &&
    !/\b(?:shall|must|provide|furnish|supply|install|test|inspect|clean|construct|fabricate|include|including|with)\b/i.test(
      text,
    )
  );
}

function sourceLabelsCandidate(source: Evidence[], name: string) {
  return source.some((e) => {
    const context = e.context || "";
    const article = e.articleTitle || "";
    return (
      (isLabelLike(context) && looselySameLabel(context, name)) ||
      (isLabelLike(article) && looselySameLabel(article, name))
    );
  });
}

/**
 * Classify whether an extracted noun is a catalog-level product.
 *
 * Business rule: a selectable Product must be independently identifiable and
 * reasonably capable of carrying its own submittal. Materials are therefore
 * selectable only when they are standalone specified/procurable items, not
 * merely construction/composition words inside another product description.
 */
export function assessProduct(p: Candidate, source: Evidence[]) {
  const name = normalize(p.name);
  const quote = normalize(p.quote);
  const labels = labelText(source);
  const escaped = escapeRegex(name);

  // Missing legacy fields are intentionally conservative. Strong source cues
  // may reclassify them, but they are never silently treated as product +
  // permitted.
  let entityType: EntityType = p.entityType || "unclear";
  let usageStatus: UsageStatus = p.usageStatus || "unclear";
  let catalogRole: CatalogRole = p.catalogRole || "unclear";
  let reason = "";

  if (
    /\b(?:incorporated|inc\.?|llc|ltd\.?|corporation)\s*$/i.test(p.name) ||
    (/^(?:approved |acceptable )?manufacturers?\s*[:.]?$/i.test(labels.trim()) &&
      !/\b(?:manufactured by|product|material|valve|duct|pipe)\b/i.test(p.quote))
  ) {
    entityType = "manufacturer";
    catalogRole = "attribute";
    reason = "Manufacturer names are attributes, not independently submittable products.";
  }

  if (/^(?:ASTM|ANSI|ISO|ASHRAE|SMACNA|NFPA)\s+[\w.-]+$/i.test(p.name)) {
    entityType = "standard";
    catalogRole = "attribute";
    reason = "Reference standard, not a catalog product.";
  }

  const candidatePattern = new RegExp(`\\b${escaped}\\b`, "i");
  const directProvision = new RegExp(
    `\\b(?:provide|furnish|supply|procure)\\s+(?:(?:an?|the)\\s+)?${escaped}\\b`,
    "i",
  );
  const constructionMaterial = new RegExp(
    `\\b(?:construct(?:ed)?|fabricat(?:e|ed)|made|form(?:ed)?|manufactur(?:e|ed)|compos(?:e|ed)|consist(?:s|ing)?)\\s+(?:primarily\\s+)?(?:of|from|with)\\s+[^.;:]{0,100}\\b${escaped}\\b`,
    "i",
  );
  const componentMaterial = new RegExp(
    `\\b(?:${componentHeads})\\s+(?:(?:shall|must)\\s+be\\s+|is\\s+|are\\s+|of\\s+|:\\s*)${escaped}\\b`,
    "i",
  );
  const materialModifier = new RegExp(
    `\\b${escaped}\\s+(?:[a-z][\\w-]*\\s+){0,2}(?:${componentHeads})\\b`,
    "i",
  );
  const integralIntro = new RegExp(
    `\\b(?:with|including|includes|equipped with|complete with|having|incorporating)\\s+[^.;:]{0,80}\\b${escaped}\\b`,
    "i",
  );
  const copularMaterial = new RegExp(
    `\\b(?:shall|must)\\s+be\\s+${escaped}\\b|\\b(?:is|are)\\s+${escaped}\\b`,
    "i",
  );
  const componentCandidate = new RegExp(
    `\\b${escaped}\\b.*$`,
    "i",
  );
  const componentNamedItem = new RegExp(`(?:${componentHeads})$`, "i").test(
    name,
  );
  const hostConstructionContext =
    /\b(?:construct(?:ed)?|fabricat(?:e|ed)|made|formed|composed|consists?|including|includes|with|equipped with|complete with)\b/i.test(
      quote,
    );

  // Strong semantic overrides. These rules are relational rather than a
  // blacklist of material names, so they generalize across specifications.
  if (
    constructionMaterial.test(quote) ||
    componentMaterial.test(quote) ||
    materialModifier.test(quote) ||
    (entityType === "material" && copularMaterial.test(quote))
  ) {
    catalogRole =
      entityType === "material" ? "constituent_material" : "integral_component";
    reason =
      catalogRole === "constituent_material"
        ? "Material is used as the construction/composition of another item, not specified as a standalone catalog item."
        : "Candidate is described only within another product's construction and is not separately specified.";
  } else if (
    (catalogRole === "integral_component" || integralIntro.test(quote)) &&
    !directProvision.test(quote) &&
    !sourceLabelsCandidate(source, p.name)
  ) {
    catalogRole = "integral_component";
    reason =
      "Candidate appears only as an integral component of another item and is not separately specified.";
  } else if (
    componentNamedItem &&
    componentCandidate.test(quote) &&
    hostConstructionContext &&
    !directProvision.test(quote) &&
    !sourceLabelsCandidate(source, p.name)
  ) {
    catalogRole = "integral_component";
    reason =
      "Component is described only within another product's construction and is not separately specified.";
  }

  if (
    genericRelations.test(name) ||
    genericModifiers.test(name) ||
    genericHeads.test(name)
  ) {
    catalogRole = "generic_reference";
    reason =
      "Generic or collective scope reference, not an independently identifiable catalog item.";
  }

  const labelMatchesCandidate = sourceLabelsCandidate(source, p.name);
  const onlyReferencedByAction =
    (referenceOnlyAction.test(quote) || installationOnlyAction.test(quote)) &&
    candidatePattern.test(quote) &&
    !standaloneProvisionVerb.test(quote) &&
    !labelMatchesCandidate;
  if (onlyReferencedByAction) {
    catalogRole = "generic_reference";
    reason =
      "Candidate is only referenced as the object of installation/testing/maintenance work, not independently specified as a catalog item.";
  }

  // Strong positive source evidence can reclassify conservative legacy data.
  if (
    catalogRole === "unclear" &&
    (directProvision.test(quote) || labelMatchesCandidate)
  ) {
    catalogRole = "standalone_item";
    if (p.entityType === undefined && entityType === "unclear")
      entityType = "product";
    if (
      p.usageStatus === undefined &&
      usageStatus === "unclear" &&
      directProvision.test(quote)
    )
      usageStatus = "required";
  }

  // Explicit prohibition must target the candidate itself. Ingredient
  // exclusions such as "shall not contain asbestos" do not prohibit the host
  // product.
  const subjectBan = new RegExp(
    `(?:^|[.;]\\s*)${escaped}\\s+(?:(?:shall|must)\\s+not\\s+(?:be\\s+)?(?:used|provided|installed|permitted)|(?:is|are)\\s+(?:not\\s+permitted|prohibited))`,
    "i",
  );
  const objectBan = new RegExp(
    `\\bdo not (?:use|install|provide)\\s+${escaped}(?:\\b|$)`,
    "i",
  );
  if (subjectBan.test(quote) || objectBan.test(quote)) {
    usageStatus = /\b(?:unless|except|only if)\b/i.test(quote)
      ? "conditional"
      : "prohibited";
    reason =
      usageStatus === "prohibited"
        ? "Source explicitly prohibits this item in the stated application."
        : "Source contains an exception; verify applicability before selection.";
  }

  if (
    usageStatus !== "unclear" &&
    (p.usageStatus === "conditional" ||
      /\b(?:unless|only where|only if|where indicated|when specified)\b/i.test(
        quote,
      ))
  )
    usageStatus = usageStatus === "prohibited" ? usageStatus : "conditional";

  if (source.some((e) => e.structuralWarning))
    reason = reason || "Source structure is uncertain; verify this candidate.";

  const selectable =
    ["product", "material"].includes(entityType) &&
    catalogRole === "standalone_item" &&
    ["required", "permitted", "conditional"].includes(usageStatus);

  if (!selectable && !reason) {
    if (catalogRole !== "standalone_item")
      reason =
        catalogRole === "unclear"
          ? "Could not verify that this is an independently identifiable/submittable item."
          : "Candidate is not a standalone catalog item.";
    else if (!["product", "material"].includes(entityType))
      reason = "Candidate is not a verified product or standalone material.";
    else reason = "Usage is prohibited or unclear.";
  }

  return {
    entityType,
    usageStatus,
    catalogRole,
    condition:
      usageStatus === "conditional" ? p.condition || p.quote : "",
    selectable,
    classificationReason: reason,
  };
}
