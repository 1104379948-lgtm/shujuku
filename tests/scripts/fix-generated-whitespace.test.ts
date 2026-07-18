import { describe, expect, it } from 'vitest';
import { normalizeGeneratedWhitespace_ACU } from '../../scripts/fix-generated-whitespace.mjs';

describe('fix-generated-whitespace', () => {
  it('清理普通代码上下文中的 space-before-tab 缩进和纯闭合代码行尾空白', () => {
    const input = [
      'function demo() {',
      '    \tconst value = 1;',
      '\t\t} ',
      '}',
      '',
    ].join('\n');

    const result = normalizeGeneratedWhitespace_ACU(input);

    expect(result.text).toBe([
      'function demo() {',
      '\tconst value = 1;',
      '\t\t}',
      '}',
      '',
    ].join('\n'));
    expect(result.fixedIndentLineCount).toBe(1);
    expect(result.fixedClosingLineCount).toBe(1);
  });

  it('保留模板字符串中的物理行空白，仅规范化代码行', () => {
    const input = 'const text = `\n    \tliteral\n  } \n`;\n    \tconst value = 1;\n';
    const result = normalizeGeneratedWhitespace_ACU(input);

    expect(result.text).toBe('const text = `\n    \tliteral\n  } \n`;\n\tconst value = 1;\n');
    expect(result.fixedIndentLineCount).toBe(1);
    expect(result.fixedClosingLineCount).toBe(0);
  });

  it('保留字符串、正则和注释中的物理行空白，且输出幂等', () => {
    const input = [
      "const single = '  } ';",
      'const double = "    \tliteral";',
      'const pattern = /  } $/;',
      '/* block',
      '    \tcomment',
      '  } ',
      '*/',
      '    \tconst value = 1;',
      '',
    ].join('\n');

    const result = normalizeGeneratedWhitespace_ACU(input);
    const repeated = normalizeGeneratedWhitespace_ACU(result.text);

    expect(result.text).toBe([
      "const single = '  } ';",
      'const double = "    \tliteral";',
      'const pattern = /  } $/;',
      '/* block',
      '    \tcomment',
      '  } ',
      '*/',
      '\tconst value = 1;',
      '',
    ].join('\n'));
    expect(result.fixedIndentLineCount).toBe(1);
    expect(result.fixedClosingLineCount).toBe(0);
    expect(result.fixedTrailingWhitespaceLineCount).toBe(0);
    expect(repeated.text).toBe(result.text);
    expect(repeated.fixedIndentLineCount).toBe(0);
    expect(repeated.fixedClosingLineCount).toBe(0);
    expect(repeated.fixedTrailingWhitespaceLineCount).toBe(0);
  });
});
