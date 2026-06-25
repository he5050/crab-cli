/**
 * 统一风险模式管理 — 集中管理高风险和中风险命令模式。
 *
 * 职责:
 *   - 定义高风险命令字符串模式(用于风险等级分类)
 *   - 定义中风险命令字符串模式(用于风险等级分类)
 *   - 提供 classifyRiskLevel 函数，替代 PermissionManager 中内联的 calculateRiskLevel
 *
 * 与 sensitiveCommand.ts 的关系:
 *   - sensitiveCommand.ts 的 DANGEROUS_PATTERNS: 正则模式，匹配到直接阻止(不同用途)
 *   - sensitiveCommand.ts 的 PRESET_SENSITIVE_COMMANDS: 敏感命令列表，需用户确认(不同用途)
 *   - 本模块的 HIGH/MEDIUM_RISK_COMMAND_PATTERNS: 字符串模式，用于风险等级分类
 *
 * 使用场景:
 *   - PermissionManager 评估权限请求的风险等级
 *   - 决定审批流程策略(low → 静默通过, medium → 确认, high → 严格审批)
 *
 * 注意:
 *   - 模式匹配使用 String.includes() 子串匹配(保持与原 calculateRiskLevel 一致)
 *   - fullCmd = `${permission} ${patterns.join(" ")}`.toLowerCase()
 */

/**
 * 高风险命令字符串模式。
 *
 * 匹配方式: `String.includes()` 子串匹配。
 * 注意: 这些模式用于风险等级分类(非阻断)，实际阻断由 dangerDetector.ts 的正则负责。
 * 因此此处允许一定程度的宽泛匹配（宁可高估风险也不低估）。
 *
 * 设计决策:
 *   - 管道到 shell 的模式（"| sh"、"| bash"）是子串匹配，会匹配所有管道到 shell 的命令。
 *     这是有意为之：在 crab-cli 中，将任意命令管道到 sh/bash 都是高风险操作。
 *   - "eval(" / "exec(" / "system(" 是精确子串，匹配代码执行模式。
 */
export const HIGH_RISK_COMMAND_PATTERNS: string[] = [
  // 文件系统破坏
  "rm -rf",
  "rm -r /",
  "rm -rf /",
  "dd if=",
  "mkfs.",
  "fdisk",
  "> /dev",
  "/dev/sda",
  "/dev/hda",
  // 权限提升
  "chmod 777 /",
  "chown -R root",
  "sudo",
  // 管道到 shell（高风险：任意命令管道到 sh/bash）
  "| sh",
  "| bash",
  // 代码执行
  "eval(",
  "exec(",
  "system(",
  "os.system",
  // 敏感路径写入
  "fs.write /etc",
  "fs.write /system",
  "fs.write /usr/bin",
];

/** 中风险命令字符串模式 */
export const MEDIUM_RISK_COMMAND_PATTERNS: string[] = [
  "rm -rf",
  "rm -r",
  "rmdir",
  "del /f",
  "del /q",
  "chmod 777",
  "chmod -R",
  "chown -R",
  "git push",
  "git reset --hard",
  "git clean -fd",
  "npm uninstall",
  "npm rm",
  "yarn remove",
  "docker rm",
  "docker rmi",
  "docker prune",
  "kill -9",
  "pkill",
  "killall",
  "fs.write",
  "fs.delete",
  "fs.move",
];

/**
 * 检查命令是否匹配高风险模式。
 * 使用子串匹配(与原 calculateRiskLevel 语义一致)。
 *
 * 注意: 子串匹配可能产生误匹配（如注释中包含 "sudo"），但这是有意的：
 *   - isHighRiskCommand 用于风险等级分类（非阻断），宁可高估风险
 *   - 实际阻断由 dangerDetector.ts 的正则模式负责
 */
export function isHighRiskCommand(command: string): boolean {
  const lower = command.toLowerCase();
  return HIGH_RISK_COMMAND_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * 检查命令是否匹配中风险模式。
 * 使用子串匹配(与原 calculateRiskLevel 语义一致)。
 */
export function isMediumRiskCommand(command: string): boolean {
  const lower = command.toLowerCase();
  return MEDIUM_RISK_COMMAND_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * 检查命令是否包含高风险结构模式（需要正则匹配，子串无法覆盖）。
 * 补充 HIGH_RISK_COMMAND_PATTERNS 的子串匹配，覆盖管道到 shell 等结构化攻击。
 */
function matchesHighRiskStructure(command: string): boolean {
  return HIGH_RISK_REGEX_PATTERNS.some((regex) => regex.test(command));
}

/**
 * 需要正则匹配的高风险结构模式（子串无法精确匹配的攻击模式）。
 * 与 HIGH_RISK_COMMAND_PATTERNS 互补，用于 classifyRiskLevel 的第二阶段检查。
 */
const HIGH_RISK_REGEX_PATTERNS: RegExp[] = [
  /\|\s*(ba)?sh\b/i, // 管道到 shell（需要结构化匹配）
  /;\s*(rm|mkfs|dd)\b/i, // 分号连接的危险命令
  />\s*\/dev\/sd[a-z]/i, // 写入磁盘设备
  />\s*\/dev\/nvme\d+/i, // 写入 NVMe 设备
];

/**
 * 计算操作风险级别。
 * 替代原 PermissionManager 中内联的 calculateRiskLevel 函数。
 *
 * @param permission - 权限标识(如 "bash", "fs")
 * @param patterns - 相关模式列表
 * @returns 风险级别: "low" | "medium" | "high"
 */
export function classifyRiskLevel(permission: string, patterns: string[]): "low" | "medium" | "high" {
  const pattern = patterns.join(" ");
  const fullCmd = `${permission} ${pattern}`.toLowerCase();

  // 阶段 1: 子串匹配
  for (const risk of HIGH_RISK_COMMAND_PATTERNS) {
    if (fullCmd.includes(risk)) {
      return "high";
    }
  }

  // 阶段 2: 结构化正则匹配（管道到 shell、分号连接危险命令等）
  if (matchesHighRiskStructure(fullCmd)) {
    return "high";
  }

  for (const risk of MEDIUM_RISK_COMMAND_PATTERNS) {
    if (fullCmd.includes(risk)) {
      return "medium";
    }
  }

  return "low";
}
