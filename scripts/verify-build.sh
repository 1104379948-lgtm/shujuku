#!/usr/bin/env bash
# scripts/verify-build.sh
# 自动执行 rollup 构建 + 基线比对 + 报告结果
#
# 使用方法：
#   bash scripts/verify-build.sh          # 默认 concat 模式
#   bash scripts/verify-build.sh module   # module 模式（功能等价验证）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_FILE="$ROOT/dist/index.bundle.js"
BASELINE="$ROOT/index.js"

MODE="${1:-module}"

echo "═══════════════════════════════════════════════"
echo "  verify-build.sh — 构建验证"
echo "  模式: $MODE"
echo "═══════════════════════════════════════════════"
echo ""

# 步骤 1：运行 rollup 构建
echo "[1/5] 运行 rollup 构建 (BUILD_MODE=$MODE)..."
cd "$ROOT"
BUILD_MODE="$MODE" npx rollup -c --silent 2>&1
echo "      ✓ 构建完成"

# 步骤 2：检查产物是否存在
if [ ! -f "$DIST_FILE" ]; then
  echo "      ✗ 构建产物不存在: $DIST_FILE"
  exit 1
fi

DIST_LINES=$(wc -l < "$DIST_FILE" | tr -d ' ')
echo "      产物行数: $DIST_LINES"

# 步骤 2：基线比对
echo ""
if [ "$MODE" = "concat" ]; then
  echo "[2/5] 逐字节比对 (concat 模式)..."
  if diff "$DIST_FILE" "$BASELINE" > /dev/null 2>&1; then
    echo "      ✓ 构建产物与基线 index.js 完全一致"
  else
    echo "      ✗ 构建产物与基线不一致！"
    echo ""
    # 显示首处差异
    DIFF_LINE=$(diff "$DIST_FILE" "$BASELINE" | head -20)
    echo "$DIFF_LINE"
    exit 1
  fi
else
  echo "[2/5] 功能等价模式 — 跳过逐字节比对"
  echo "      产物已生成，请在 SillyTavern 中手动验证功能等价性"
fi

# 步骤 3：UserScript 头检查
echo ""
echo "[3/5] UserScript 头检查..."
FIRST_LINE=$(head -1 "$DIST_FILE")
if echo "$FIRST_LINE" | grep -q "==UserScript=="; then
  echo "      ✓ UserScript 头存在于产物顶部"
else
  echo "      ✗ UserScript 头缺失！首行: $FIRST_LINE"
  exit 1
fi

# 步骤 4：sql-wasm.wasm 完整性检查（wasm 引擎必须随产物分发）
echo ""
echo "[4/5] sql-wasm.wasm 完整性检查..."
WASM_SOURCE="$ROOT/node_modules/sql.js/dist/sql-wasm.wasm"
if [ ! -f "$WASM_SOURCE" ]; then
  echo "      ✗ sql.js wasm 源缺失: $WASM_SOURCE"
  exit 1
fi
EXPECTED_SHA=$(node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('$WASM_SOURCE')).digest('hex'))" 2>&1)
case "$MODE" in
  extension)
    WASM_TARGET_DIRS=("$ROOT/dist/extension")
    ;;
  all)
    WASM_TARGET_DIRS=("$ROOT/dist" "$ROOT/dist/extension" "$ROOT/dist/plus-assistantembedded")
    ;;
  concat|userscript)
    WASM_TARGET_DIRS=("$ROOT/dist")
    ;;
  module)
    # module 模式产物与 concat 相同（dist/index.bundle.js）
    WASM_TARGET_DIRS=("$ROOT/dist")
    ;;
  *)
    WASM_TARGET_DIRS=("$ROOT/dist")
    ;;
esac
WASM_CHECK_FAILED=0
for dir in "${WASM_TARGET_DIRS[@]}"; do
  wasm_file="$dir/sql-wasm.wasm"
  if [ ! -f "$wasm_file" ]; then
    echo "      ✗ 缺失: $wasm_file"
    WASM_CHECK_FAILED=1
    continue
  fi
  ACTUAL_SHA=$(node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('$wasm_file')).digest('hex'))" 2>&1)
  if [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then
    echo "      ✗ hash 不一致: $wasm_file ($ACTUAL_SHA != $EXPECTED_SHA)"
    WASM_CHECK_FAILED=1
  else
    echo "      ✓ $wasm_file (sha256 $ACTUAL_SHA)"
  fi
done
if [ "$WASM_CHECK_FAILED" -ne 0 ]; then
  echo "      ✗ sql-wasm.wasm 缺失或 hash 不一致！请检查构建产物。"
  exit 1
fi

# 步骤 5：重复声明检测（致命检查）
# 只检查 IIFE 顶级作用域（缩进 2 空格）的 _ACU 后缀声明
# 这是注入式迁移最容易犯的错误：旧文件残留声明 + 注入模块新声明 → 运行时 SyntaxError
echo ""
echo "[5/5] 重复声明检测 (_ACU 顶级标识符)..."
DUP_RESULT=$(node -e "
const fs = require('fs');
const code = fs.readFileSync('$DIST_FILE', 'utf8');
const re = /^  (?:export\s+)?(?:const|let|function)\s+([\w]+_ACU)\b/gm;
const counts = {};
let m;
while ((m = re.exec(code)) !== null) {
  const name = m[1];
  if (!counts[name]) counts[name] = 0;
  counts[name]++;
}
const dups = Object.entries(counts).filter(([k, v]) => v > 1);
if (dups.length) {
  dups.forEach(([k, v]) => console.log('  ✗ ' + k + ': ' + v + '次'));
  process.exit(1);
} else {
  console.log('      ✓ 无顶级 _ACU 重复声明');
}
" 2>&1)
DUP_EXIT=$?
echo "$DUP_RESULT"
if [ $DUP_EXIT -ne 0 ]; then
  echo ""
  echo "      ✗ 发现重复声明！这会导致运行时 SyntaxError，脚本完全无法加载。"
  echo "      请检查迁移后旧文件是否有残留声明未删除。"
  exit 1
fi

echo ""
echo "═══════════════════════════════════════════════"
echo "  ✓ 验证通过（5/5 项检查均通过）"
echo "═══════════════════════════════════════════════"
