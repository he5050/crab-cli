/**
 * 命令类型定义。
 *
 * 职责:
 *   - 定义命令系统的核心类型接口
 *   - 规范命令的结构和属性
 *   - 定义命令注册表的标准接口
 *
 * 模块功能:
 *   - Command: 命令定义接口，包含名称、标题、分类、执行函数等
 *   - CommandRegistry: 命令注册表接口，提供注册、查询、执行等方法
 *
 * 使用场景:
 *   - 定义新的命令时实现 Command 接口
 *   - 实现自定义命令注册表时参考 CommandRegistry 接口
 *   - 命令系统的类型检查和 IDE 提示支持
 *
 * 边界:
 *   1. 仅包含类型定义，不包含具体实现
 *   2. Command.run 是同步或异步函数，返回 void
 *   3. 命令名称在注册表内必须唯一
 *   4. slashName 不包含前导斜杠
 *
 * 流程:
 *   1. 定义 Command 接口规范命令结构
 *   2. 定义 CommandRegistry 接口规范注册表行为
 *   3. 其他模块基于这些接口实现具体功能
 */

/** 命令定义 */
export interface Command {
  /** 唯一标识，如 "app.quit" */
  name: string;
  /** 显示标题 */
  title: string;
  /** 描述 */
  description?: string;
  /** 分类，如 "框架"、"配置"、"模式"、"工具" */
  category: string;
  /** /xxx 斜杠命令名(不含斜杠) */
  slashName?: string;
  /** 斜杠命令别名 */
  slashAliases?: string[];
  /** 是否隐藏(不在面板中显示) */
  hidden?: boolean;
  /** 是否为推荐命令(面板顶部显示) */
  suggested?: boolean;
  /** 执行命令(可选参数，如斜杠命令的附加文本) */
  run: (args?: string) => void | Promise<void>;
}

/** 命令注册表接口 */
export interface CommandRegistry {
  /** 注册命令 */
  register(command: Command): void;
  /** 批量注册 */
  registerAll(commands: Command[]): void;
  /** 注销命令 */
  unregister(name: string): void;
  /** 按 name 查询 */
  get(name: string): Command | undefined;
  /** 按 slashName 查询(含别名) */
  getBySlash(slash: string): Command | undefined;
  /** 按分类列出 */
  listByCategory(category: string): Command[];
  /** 列出所有命令 */
  listAll(): Command[];
  /** 列出所有斜杠命令 */
  listSlashCommands(): Command[];
  /** 清空所有命令(测试和热重载用) */
  clear(): void;
  /** 执行命令 */
  execute(name: string): Promise<void>;
  /** 执行斜杠命令(附带参数文本) */
  executeSlash(slash: string, args?: string): Promise<boolean>;
  /** 获取命令使用统计 */
  getUsageStats(name: string): { count: number; lastUsed: number } | undefined;
  /** Frecency 排序 */
  sortByFrecency(commands: Command[]): Command[];
}
