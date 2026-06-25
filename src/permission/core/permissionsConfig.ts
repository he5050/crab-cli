/**
 * 权限配置辅助 — 默认权限规则集。
 *
 * 职责:
 *   - 提供内置的默认权限规则
 *   - 定义各工具的安全策略
 *   - 支持权限规则查询和过滤
 *
 * 模块功能:
 *   - getDefaultPermissions: 获取默认权限规则
 *   - filterRulesByPermission: 按工具名过滤规则
 *   - DEFAULT_PERMISSIONS: 默认权限规则集
 *
 * 使用场景:
 *   - 权限初始化
 *   - 权限规则查询
 *   - 权限评估
 *
 * 边界:
 *   1. 仅定义规则，不执行评估(评估由 permission/ 模块负责)
 *   2. 策略:读操作 allow，写/执行操作 ask，危险操作 deny
 *   3. 支持通配符匹配
 *
 * 与 permission/security/ 的关系:
 *   - 本文件的 deny 规则基于通配符匹配(如 "sudo *")，用于默认权限策略
 *   - permission/security/riskPatterns.ts 的高风险模式用于风险等级分类(子串匹配)
 *   - permission/security/dangerDetector.ts 的正则模式用于命令阻断检测
 *   - 三者覆盖范围有重叠但用途不同，修改任一处时应同步评估影响
 *
 * 流程:
 *   1. 定义默认权限规则集
 *   2. 提供查询接口
 *   3. 返回规则用于权限评估
 *
 * 注意: 本文件从 config/features/ 移入 permission/core/ 以提高模块内聚性。
 *       原位置保留 re-export 存根以确保向后兼容。
 */
import type { PermissionRule } from "@/schema/permission";

/**
 * 默认权限规则集。
 * 策略:读操作 allow，写/执行操作 ask，危险操作 deny。
 */
export const DEFAULT_PERMISSIONS: PermissionRule[] = [
  // ── 文件操作 ───────────────────────────────────────────
  { action: "allow", metadata: { description: "文件读取默认允许" }, pattern: "**", permission: "fs.read" },
  { action: "ask", metadata: { description: "文件写入需确认" }, pattern: "**", permission: "fs.write" },

  // ── 命令执行 — 危险命令拒绝，只读安全命令自动允许，其余询问 ────────────────
  // 系统信息
  { action: "allow", metadata: { description: "列出文件" }, pattern: "ls *", permission: "bash" },
  { action: "allow", metadata: { description: "当前目录" }, pattern: "pwd", permission: "bash" },
  { action: "allow", metadata: { description: "查找命令路径" }, pattern: "which *", permission: "bash" },
  { action: "allow", metadata: { description: "输出文本" }, pattern: "echo *", permission: "bash" },
  { action: "allow", metadata: { description: "查看文件头部" }, pattern: "head *", permission: "bash" },
  { action: "allow", metadata: { description: "查看文件尾部" }, pattern: "tail *", permission: "bash" },
  { action: "allow", metadata: { description: "统计文件行数" }, pattern: "wc *", permission: "bash" },
  { action: "allow", metadata: { description: "文件类型检测" }, pattern: "file *", permission: "bash" },
  { action: "allow", metadata: { description: "系统信息" }, pattern: "uname *", permission: "bash" },
  { action: "ask", metadata: { description: "查看环境变量需确认，避免泄露密钥" }, pattern: "env", permission: "bash" },
  {
    action: "ask",
    metadata: { description: "查看环境变量需确认，避免泄露密钥" },
    pattern: "printenv *",
    permission: "bash",
  },
  {
    action: "ask",
    metadata: { description: "查看任意文件内容需确认，避免读取敏感文件" },
    pattern: "cat *",
    permission: "bash",
  },
  { action: "allow", metadata: { description: "文本搜索" }, pattern: "grep *", permission: "bash" },
  {
    action: "ask",
    metadata: { description: "查找文件需确认，避免扫描敏感目录" },
    pattern: "find *",
    permission: "bash",
  },
  { action: "allow", metadata: { description: "目录树" }, pattern: "tree *", permission: "bash" },
  { action: "allow", metadata: { description: "文件名提取" }, pattern: "basename *", permission: "bash" },
  { action: "allow", metadata: { description: "目录路径提取" }, pattern: "dirname *", permission: "bash" },
  { action: "allow", metadata: { description: "真实路径解析" }, pattern: "realpath *", permission: "bash" },
  { action: "allow", metadata: { description: "文件状态" }, pattern: "stat *", permission: "bash" },
  // Git 只读操作
  { action: "allow", metadata: { description: "Git 状态" }, pattern: "git status*", permission: "bash" },
  { action: "allow", metadata: { description: "Git diff" }, pattern: "git diff*", permission: "bash" },
  { action: "allow", metadata: { description: "Git 日志" }, pattern: "git log*", permission: "bash" },
  { action: "allow", metadata: { description: "Git 查看" }, pattern: "git show*", permission: "bash" },
  { action: "allow", metadata: { description: "Git 分支列表" }, pattern: "git branch*", permission: "bash" },
  { action: "allow", metadata: { description: "Git 远程信息" }, pattern: "git remote*", permission: "bash" },
  { action: "allow", metadata: { description: "Git stash" }, pattern: "git stash*", permission: "bash" },
  { action: "allow", metadata: { description: "Git 标签" }, pattern: "git tag*", permission: "bash" },
  { action: "allow", metadata: { description: "Git 简短日志" }, pattern: "git shortlog*", permission: "bash" },
  { action: "allow", metadata: { description: "Git 版本解析" }, pattern: "git rev-parse*", permission: "bash" },
  // 构建工具
  {
    action: "ask",
    metadata: { description: "npm run 可能执行项目脚本，需确认" },
    pattern: "npm run *",
    permission: "bash",
  },
  { action: "allow", metadata: { description: "npm test" }, pattern: "npm test*", permission: "bash" },
  { action: "allow", metadata: { description: "npm list" }, pattern: "npm list *", permission: "bash" },
  { action: "allow", metadata: { description: "npm ls" }, pattern: "npm ls *", permission: "bash" },
  { action: "allow", metadata: { description: "npm version" }, pattern: "npm version*", permission: "bash" },
  { action: "allow", metadata: { description: "bun test" }, pattern: "bun test*", permission: "bash" },
  {
    action: "ask",
    metadata: { description: "bun run 可能执行项目脚本，需确认" },
    pattern: "bun run *",
    permission: "bash",
  },
  { action: "allow", metadata: { description: "bun 包管理" }, pattern: "bun pm *", permission: "bash" },
  // 网络(查询允许，写入需确认)
  { action: "ask", metadata: { description: "curl 需确认" }, pattern: "curl *", permission: "bash" },
  { action: "ask", metadata: { description: "ping 需确认" }, pattern: "ping *", permission: "bash" },
  { action: "ask", metadata: { description: "SSH 需确认" }, pattern: "ssh *", permission: "bash" },
  // 危险命令 — 拒绝
  { action: "deny", metadata: { description: "递归删除根目录拒绝" }, pattern: "rm -rf /*", permission: "bash" },
  { action: "deny", metadata: { description: "递归删除根目录拒绝" }, pattern: "rm -rf /", permission: "bash" },
  { action: "deny", metadata: { description: "sudo 命令拒绝" }, pattern: "sudo *", permission: "bash" },
  { action: "deny", metadata: { description: "chmod 777 拒绝" }, pattern: "chmod 777*", permission: "bash" },
  { action: "deny", metadata: { description: "chown root 拒绝" }, pattern: "chown root*", permission: "bash" },
  { action: "deny", metadata: { description: "格式化文件系统拒绝" }, pattern: "mkfs *", permission: "bash" },
  { action: "deny", metadata: { description: "磁盘分区拒绝" }, pattern: "fdisk *", permission: "bash" },
  { action: "deny", metadata: { description: "dd 直接磁盘操作拒绝" }, pattern: "dd *", permission: "bash" },
  { action: "deny", metadata: { description: "fork bomb 拒绝" }, pattern: ":(){ :|:&};:", permission: "bash" },
  { action: "deny", metadata: { description: "强制推送拒绝" }, pattern: "git push*--force", permission: "bash" },
  { action: "deny", metadata: { description: "强制重置拒绝" }, pattern: "git reset*--hard", permission: "bash" },
  { action: "deny", metadata: { description: "强制清理拒绝" }, pattern: "git clean* -f", permission: "bash" },
  { action: "deny", metadata: { description: "npm publish 拒绝" }, pattern: "npm publish*", permission: "bash" },
  { action: "deny", metadata: { description: "DROP TABLE 拒绝" }, pattern: "DROP TABLE*", permission: "bash" },
  { action: "deny", metadata: { description: "DROP DATABASE 拒绝" }, pattern: "DROP DATABASE*", permission: "bash" },
  { action: "deny", metadata: { description: "TRUNCATE TABLE 拒绝" }, pattern: "TRUNCATE TABLE*", permission: "bash" },
  { action: "deny", metadata: { description: "DELETE FROM 拒绝" }, pattern: "DELETE FROM*", permission: "bash" },
  { action: "deny", metadata: { description: "格式化拒绝" }, pattern: "format *", permission: "bash" },
  { action: "deny", metadata: { description: "shred 拒绝" }, pattern: "shred *", permission: "bash" },
  { action: "deny", metadata: { description: "kill -9 默认拒绝" }, pattern: "kill -9 *", permission: "bash" },
  { action: "ask", metadata: { description: "命令执行默认需确认" }, pattern: "*", permission: "bash" },

  // ── 网络搜索 ──────────────────────────────────────────
  { action: "allow", metadata: { description: "网络搜索默认允许" }, pattern: "*", permission: "websearch" },

  // ── MCP 工具 ────────────────────────────────────────────
  // High-risk MCP tools (exec, shell, delete, etc.) are denied by default;
  // Users must explicitly enable them in their config to use these tools.
  {
    action: "deny",
    metadata: { description: "高风险 MCP 工具默认拒绝，需在配置中显式启用" },
    pattern: "*",
    permission: "mcp.sensitive.*",
  },
  { action: "ask", metadata: { description: "MCP 工具需确认" }, pattern: "*", permission: "mcp.*" },
];

/**
 * 获取默认权限规则。
 */
export function getDefaultPermissions(): PermissionRule[] {
  return [...DEFAULT_PERMISSIONS];
}

/**
 * 获取不可被用户 allow 覆盖的内置拒绝规则。
 */
export function getHardDenyPermissions(): PermissionRule[] {
  return DEFAULT_PERMISSIONS.filter((rule) => rule.action === "deny");
}

/**
 * 获取非 hard-deny 的默认权限规则。
 */
export function getDefaultPermissionsWithoutHardDeny(): PermissionRule[] {
  return DEFAULT_PERMISSIONS.filter((rule) => rule.action !== "deny");
}

/**
 * 按工具名过滤规则。
 *
 * @param rules - 权限规则集
 * @param permission - 工具权限名(如 "bash"、"fs.write")
 * @returns 匹配的规则
 */
export function filterRulesByPermission(rules: PermissionRule[], permission: string): PermissionRule[] {
  return rules.filter((r) => r.permission === permission);
}
