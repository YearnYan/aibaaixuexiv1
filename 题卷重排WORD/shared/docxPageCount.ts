import JSZip from "jszip";

const ESTIMATED_CHARACTERS_PER_PAGE = 1_500;

export async function resolveDocxPageCount(content: ArrayBuffer | Uint8Array) {
  const zip = await JSZip.loadAsync(content);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) throw new Error("Word 文档缺少正文内容。");

  const appProperties = await zip.file("docProps/app.xml")?.async("string");
  const metadataPageCount = Number(
    /<(?:\w+:)?Pages>(\d+)<\/(?:\w+:)?Pages>/u.exec(appProperties || "")?.[1],
  );
  if (Number.isSafeInteger(metadataPageCount) && metadataPageCount > 0) {
    return metadataPageCount;
  }

  const documentXml = await documentFile.async("string");
  const visibleTextLength = [...documentXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/gu)]
    .reduce((total, match) => total + stripXmlTags(match[1]).length, 0);
  const explicitPageBreaks = countMatches(documentXml, /<w:br\b[^>]*w:type=["']page["'][^>]*\/?\s*>/gu)
    + countMatches(documentXml, /<w:lastRenderedPageBreak\b[^>]*\/?\s*>/gu);
  return Math.max(
    1,
    explicitPageBreaks + 1,
    Math.ceil(visibleTextLength / ESTIMATED_CHARACTERS_PER_PAGE),
  );
}

function countMatches(value: string, pattern: RegExp) {
  return [...value.matchAll(pattern)].length;
}

function stripXmlTags(value: string) {
  return value.replace(/<[^>]+>/gu, "").trim();
}
