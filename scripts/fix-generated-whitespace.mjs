import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const artifactPaths = [
  path.join(process.cwd(), 'dist', 'index.bundle.js'),
  path.join(process.cwd(), 'index.js'),
];

const literalTokenKinds = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.RegularExpressionLiteral,
]);

const commentTokenKinds = new Set([
  ts.SyntaxKind.SingleLineCommentTrivia,
  ts.SyntaxKind.MultiLineCommentTrivia,
]);

function getProtectedRanges_ACU(input) {
  const protectedRanges = [];
  const markRange = (start, end) => {
    if (end > start) protectedRanges.push([start, end]);
  };

  const sourceFile = ts.createSourceFile('generated.js', input, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  const visit = node => {
    if (literalTokenKinds.has(node.kind)) markRange(node.getStart(sourceFile), node.getEnd());
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, input);
  let kind;
  while ((kind = scanner.scan()) !== ts.SyntaxKind.EndOfFileToken) {
    if (commentTokenKinds.has(kind)) markRange(scanner.getTokenPos(), scanner.getTextPos());
  }
  return protectedRanges;
}

function overlapsProtectedRange_ACU(start, end, protectedRanges) {
  return protectedRanges.some(([rangeStart, rangeEnd]) => start < rangeEnd && end > rangeStart);
}

export function normalizeGeneratedWhitespace_ACU(input) {
  let fixedIndentLineCount = 0;
  let fixedClosingLineCount = 0;
  let fixedTrailingWhitespaceLineCount = 0;
  const text = String(input);
  const lines = text.split(/(\r?\n)/);
  const protectedRanges = getProtectedRanges_ACU(text);
  let offset = 0;
  for (let i = 0; i < lines.length; i += 2) {
    const originalLine = lines[i];
    let line = originalLine;
    line = line.replace(/^( +)(\t+)/, (match, _spaces, tabs) => {
      if (overlapsProtectedRange_ACU(offset, offset + match.length, protectedRanges)) return match;
      fixedIndentLineCount += 1;
      return tabs;
    });
    line = line.replace(/^([\t ]*[})\];,]+) +$/, (match, code) => {
      if (overlapsProtectedRange_ACU(offset, offset + match.length, protectedRanges)) return match;
      fixedClosingLineCount += 1;
      return code;
    });
    line = line.replace(/[\t ]+$/, match => {
      const start = offset + originalLine.length - match.length;
      if (overlapsProtectedRange_ACU(start, offset + originalLine.length, protectedRanges)) return match;
      fixedTrailingWhitespaceLineCount += 1;
      return '';
    });
    lines[i] = line;
    offset += originalLine.length + (lines[i + 1]?.length ?? 0);
  }
  return {
    text: lines.join(''),
    fixedIndentLineCount,
    fixedClosingLineCount,
    fixedTrailingWhitespaceLineCount,
  };
}

function runCli() {
  let fixedIndentLineCount = 0;
  let fixedClosingLineCount = 0;
  let fixedTrailingWhitespaceLineCount = 0;
  for (const artifactPath of artifactPaths) {
    if (!fs.existsSync(artifactPath)) continue;
    const original = fs.readFileSync(artifactPath, 'utf8');
    const result = normalizeGeneratedWhitespace_ACU(original);
    fixedIndentLineCount += result.fixedIndentLineCount;
    fixedClosingLineCount += result.fixedClosingLineCount;
    fixedTrailingWhitespaceLineCount += result.fixedTrailingWhitespaceLineCount;
    if (result.text !== original) fs.writeFileSync(artifactPath, result.text, 'utf8');
  }
  console.log(
    `[fix-generated-whitespace] normalized ${fixedIndentLineCount} generated indentation line(s), `
    + `${fixedClosingLineCount} generated closing line(s), `
    + `${fixedTrailingWhitespaceLineCount} generated trailing-whitespace line(s).`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) runCli();
