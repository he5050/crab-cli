#!/usr/bin/env bash
#
# crab-cli 一键安装脚本
#
# 用法:
#   curl -fsSL https://raw.githubusercontent.com/crab-cli/crab-cli/main/scripts/install.sh | bash
#
# 功能:
#   1. 检测操作系统 (macOS/Linux)
#   2. 优先从 GitHub Release 下载预编译二进制（快速、无需 Bun）
#   3. 回退到源码构建（git clone + bun install + bun run build）
#   4. 下载后验证 SHA-256 checksum
#   5. 安装到 /usr/local/bin/crab 或 ~/.local/bin/crab
#   6. 创建 ~/.crab/ 配置目录
#

set -euo pipefail

# ─── 颜色输出 ──────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ─── 配置 ──────────────────────────────────────────────────────────

REPO_URL="https://github.com/crab-cli/crab-cli.git"
GITHUB_API="https://api.github.com/repos/crab-cli/crab-cli/releases/latest"
GITHUB_DOWNLOAD_BASE="https://github.com/crab-cli/crab-cli/releases/download"
INSTALL_DIR="${CRAB_INSTALL_DIR:-$HOME/.crab-cli}"
BUN_INSTALL_URL="https://bun.sh/install"

# ─── 检测操作系统 ──────────────────────────────────────────────────

detect_os() {
  local os_type
  os_type="$(uname -s)"
  case "$os_type" in
    Darwin*)
      echo "macos"
      ;;
    Linux*)
      echo "linux"
      ;;
    MINGW*|MSYS*|CYGWIN*)
      echo "windows"
      ;;
    *)
      error "不支持的操作系统: $os_type"
      error "crab-cli 仅支持 macOS、Linux 和 Windows (WSL)"
      exit 1
      ;;
  esac
}

# ─── 检测架构 ──────────────────────────────────────────────────────

detect_arch() {
  local arch
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64)
      echo "x64"
      ;;
    arm64|aarch64)
      echo "arm64"
      ;;
    *)
      error "不支持的 CPU 架构: $arch"
      exit 1
      ;;
  esac
}

# ─── 获取最新 Release 版本号 ───────────────────────────────────────

get_latest_version() {
  local version=""

  # 尝试通过 GitHub API 获取
  if command -v curl &>/dev/null; then
    version="$(curl -fsSL "$GITHUB_API" 2>/dev/null | grep -o '"tag_name": *"[^"]*"' | head -1 | sed 's/"tag_name": *"//;s/"//')" || true
  elif command -v wget &>/dev/null; then
    version="$(wget -qO- "$GITHUB_API" 2>/dev/null | grep -o '"tag_name": *"[^"]*"' | head -1 | sed 's/"tag_name": *"//;s/"//')" || true
  fi

  # 去除 v 前缀
  version="${version#v}"

  if [ -z "$version" ]; then
    echo ""
    return 1
  fi

  echo "$version"
}

# ─── 下载文件 ──────────────────────────────────────────────────────

download_file() {
  local url="$1"
  local dest="$2"

  if command -v curl &>/dev/null; then
    curl -fsSL -o "$dest" "$url"
  elif command -v wget &>/dev/null; then
    wget -qO "$dest" "$url"
  else
    error "需要 curl 或 wget 来下载文件"
    return 1
  fi
}

# ─── 计算 SHA-256 ─────────────────────────────────────────────────

compute_sha256() {
  local file="$1"
  local hash=""

  if command -v shasum &>/dev/null; then
    hash="$(shasum -a 256 "$file" | awk '{print $1}')"
  elif command -v sha256sum &>/dev/null; then
    hash="$(sha256sum "$file" | awk '{print $1}')"
  else
    error "需要 shasum 或 sha256sum 来验证校验和"
    return 1
  fi

  echo "$hash"
}

# ─── 从 checksums 文件中查找对应文件的校验和 ─────────────────────

lookup_checksum() {
  local checksums_file="$1"
  local filename="$2"
  local hash=""

  if [ -f "$checksums_file" ]; then
    hash="$(grep "  ${filename}$" "$checksums_file" | awk '{print $1}')" || true
  fi

  echo "$hash"
}

# ─── 尝试下载预编译二进制 ─────────────────────────────────────────

try_install_prebuilt() {
  local os_type="$1"
  local arch="$2"

  info "尝试下载预编译二进制..."

  local version
  version="$(get_latest_version)" || true

  if [ -z "$version" ]; then
    warn "无法获取最新版本号，将回退到源码构建"
    return 1
  fi

  info "最新版本: v$version"

  # 构建目标标识 (darwin-arm64, darwin-x64, linux-x64)
  local target=""
  case "$os_type" in
    macos)
      case "$arch" in
        arm64) target="darwin-arm64" ;;
        x64)   target="darwin-x64" ;;
      esac
      ;;
    linux)
      case "$arch" in
        x64) target="linux-x64" ;;
        arm64) target="linux-arm64" ;;
      esac
      ;;
  esac

  if [ -z "$target" ]; then
    warn "不支持的平台组合: $os_type/$arch，将回退到源码构建"
    return 1
  fi

  local archive_name="crab-${target}.tar.gz"
  local checksums_name="checksums.txt"
  local download_url="${GITHUB_DOWNLOAD_BASE}/v${version}/${archive_name}"
  local checksums_url="${GITHUB_DOWNLOAD_BASE}/v${version}/${checksums_name}"

  local tmp_dir
  tmp_dir="$(mktemp -d)"
  trap "rm -rf $tmp_dir" RETURN

  # 下载 checksums 文件
  info "下载校验和文件..."
  if ! download_file "$checksums_url" "$tmp_dir/checksums.txt"; then
    warn "无法下载校验和文件，将回退到源码构建"
    return 1
  fi

  # 下载二进制压缩包
  info "下载预编译二进制: $archive_name"
  if ! download_file "$download_url" "$tmp_dir/$archive_name"; then
    warn "无法下载预编译二进制，将回退到源码构建"
    return 1
  fi

  # 验证 checksum
  local expected_hash actual_hash
  expected_hash="$(lookup_checksum "$tmp_dir/checksums.txt" "$archive_name")"

  if [ -n "$expected_hash" ]; then
    actual_hash="$(compute_sha256 "$tmp_dir/$archive_name")"
    if [ "$actual_hash" != "$expected_hash" ]; then
      error "校验和验证失败！"
      error "  期望: $expected_hash"
      error "  实际: $actual_hash"
      return 1
    fi
    ok "校验和验证通过"
  else
    warn "未找到 $archive_name 的校验和记录，跳过验证（不推荐）"
  fi

  # 解压
  info "解压二进制..."
  tar -xzf "$tmp_dir/$archive_name" -C "$tmp_dir"

  # 查找解压后的 crab 二进制
  local binary_path=""
  if [ -f "$tmp_dir/crab" ]; then
    binary_path="$tmp_dir/crab"
  elif [ -f "$tmp_dir/crab-${target}" ]; then
    binary_path="$tmp_dir/crab-${target}"
  fi

  if [ -z "$binary_path" ]; then
    warn "解压后未找到 crab 二进制文件，将回退到源码构建"
    return 1
  fi

  chmod +x "$binary_path"

  # 安装二进制
  install_binary "$binary_path"

  # 创建配置目录
  create_config_dir

  echo ""
  ok "crab-cli 预编译二进制安装完成！"
  echo ""
  info "使用方法:"
  echo "  crab --help          查看帮助"
  echo "  crab --version       查看版本"
  echo "  crab \"你的问题\"      开始对话"
  echo ""
  info "配置文件位置: $HOME/.crab/config.json"
  echo ""

  return 0
}

# ─── 安装二进制到系统路径 ──────────────────────────────────────────

install_binary() {
  local binary_path="$1"
  local link_path=""
  local os_type
  os_type="$(detect_os)"

  if [ "$os_type" = "macos" ] || [ "$os_type" = "linux" ]; then
    if [ -w "/usr/local/bin" ]; then
      link_path="/usr/local/bin/crab"
    else
      link_path="$HOME/.local/bin/crab"
      mkdir -p "$HOME/.local/bin"
      case ":$PATH:" in
        *":$HOME/.local/bin:"*) ;;
        *)
          warn "请将 ~/.local/bin 添加到 PATH 中:"
          warn "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc"
          warn "  source ~/.bashrc"
          ;;
      esac
    fi
  fi

  if [ -n "$link_path" ]; then
    cp "$binary_path" "$link_path"
    chmod +x "$link_path"
    ok "全局命令已安装: $link_path"
  fi
}

# ─── 检测并安装 Bun ────────────────────────────────────────────────

ensure_bun() {
  if command -v bun &>/dev/null; then
    local bun_version
    bun_version="$(bun --version)"
    ok "Bun 已安装: v$bun_version"
    return 0
  fi

  info "Bun 未检测到，正在安装..."

  if command -v curl &>/dev/null; then
    curl -fsSL "$BUN_INSTALL_URL" | bash
  elif command -v wget &>/dev/null; then
    wget -qO- "$BUN_INSTALL_URL" | bash
  else
    error "需要 curl 或 wget 来安装 Bun"
    exit 1
  fi

  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"

  if command -v bun &>/dev/null; then
    ok "Bun 安装成功: v$(bun --version)"
  else
    error "Bun 安装失败，请手动安装: https://bun.sh"
    exit 1
  fi
}

# ─── 克隆或更新 crab-cli ───────────────────────────────────────────

clone_or_update() {
  if [ -d "$INSTALL_DIR/.git" ]; then
    info "crab-cli 已存在，正在更新..."
    cd "$INSTALL_DIR"
    git pull --ff-only
    ok "crab-cli 已更新到最新版本"
  else
    info "正在克隆 crab-cli 到 $INSTALL_DIR ..."
    git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
    ok "crab-cli 克隆成功"
  fi
}

# ─── 安装依赖并构建 ────────────────────────────────────────────────

install_and_build() {
  cd "$INSTALL_DIR"

  info "正在安装依赖 (bun install)..."
  bun install

  info "正在构建项目 (bun run build)..."
  bun run build

  ok "依赖安装和构建完成"
}

# ─── 创建全局命令链接（源码构建模式）──────────────────────────────

create_symlink() {
  local bin_path="$INSTALL_DIR/bin/crab.ts"
  local link_path=""
  local os_type
  os_type="$(detect_os)"

  if [ "$os_type" = "macos" ] || [ "$os_type" = "linux" ]; then
    if [ -w "/usr/local/bin" ]; then
      link_path="/usr/local/bin/crab"
    else
      link_path="$HOME/.local/bin/crab"
      mkdir -p "$HOME/.local/bin"
      case ":$PATH:" in
        *":$HOME/.local/bin:"*) ;;
        *)
          warn "请将 ~/.local/bin 添加到 PATH 中:"
          warn "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc"
          warn "  source ~/.bashrc"
          ;;
      esac
    fi
  fi

  if [ -n "$link_path" ]; then
    cat > "$link_path" << 'WRAPPER'
#!/usr/bin/env bash
exec bun run "INSTALL_DIR_PLACEHOLDER/bin/crab.ts" "$@"
WRAPPER
    sed -i.bak "s|INSTALL_DIR_PLACEHOLDER|$INSTALL_DIR|g" "$link_path"
    rm -f "${link_path}.bak"
    chmod +x "$link_path"
    ok "全局命令已创建: $link_path"
  fi
}

# ─── 创建配置目录 ──────────────────────────────────────────────────

create_config_dir() {
  local config_dir="$HOME/.crab"

  if [ ! -d "$config_dir" ]; then
    mkdir -p "$config_dir"
    ok "配置目录已创建: $config_dir"
  else
    ok "配置目录已存在: $config_dir"
  fi

  if [ ! -f "$config_dir/config.json" ]; then
    cat > "$config_dir/config.json" << 'CONFIG'
{
  "defaultProvider": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514"
  },
  "providerConfig": {}
}
CONFIG
    ok "默认配置文件已创建: $config_dir/config.json"
  fi
}

# ─── 源码构建安装（回退方案）──────────────────────────────────────

install_from_source() {
  info "回退到源码构建模式..."

  # 1. 检测并安装 Bun
  ensure_bun

  # 2. 克隆或更新 crab-cli
  clone_or_update

  # 3. 安装依赖并构建
  install_and_build

  # 4. 创建全局命令链接
  create_symlink

  # 5. 创建配置目录
  create_config_dir

  echo ""
  ok "crab-cli 源码构建安装完成！"
  echo ""
  info "使用方法:"
  echo "  crab --help          查看帮助"
  echo "  crab --version       查看版本"
  echo "  crab \"你的问题\"      开始对话"
  echo ""
  info "配置文件位置: $HOME/.crab/config.json"
  info "安装目录: $INSTALL_DIR"
  echo ""
}

# ─── 主流程 ────────────────────────────────────────────────────────

main() {
  echo ""
  echo "  ╔══════════════════════════════════════╗"
  echo "  ║        crab-cli 一键安装脚本         ║"
  echo "  ╚══════════════════════════════════════╝"
  echo ""

  # 1. 检测操作系统和架构
  local os_type arch
  os_type="$(detect_os)"
  arch="$(detect_arch)"
  info "操作系统: $os_type ($arch)"

  # 2. 优先尝试预编译二进制安装
  if try_install_prebuilt "$os_type" "$arch"; then
    exit 0
  fi

  # 3. 回退到源码构建
  warn "预编译二进制安装失败，切换到源码构建模式"
  install_from_source
}

main "$@"
