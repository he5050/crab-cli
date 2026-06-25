# typed: false
# frozen_string_literal: true

# crab-cli Homebrew Formula
#
# 安装方式:
#   brew tap crab-cli/tap
#   brew install crab
#
# 或直接从 Formula 文件安装:
#   brew install --formula ./scripts/homebrew/crab.rb
#
# 注意: sha256 值需要在每次发布新版本时更新。
#       可通过 `shasum -a 256 crab-cli-v0.5.0.tar.gz` 获取。

class Crab < Formula
  desc "AI Coding Assistant — Multi-Agent + MCP + TUI"
  homepage "https://github.com/crab-cli/crab-cli"
  url "https://github.com/crab-cli/crab-cli/archive/refs/tags/v0.5.0.tar.gz"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"
  license "MIT"
  head "https://github.com/crab-cli/crab-cli.git", branch: "main"

  # 构建依赖
  depends_on "bun" => :build

  def install
    # 安装依赖
    system "bun", "install"

    # 构建项目
    system "bun", "run", "build"

    # 安装二进制入口
    # 使用 bin/crab.ts 作为入口（需要 bun 运行时）
    # 同时安装编译后的 dist/index.js 作为 fallback
    bin.install "bin/crab.ts" => "crab"
  end

  test do
    # 验证版本输出
    assert_match "crab v", shell_output("#{bin}/crab --version")
  end
end
