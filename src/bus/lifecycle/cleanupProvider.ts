/**
 * Cleanup 提供者接口
 *
 * 实现者订阅 AppEvent.CleanupRequested 来执行启动/退出清理。
 *
 * 模块功能:
 *   - CleanupProvider: 清理接口
 *   - cleanup: 执行清理操作
 */
export interface CleanupProvider {
  /** 提供者名称（用于日志和监控） */
  readonly name: string;

  /**
   * 执行清理操作
   * @param phase - "startup" | "exit"
   * @returns 删除的文件数量
   */
  cleanup(phase: "startup" | "exit"): Promise<number>;
}
