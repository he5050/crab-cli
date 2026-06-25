/**
 * 通配符匹配引擎 — 支持 glob 模式字符串匹配
 *
 * 职责:
 *   - 实现 glob 模式到字符串的匹配判断
 *   - 支持多种通配符模式(*、**、?、[abc]、[a-z])
 *   - 提供纯函数接口，无副作用
 *
 * 模块功能:
 *   - wildcardMatch: 判断字符串是否匹配 glob 模式
 *
 * 使用场景:
 *   - 权限规则的路径模式匹配
 *   - 命令参数的通配符过滤
 *   - 文件路径的模式匹配
 *
 * 边界:
 * 1. 纯函数实现，无状态和副作用
 * 2. 模式为空时仅匹配空字符串
 * 3. ** 匹配含路径分隔符的任意字符序列
 * 4. [a-z] 范围匹配支持字符区间
 *
 * 流程:
 * 1. 精确匹配快速路径:pattern === input 直接返回
 * 2. 全匹配快速路径:pattern === "*" 或 "**" 直接返回 true
 * 3. 递归匹配核心逻辑处理通配符展开
 *
 * 支持的模式:
 *   - *     — 匹配任意字符序列（含路径分隔符，与标准 glob 不同）
 *              NO-GLOB: 有意的设计偏差。标准 glob 中 * 不跨路径分隔符 (/),
 *              但 CLI 命令匹配场景需要 * 跨分隔符（如 "git *" 匹配 "git status"）。
 *              此行为对命令类规则是正确的，但对路径类规则可能过度匹配。
 *              如需严格 glob 语义，请使用 ** 代替。
 *   - **    — 匹配任意字符序列(含路径分隔符)
 *   - ?     — 匹配单个字符
 *   - [abc] — 匹配字符集中的单个字符
 *   - [a-z] — 匹配指定范围内的单个字符
 */

/**
 * 判断字符串是否匹配 glob 模式。
 *
 * @param pattern - glob 模式，如 "*.ts"、"src/**"、"exact-cmd"
 * @param input - 待匹配的字符串
 * @returns 是否匹配
 *
 * @example
 * wildcardMatch("*.ts", "src/foo.ts")    // true
 * wildcardMatch("src/**", "src/a/b.ts")  // true
 * wildcardMatch("git *", "git status")   // true
 * wildcardMatch("exact", "exact")        // true
 */
export function wildcardMatch(pattern: string, input: string): boolean {
  // 精确匹配快速路径
  if (pattern === input) {
    return true;
  }

  // 全匹配快速路径
  if (pattern === "*" || pattern === "**") {
    return true;
  }

  // 空模式只匹配空串
  if (pattern.length === 0) {
    return input.length === 0;
  }

  return _match(pattern, 0, input, 0, DEFAULT_MAX_DEPTH);
}

/** 默认最大递归深度，防止恶意构造的通配符模式导致栈溢出 */
const DEFAULT_MAX_DEPTH = 50;

/**
 * 递归匹配核心。
 *
 * @param maxDepth - 最大递归深度限制，每次递归调用递减。
 *   当 depth 降至 0 时返回 false，防止恶意构造的输入（如 "a*a*a*..."
 *   匹配 "aaa..."）导致栈溢出。
 */
function _match(pattern: string, pi: number, input: string, ii: number, maxDepth: number): boolean {
  if (maxDepth <= 0) {
    return false;
  }

  while (pi < pattern.length && ii < input.length) {
    const pc = pattern[pi]!;

    if (pc === "*") {
      // 双星号 ** — 匹配任意(含分隔符)
      if (pi + 1 < pattern.length && pattern[pi + 1] === "*") {
        // 跳过连续的 */
        pi += 2;
        // 跳过紧跟的 /
        while (pi < pattern.length && pattern[pi] === "/") {
          pi++;
        }

        // ** 匹配 0 到 N 段
        for (let i = ii; i <= input.length; i++) {
          if (_match(pattern, pi, input, i, maxDepth - 1)) {
            return true;
          }
        }
        return false;
      }

      // 单星号 * — 匹配任意字符（含分隔符），与标准 glob 语义不同（见模块 JSDoc）
      pi++;

      // * 匹配 0 到 N 个字符(非贪婪:尝试跳过尽可能少的字符)
      // 但遇到空格分隔的命令模式，需要特殊处理
      for (let i = ii; i <= input.length; i++) {
        if (_match(pattern, pi, input, i, maxDepth - 1)) {
          return true;
        }
      }
      return false;
    }

    if (pc === "?") {
      // ? 匹配单个字符
      pi++;
      ii++;
      continue;
    }

    if (pc === "[") {
      // 字符集 [abc] 或 [a-z]
      const closeIdx = pattern.indexOf("]", pi);
      if (closeIdx === -1) {
        // 没有闭合，当字面量处理
        if (pc !== input[ii]) {
          return false;
        }
        pi++;
        ii++;
        continue;
      }

      const charSet = pattern.slice(pi + 1, closeIdx);
      const current = input[ii]!;
      let matched = false;

      // 支持范围 [a-z]
      for (let i = 0; i < charSet.length; i++) {
        if (charSet[i] === "-" && i > 0 && i < charSet.length - 1) {
          const start = charSet[i - 1]!;
          const end = charSet[i + 1]!;
          if (current >= start && current <= end) {
            matched = true;
            break;
          }
        } else if (charSet[i] === current) {
          matched = true;
          break;
        }
      }

      if (!matched) {
        return false;
      }
      pi = closeIdx + 1;
      ii++;
      continue;
    }

    // 字面量匹配
    if (pc !== input[ii]) {
      return false;
    }
    pi++;
    ii++;
  }

  // 模式剩余部分:只允许 *
  while (pi < pattern.length && pattern[pi] === "*") {
    pi++;
  }

  return pi === pattern.length && ii === input.length;
}
