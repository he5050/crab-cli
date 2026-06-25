#!/usr/bin/env bash
# 使用真实 LLM 配置运行测试
# 用法: ./scripts/test-with-real-llm.sh [test file/pattern]

set -euo pipefail

export CRAB_REAL_ENV_TESTS=1

echo "=========================================="
echo " 使用真实 LLM 配置运行测试"
echo " 配置路径: ~/.crab/config.json"
echo "=========================================="
echo ""

if [ $# -eq 0 ]; then
  # 默认运行所有单元测试，跳过需要外部服务的集成测试
  echo "运行单元测试..."
  PATH="$HOME/.bun/bin:$PATH" bun test test/unit/
else
  # 运行指定的测试
  echo "运行指定测试: $*"
  PATH="$HOME/.bun/bin:$PATH" bun test "$@"
fi
