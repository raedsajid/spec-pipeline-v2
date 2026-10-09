import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateRequirement,
  mayApprove,
  buildBatches,
  RequirementSchema,
} from "../lib/domain/models.ts";
const evidence = [
  {
    id: "p1-l1",
    page: 1,
    text: "Submit shop drawings for the steel doors.",
    source: "pdf",
    section: "08 11 13",
    clause: "1.03",
    box: [0, 0, 1, 0.1],
  },
];
const requirement = {
  title: "Shop drawings",
  text: evidence[0].text,
  type: "shop_drawings",
  evidenceIds: ["p1-l1"],
  quote: evidence[0].text,
  products: ["steel doors"],
  condition: "",
};
test("a batch containing null conditions retains every requirement", () => {
  const batch = Array.from({ length: 9 }, (_, index) => ({
    ...requirement,
    title: `Requirement ${index + 1}`,
    condition: index === 6 || index === 8 ? null : "When specified",
  }));
  const parsed = RequirementSchema.array().parse(batch);
  assert.equal(parsed.length, 9);
  assert.equal(parsed[6].condition, "");
  assert.equal(parsed[8].condition, "");
  assert.equal(parsed[0].condition, "When specified");
  assert.deepEqual(parsed[6].evidenceIds, batch[6].evidenceIds);
  assert.equal(parsed[6].text, batch[6].text);
});
test("missing conditions normalize to empty text and existing text is preserved", () => {
  const { condition, ...missing } = requirement;
  assert.equal(RequirementSchema.parse(missing).condition, "");
  for (const value of ["", "Only where shown on drawings."]) {
    assert.equal(
      RequirementSchema.parse({ ...requirement, condition: value }).condition,
      value,
    );
  }
});
test("condition normalization does not conceal malformed fields", () => {
  for (const condition of [42, false, {}, [], "x".repeat(1501)]) {
    assert.equal(
      RequirementSchema.safeParse({ ...requirement, condition }).success,
      false,
    );
  }
  assert.equal(
    RequirementSchema.safeParse({ ...requirement, condition: null, quote: null })
      .success,
    false,
  );
});
test("null and object product suggestions do not reject a requirement batch", () => {
  const batch = [
    { ...requirement, title: "Requirement 1", products: ["steel doors"] },
    {
      ...requirement,
      title: "Requirement 2",
      products: [null, "valves", { name: "strainers" }, "", "  "],
    },
    { ...requirement, title: "Requirement 3", products: null },
    {
      ...requirement,
      title: "Requirement 4",
      products: [{ name: "hangers" }, null],
    },
  ];
  const parsed = RequirementSchema.array().parse(batch);
  assert.equal(parsed.length, 4);
  assert.deepEqual(parsed[0].products, ["steel doors"]);
  assert.deepEqual(parsed[1].products, ["valves", "strainers"]);
  assert.deepEqual(parsed[2].products, []);
  assert.deepEqual(parsed[3].products, ["hangers"]);
});
test("non-array products still fail validation", () => {
  assert.equal(
    RequirementSchema.safeParse({ ...requirement, products: "steel doors" })
      .success,
    false,
  );
});
test("approval requires both exact evidence and human confirmation", () => {
  const checks = validateRequirement(requirement, evidence);
  assert.deepEqual(checks, { blocking: [], warnings: [] });
  assert.equal(mayApprove({ ...requirement, ...checks }, false, ""), false);
  assert.equal(mayApprove({ ...requirement, ...checks }, true, ""), true);
});
test("invented citations and altered source quotes block approval", () => {
  for (const edit of [
    { evidenceIds: ["fake"] },
    { quote: "Submit aluminum doors." },
  ]) {
    const c = validateRequirement({ ...requirement, ...edit }, evidence);
    assert.ok(c.blocking.length);
    assert.equal(
      mayApprove({ ...requirement, ...c }, true, "Checked manually"),
      false,
    );
  }
});
test("OCR and unsupported products require documented review", () => {
  const c = validateRequirement({ ...requirement, products: ["aluminum"] }, [
    { ...evidence[0], source: "ocr" },
  ]);
  assert.equal(c.warnings.length, 2);
  assert.equal(mayApprove({ ...requirement, ...c }, true, ""), false);
  assert.equal(
    mayApprove({ ...requirement, ...c }, true, "Compared original PDF"),
    true,
  );
});
test("invalid provider output is rejected before storage", () => {
  assert.equal(
    RequirementSchema.safeParse({ ...requirement, type: "invented" }).success,
    false,
  );
  assert.equal(
    RequirementSchema.safeParse({ ...requirement, evidenceIds: [] }).success,
    false,
  );
});
test("every source passage is visited in bounded batches", () => {
  const source = Array.from({ length: 100 }, (_, i) => ({
    ...evidence[0],
    id: String(i),
    text: "x".repeat(200),
  }));
  const batches = buildBatches(source, 1200);
  assert.deepEqual(
    batches.flat().map((e) => e.id),
    source.map((e) => e.id),
  );
  assert.ok(
    batches.every(
      (b) => b.reduce((n, e) => n + e.text.length + 100, 0) <= 1200,
    ),
  );
});
