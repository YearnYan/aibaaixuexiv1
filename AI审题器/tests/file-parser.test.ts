import { describe, expect, it } from "vitest";
import { parseUploadedFiles } from "../server/file-parser";

function mockFile(name: string, mimeType: string, content: string): Express.Multer.File {
  const buffer = Buffer.from(content);
  return {
    fieldname: "files",
    originalname: name,
    encoding: "7bit",
    mimetype: mimeType,
    size: buffer.length,
    destination: "",
    filename: name,
    path: "",
    buffer,
    stream: null as never,
  };
}

describe("上传文件解析", () => {
  it("合并文本资料并保留文件名", async () => {
    const result = await parseUploadedFiles([
      mockFile("题目.txt", "text/plain", "求阴影部分面积。"),
      mockFile("补充.md", "text/markdown", "单位：平方厘米"),
    ]);
    expect(result.text).toContain("求阴影部分面积");
    expect(result.text).toContain("单位：平方厘米");
    expect(result.fileNames).toHaveLength(2);
  });

  it("把图片转换为仅供服务端调用模型的数据", async () => {
    const result = await parseUploadedFiles([mockFile("question.png", "image/png", "fake-image")]);
    expect(result.text).toBe("");
    expect(result.images[0]).toEqual({
      mimeType: "image/png",
      data: Buffer.from("fake-image").toString("base64"),
    });
  });

  it("明确拒绝旧版 DOC 格式", async () => {
    await expect(parseUploadedFiles([mockFile("旧试卷.doc", "application/msword", "content")])).rejects.toThrow(
      "请另存为 DOCX",
    );
  });
});
