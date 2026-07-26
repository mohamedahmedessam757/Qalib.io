const fs = require("fs");
const JSZip = require("jszip");

async function main() {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.folder("_rels").file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.folder("word").file(
    "document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>اختبار قاليب - Qalib test document</w:t></w:r></w:p>
    <w:p><w:r><w:t>سطر ثاني للتعديل</w:t></w:r></w:p>
    <w:sectPr/>
  </w:body>
</w:document>`,
  );

  const buf = await zip.generateAsync({ type: "nodebuffer" });
  fs.mkdirSync("public/samples", { recursive: true });
  fs.writeFileSync("public/samples/qalib-test.docx", buf);
  console.log("wrote", buf.length, "bytes");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
