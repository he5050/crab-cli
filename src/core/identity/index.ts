/**
 * 品牌化 ID 生成器。
 *
 * 职责:
 *   - 生成前缀 ID(ses_/msg_/prt_/evt_ 等)，支持时间排序
 *   - 提供 ID 解析功能(提取前缀、时间戳)
 *   - 验证 ID 前缀
 *
 * 模块功能:
 *   - createId:创建品牌化 ID
 *   - extractPrefix:从 ID 中提取前缀
 *   - extractTimestamp:从 ID 中提取时间戳
 *   - isIdPrefix:验证 ID 是否符合指定前缀
 *
 * 使用场景:
 *   - 会话 ID 生成
 *   - 消息 ID 生成
 *   - 事件 ID 生成
 *   - 需要排序的唯一标识
 *
 * 边界:
 *   1. 仅负责 ID 生成和解析，不涉及存储
 *   2. 使用 ULID 确保时间排序
 *   3. 单调递增生成器确保同一毫秒内 ID 严格递增
 *
 * 流程:
 *   1. 选择合适的前缀类型
 *   2. 调用 createId 生成 ID
 *   3. 使用 extractPrefix/extractTimestamp 解析 ID
 */
import { monotonicFactory } from "ulid";

/** 单调递增 ULID 生成器，确保同一毫秒内生成的 ID 严格递增 */
const monotonicUlid = monotonicFactory();

/** ID 前缀类型 */
export type IdPrefix =
  | "ses" // 会话
  | "msg" // 消息
  | "prt" // 消息部分
  | "evt" // 事件
  | "req" // LLM 请求
  | "trn" // 对话轮次
  | "per" // 权限请求
  | "que" // 问题
  | "tool" // 工具调用
  | "job" // 后台任务
  | "wrk" // 工作区
  | "chk" // 检查点
  | "appr" // 审批记录
  | "call" // 工具调用 ID
  | "sat" // 子代理任务
  | "mate" // 队友
  | "task" // 异步任务
  | "test" // 测试用
  | "con" // 连接(IDE WebSocket 客户端)
  | "col" // 协作客户端
  | "rec"; // 录制

/**
 * 创建品牌化 ID。
 * 格式:{prefix}_{ULID}，如 ses_01HZ3K5P0QXJM9EG8ABCD4FGHI
 *
 * @param prefix - ID 前缀
 * @returns 带前缀的唯一 ID
 *
 * @example
 * createId("ses") // "ses_01HZ3K5P0QXJM9EG8ABCD4FGHI"
 */
export function createId(prefix: IdPrefix): string {
  return `${prefix}_${monotonicUlid()}`;
}

/**
 * 从 ID 中提取前缀。
 *
 * @param id - 品牌化 ID
 * @returns 前缀部分
 */
export function extractPrefix(id: string): string {
  const idx = id.indexOf("_");
  if (idx === -1) {
    return "";
  }
  return id.slice(0, idx);
}

/**
 * 从 ID 中提取时间戳(基于 ULID 编码)。
 *
 * @param id - 品牌化 ID
 * @returns Unix 时间戳(毫秒)，如果不是有效 ULID 则返回 0
 */
export function extractTimestamp(id: string): number {
  const idx = id.indexOf("_");
  if (idx === -1) {
    return 0;
  }
  const ulidPart = id.slice(idx + 1);
  if (ulidPart.length < 10) {
    return 0;
  }
  try {
    // ULID 前 10 个字符编码时间戳
    return decodeUlidTime(ulidPart.slice(0, 10));
  } catch (error) {
    console.debug(`[ID] 解码时间戳失败: ${error instanceof Error ? error.message : String(error)}`);
    return 0;
  }
}

/** ULID 编码字符集 */
const ULID_CHARS = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 解码 ULID 时间部分 */
function decodeUlidTime(timePart: string): number {
  let result = 0;
  for (let i = 0; i < timePart.length; i++) {
    const charIndex = ULID_CHARS.indexOf(timePart[i]!.toUpperCase());
    if (charIndex === -1) {
      return 0;
    }
    result = result * 32 + charIndex;
  }
  return result;
}

/**
 * 验证 ID 是否符合指定前缀。
 *
 * @param id - 待验证 ID
 * @param prefix - 期望前缀
 * @returns 是否匹配
 */
export function isIdPrefix(id: string, prefix: IdPrefix): boolean {
  return id.startsWith(`${prefix}_`);
}
