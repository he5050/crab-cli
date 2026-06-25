#!/usr/bin/env bash
#
# crab-cli 一键安装脚本
#
# 用法:
#   curl -fsSL https://raw.githubusercontent.com/crab-cli/crab-cli/main/scripts/install.sh | bash
#
# 功能:
#   1. 检测操作系统 (macOS/Linux)
#   2. 检测并安装 Bun 运行时
#   3. 克隆或下载 crab-cli
#   4. 运行 bun install 和 bun run build
#   5. 创建 crab 全局命令链接
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

# ─── 检测并安装 Bun ────────────────────────────────────────────────

ensure_bun() {
  if command -v bun &>/dev/null; then
    local bun_version
    bun_version="$(bun --version)"
    ok "Bun 已安装: v$bun_version"
    return 0
  fi

  info "Bun 未检测到，正在安装..."
  
  # 尝试使用 curl 下载安装脚本
  if command -v curl &>/dev/null; then
    curl -fsSL "$BUN_INSTALL_URL" | bash
  elif command -v wget &>/dev/null; then
    wget -qO- "$BUN_INSTALL_URL" | bash
  else
    error "需要 curl 或 wget 来安装 Bun"
    exit 1
  fi

  # 加载 Bun 环境变量
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

# ─── 创建全局命令链接 ──────────────────────────────────────────────

create_symlink() {
  local bin_path="$INSTALL_DIR/bin/crab.ts"
  local link_path=""
  local os_type
  os_type="$(detect_os)"

  # 确定链接路径
  if [ "$os_type" = "macos" ] || [ "$os_type" = "linux" ]; then
    # 优先使用 /usr/local/bin，如果没权限则使用 ~/.local/bin
    if [ -w "/usr/local/bin" ]; then
      link_path="/usr/local/bin/crab"
    else
      link_path="$HOME/.local/bin/crab"
      mkdir -p "$HOME/.local/bin"
      # 确保 ~/.local/bin 在 PATH 中
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
    # 创建 wrapper 脚本而非直接符号链接（因为 .ts 需要 bun 运行）
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

  # 创建默认配置文件（如果不存在）
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

# ─── 主流程 ────────────────────────────────────────────────────────

main() {
  echo ""
  echo "  ╔══════════════════════════════════════╗"
  echo "  ║        crab-cli 一键安装脚本         ║"
  echo "  ╚══════════════════════════════════════╝"
  echo ""

  # 1. 检测操作系统
  local os_type
  os_type="$(detect_os)"
  local arch
  arch="$(detect_arch)"
  info "操作系统: $os_type ($arch)"

  # 2. 检测并安装 Bun
  ensure_bun

  # 3. 克隆或更新 crab-cli
  clone_or_update

  # 4. 安装依赖并构建
  install_and_build

  # 5. 创建全局命令链接
  create_symlink

  # 6. 创建配置目录
  create_config_dir

  echo ""
  ok "crab-cli 安装完成！"
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

main "$@"
