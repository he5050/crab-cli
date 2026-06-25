/**
 * 更新通知模块
 *
 * 职责:
 *   - 管理版本更新通知的事件系统
 *   - 提供版本比较和更新检测
 *   - 支持订阅更新通知变化
 *
 * 模块功能:
 *   - 设置更新通知(仅当最新版本 > 当前版本时生效)
 *   - 获取当前更新通知状态
 *   - 监听更新通知变化(EventEmitter 模式)
 *   - 版本号比较(语义化版本)
 *
 * 使用场景:
 *   - 应用启动时检查更新
 *   - 后台轮询检测新版本
 *   - UI 显示更新提示横幅
 *   - 设置页面显示版本信息
 *
 * 边界:
 *   1. 仅比较版本号，不处理实际的更新下载/安装
 *   2. 版本号格式必须是 x.y.z 的语义化版本
 *   3. 不持久化更新通知状态
 *   4. 同一时间只保留一个更新通知
 *
 * 流程:
 *   1. 调用 setUpdateNotice 传入当前版本和最新版本
 *   2. 内部比较版本号，判断是否需要更新
 *   3. 如有更新，触发 UPDATE_NOTICE_EVENT 事件
 *   4. 订阅者通过 onUpdateNotice 接收通知
 *   5. 调用 getUpdateNotice 获取当前通知状态
 */

import { EventEmitter } from "node:events";

export interface UpdateNotice {
  currentVersion: string;
  latestVersion: string;
  checkedAt: number;
}

const UPDATE_NOTICE_EVENT = "update-notice";

const updateNoticeEmitter = new EventEmitter();
updateNoticeEmitter.setMaxListeners(20);

let currentNotice: UpdateNotice | null = null;

function compareVersion(a: string, b: string): number {
  const aParts = a.split(".").map((part) => Number.parseInt(part, 10));
  const bParts = b.split(".").map((part) => Number.parseInt(part, 10));
  const maxLength = Math.max(aParts.length, bParts.length);

  for (let index = 0; index < maxLength; index++) {
    const aPart = aParts[index] ?? 0;
    const bPart = bParts[index] ?? 0;
    if (aPart !== bPart) {
      return aPart - bPart;
    }
  }

  return 0;
}

/**
 * 设置更新通知(仅当最新版本 > 当前版本时生效)。
 */
export function setUpdateNotice(notice: Omit<UpdateNotice, "checkedAt"> | null): void {
  currentNotice =
    notice && compareVersion(notice.latestVersion, notice.currentVersion) > 0
      ? { ...notice, checkedAt: Date.now() }
      : null;
  updateNoticeEmitter.emit(UPDATE_NOTICE_EVENT, currentNotice);
}

/**
 * 获取当前更新通知。
 */
export function getUpdateNotice(): UpdateNotice | null {
  return currentNotice;
}

/**
 * 监听更新通知变化。
 */
export function onUpdateNotice(handler: (notice: UpdateNotice | null) => void): () => void {
  updateNoticeEmitter.on(UPDATE_NOTICE_EVENT, handler);
  return () => {
    updateNoticeEmitter.off(UPDATE_NOTICE_EVENT, handler);
  };
}
