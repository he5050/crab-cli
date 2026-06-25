#!/usr/bin/env bash
#
# crab-cli 预编译二进制构建脚本
#
# 使用 bun build --compile 生成独立二进制文件，支持多平台交叉编译。
# 目标平台: darwin-arm64, darwin-x64, linux-x64
#
# 用法:
#   ./scripts/build-binaries.sh           # 构建当前平台
#   ./scripts/build-binaries.sh all       # 构建所有可用平台
#   ./scripts/build-binaries.sh darwin-arm64  # 构建指定平台
#
# 输出:
#   dist/binaries/crab-{platform}-{arch}  — 独立二进制
#   dist/binaries/checksums.txt           — SHA-256 校验和
#   dist/binaries/crab-{platform}-{arch}.tar.gz — 压缩包
#

set -euo pipefail

# ─── 颜色输出 ──────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ─── 配置 ──────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="$PROJECT_ROOT/dist/binaries"

# 支持的目标平台
ALL_TARGETS=("darwin-arm64" "darwin-x64" "linux-x64")

# ─── 检测当前平台 ──────────────────────────────────────────────────

detect_current_target() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Darwin)
      case "$arch" in
        arm64) echo "darwin-arm64" ;;
        x86_64) echo "darwin-x64" ;;
      esac
      ;;
    Linux)
      case "$arch" in
        x86_64|amd64) echo "linux-x64" ;;
      esac
      ;;
  esac
}

# ─── 检查 Bun 是否安装 ─────────────────────────────────────────────

ensure_bun() {
  if ! command -v bun &>/dev/null; then
    export PATH="$HOME/.bun/bin:$PATH"
  fi

  if ! command -v bun &>/dev/null; then
    error "Bun 未安装。请先安装: https://bun.sh"
    exit 1
  fi

  ok "Bun 版本: $(bun --version)"
}

# ─── 读取版本号 ────────────────────────────────────────────────────

get_version() {
  local version
  version="$(bun -e 'console.log(require("./package.json").version)')"
  echo "$version"
}

# ─── 构建单个目标 ──────────────────────────────────────────────────

build_target() {
  local target="$1"
  local version
  version="$(get_version)"

  # 解析平台和架构
  local platform arch
  platform="${target%%-*}"
  arch="${target##*-}"

  # 映射到 bun build --compile 的 target
  local bun_target
  case "$target" in
    darwin-arm64) bun_target="bun-darwin-arm64" ;;
    darwin-x64)   bun_target="bun-darwin-x64" ;;
    linux-x64)    bun_target="bun-linux-x64" ;;
    *)
      error "不支持的目标平台: $target"
      return 1
      ;;
  esac

  local binary_name="crab-${target}"
  local binary_path="$OUTPUT_DIR/$binary_name"

  info "构建 $target (bun target: $bun_target)..."

  # 使用项目已有的 build.ts 配置，通过 bun build --compile 生成独立二进制
  # build.ts 导出了 createBuildOptions，我们通过 bun -e 调用它
  bun -e "
    import { createBuildOptions } from './build';

    const result = await Bun.build(createBuildOptions({
      minify: true,
      sourcemap: 'none',
      outdir: '$OUTPUT_DIR',
      compile: {
        target: '$bun_target',
        outfile: '$binary_path',
        autoloadPackageJson: false,
        autoloadTsconfig: true,
        autoloadDotenv: false,
        autoloadBunfig: false,
      },
    }));

    if (!result.success) {
      console.error('构建失败: $target');
      for (const msg of result.logs) console.error(msg);
      process.exit(1);
    }
    console.log('构建完成: $target -> $binary_path');
  "

  if [ ! -f "$binary_path" ]; then
    error "二进制文件未生成: $binary_path"
    return 1
  fi

  chmod +x "$binary_path"
  ok "二进制已生成: $binary_name"

  # 复制数据库迁移文件到二进制同目录（用于打包）
  local migrations_src="$PROJECT_ROOT/src/db/migrations"
  if [ -d "$migrations_src" ]; then
    local staging_dir="$OUTPUT_DIR/staging-$target"
    rm -rf "$staging_dir"
    mkdir -p "$staging_dir/db"
    cp "$binary_path" "$staging_dir/crab"
    cp -r "$migrations_src" "$staging_dir/db/migrations"
    ok "已复制数据库迁移文件"
  fi

  # 压缩为 tar.gz
  local archive_path="$OUTPUT_DIR/${binary_name}.tar.gz"
  if [ -d "$OUTPUT_DIR/staging-$target" ]; then
    tar -czf "$archive_path" -C "$OUTPUT_DIR/staging-$target" .
    rm -rf "$OUTPUT_DIR/staging-$target"
  else
    tar -czf "$archive_path" -C "$OUTPUT_DIR" "$binary_name"
  fi
  ok "压缩包已生成: ${binary_name}.tar.gz"
}

# ─── 生成 checksums.txt ───────────────────────────────────────────

generate_checksums() {
  local checksums_file="$OUTPUT_DIR/checksums.txt"
  local version
  version="$(get_version)"

  info "生成 SHA-256 校验和..."

  # 为所有 tar.gz 文件生成校验和
  : > "$checksums_file"
  for archive in "$OUTPUT_DIR"/crab-*.tar.gz; do
    if [ -f "$archive" ]; then
      local hash filename
      hash="$(shasum -a 256 "$archive" | awk '{print $1}')"
      filename="$(basename "$archive")"
      echo "${hash}  ${filename}" >> "$checksums_file"
      ok "checksum: $filename"
    fi
  done

  # 也为裸二进制生成校验和
  for binary in "$OUTPUT_DIR"/crab-darwin-* "$OUTPUT_DIR"/crab-linux-*; do
    if [ -f "$binary" ]; then
      local hash filename
      hash="$(shasum -a 256 "$binary" | awk '{print $1}')"
      filename="$(basename "$binary")"
      echo "${hash}  ${filename}" >> "$checksums_file"
      ok "checksum: $filename"
    fi
  done

  ok "校验和文件: $checksums_file"
}

# ─── 主流程 ────────────────────────────────────────────────────────

main() {
  echo ""
  echo "  ╔══════════════════════════════════════╗"
  echo "  ║     crab-cli 预编译二进制构建       ║"
  echo "  ╚══════════════════════════════════════╝"
  echo ""

  ensure_bun

  # 准备输出目录
  rm -rf "$OUTPUT_DIR"
  mkdir -p "$OUTPUT_DIR"
  ok "输出目录: $OUTPUT_DIR"

  local version
  version="$(get_version)"
  info "版本: v$version"

  # 确定要构建的目标
  local targets_to_build=()
  local mode="${1:-current}"

  case "$mode" in
    all)
      targets_to_build=("${ALL_TARGETS[@]}")
      info "构建所有目标平台: ${ALL_TARGETS[*]}"
      ;;
    current|"")
      local current_target
      current_target="$(detect_current_target)"
      if [ -z "$current_target" ]; then
        error "无法检测当前平台，请指定目标: all | darwin-arm64 | darwin-x64 | linux-x64"
        exit 1
      fi
      targets_to_build=("$current_target")
      info "构建当前平台: $current_target"
      ;;
    *)
      # 验证指定的目标是否支持
      local found=false
      for t in "${ALL_TARGETS[@]}"; do
        if [ "$t" = "$mode" ]; then
          found=true
          break
        fi
      done
      if [ "$found" = false ]; then
        error "不支持的目标: $mode"
        error "支持的目标: ${ALL_TARGETS[*]}"
        exit 1
      fi
      targets_to_build=("$mode")
      info "构建指定平台: $mode"
      ;;
  esac

  # 逐个构建
  local success_count=0
  local fail_count=0
  for target in "${targets_to_build[@]}"; do
    if build_target "$target"; then
      ((success_count++))
    else
      ((fail_count++))
      warn "构建失败: $target"
    fi
  done

  # 生成 checksums
  if [ $success_count -gt 0 ]; then
    generate_checksums
  fi

  echo ""
  if [ $fail_count -eq 0 ]; then
    ok "全部构建完成！成功: $success_count, 失败: $fail_count"
  else
    warn "构建完成（部分失败）。成功: $success_count, 失败: $fail_count"
  fi
  echo ""
  info "输出目录: $OUTPUT_DIR"
  info "文件列表:"
  ls -lh "$OUTPUT_DIR"/ 2>/dev/null | tail -n +2 | while read -r line; do
    echo "    $line"
  done
  echo ""
}

main "$@"
