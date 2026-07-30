import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanText,
  detectFileKind,
  extractJsonObject,
  isAllowedFile,
  normalizeUploadFilename,
  sliceTextPreservingFormulas,
  truncateSourceText,
  validateOptions
} from "../src/utils.js";

test("文本清理移除 HTML 但保留数学比较符", () => {
  const cleaned = cleanText("<b>结论</b>：当 k < 0 且 b > 0 时，-1 < m < 2。<!--说明-->");

  assert.equal(cleaned, "结论：当 k < 0 且 b > 0 时，-1 < m < 2。");
});

test("文本长度限制不会从 LaTeX 公式中间截断", () => {
  const title = String.raw`物理：$\vec{F}$ 与 $\vec{a}$`;
  const cleaned = cleanText(title, 18);

  assert.equal(cleaned, title);
  assert.equal(sliceTextPreservingFormulas(String.raw`前文 $\frac{a}{b}$ 后文`, 10), String.raw`前文 $\frac{a}{b}$`);
  assert.equal(sliceTextPreservingFormulas(String.raw`前文 $\frac{a`, 8), "前文");
});

test("文件类型同时校验扩展名与 MIME", () => {
  assert.equal(isAllowedFile({ originalname: "课文.docx", mimetype: "" }), true);
  assert.equal(isAllowedFile({ originalname: "课文.pdf", mimetype: "application/pdf" }), true);
  assert.equal(isAllowedFile({ originalname: "脚本.exe", mimetype: "application/octet-stream" }), false);
  assert.equal(detectFileKind({ originalname: "图片.JPG" }), "image");
});

test("上传文件名兼容 UTF-8 与 multipart Latin-1 解码", () => {
  const filename = "学习资料-验收.docx";
  const latin1Decoded = Buffer.from(filename, "utf8").toString("latin1");

  assert.equal(normalizeUploadFilename(latin1Decoded), filename);
  assert.equal(normalizeUploadFilename(filename), filename);
  assert.equal(normalizeUploadFilename("lesson.pdf"), "lesson.pdf");
});

test("能从代码围栏和附加说明中提取 JSON", () => {
  assert.deepEqual(extractJsonObject("```json\n{\"ok\":true}\n```"), { ok: true });
  assert.deepEqual(extractJsonObject("结果如下：{\"title\":\"课文\"} 完成"), { title: "课文" });
});

test("能安全修复 JSON 字符串内控制字符和尾随逗号", () => {
  const malformed = "{\"text\":\"第一行\n第二行\",\"items\":[1,2,],}";

  assert.deepEqual(extractJsonObject(malformed), {
    text: "第一行\n第二行",
    items: [1, 2]
  });
});

test("学习选项和长文本按边界规范化", () => {
  assert.deepEqual(validateOptions({
    grade: " 八年级 ",
    subject: "语文",
    goal: "unknown",
    depth: "detailed"
  }), {
    grade: "八年级",
    subject: "语文",
    goal: "understand",
    depth: "detailed"
  });

  const result = truncateSourceText("一".repeat(20), 8);
  assert.equal(result.truncated, true);
  assert.match(result.text, /后续内容/);
});
