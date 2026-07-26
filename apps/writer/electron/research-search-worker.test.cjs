const assert = require("node:assert/strict");
const test = require("node:test");
const {
  Document,
  Packer,
  Paragraph,
} = require("docx");

const {
  normalizePdfPageItems,
} = require("./research-search-worker.cjs");
const {
  runResearchExtractionWorker,
} = require("./research-search-extractors.cjs");

function createPdfFixture({ text = true } = {}) {
  const content = [
    "BT",
    "/F1 16 Tf",
    "72 710 Td",
    ...(text ? [
      "(Research Search Worker) Tj",
      "0 -30 Td",
      "(Second searchable line) Tj",
    ] : []),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "binary");
}

test("PDF item normalization preserves CJK adjacency and separates Latin words and lines", () => {
  assert.equal(normalizePdfPageItems([
    { str: "研究" },
    { str: "方法", hasEOL: true },
    { str: "two" },
    { str: "words" },
  ]), "研究方法\ntwo words");
});

test("PDF extraction runs outside the main thread and returns bounded page ranges", async () => {
  const progress = [];
  const extracted = await runResearchExtractionWorker({
    kind: "pdf",
    bytes: createPdfFixture(),
    limits: {
      maxCharacters: 10_000,
      maxPdfPages: 10,
      maxInputBytes: 1024 * 1024,
    },
  }, {
    onProgress: (value) => progress.push(value),
  });
  assert.match(extracted.body, /Research Search Worker/);
  assert.match(extracted.body, /Second searchable line/);
  assert.deepEqual(extracted.pages, [{
    page: 1,
    start: 0,
    end: extracted.body.length,
  }]);
  assert.equal(extracted.truncated, false);
  assert.equal(progress.at(-1).completed, 1);
});

test("scanned or image-only PDF pages remain valid searchable metadata with no invented text", async () => {
  const extracted = await runResearchExtractionWorker({
    kind: "pdf",
    bytes: createPdfFixture({ text: false }),
    limits: {
      maxCharacters: 10_000,
      maxPdfPages: 10,
      maxInputBytes: 1024 * 1024,
    },
  });
  assert.equal(extracted.body, "");
  assert.deepEqual(extracted.pages, [{ page: 1, start: 0, end: 0 }]);
  assert.equal(extracted.truncated, false);
});

test("DOCX extraction runs in the worker and rejects damaged archives", async () => {
  const bytes = await Packer.toBuffer(new Document({
    sections: [{
      children: [
        new Paragraph("DOCX 资料正文"),
        new Paragraph("可搜索的第二段"),
      ],
    }],
  }));
  const extracted = await runResearchExtractionWorker({
    kind: "docx",
    bytes,
    limits: {
      maxCharacters: 10_000,
      maxInputBytes: 1024 * 1024,
    },
  });
  assert.match(extracted.body, /DOCX 资料正文/);
  assert.match(extracted.body, /可搜索的第二段/);
  await assert.rejects(
    () => runResearchExtractionWorker({
      kind: "docx",
      bytes: Buffer.from("not-a-docx"),
    }),
    /ZIP|压缩|archive|central|signature/i,
  );
});

test("an already aborted extraction never starts a worker", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => runResearchExtractionWorker({
      kind: "pdf",
      bytes: createPdfFixture(),
    }, {
      signal: controller.signal,
      WorkerApi: class UnexpectedWorker {
        constructor() {
          throw new Error("worker should not start");
        }
      },
    }),
    (error) => error?.name === "AbortError",
  );
});
