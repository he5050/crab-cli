/**
 * 文件系统工具模块 — 统一出口
 *
 * 提供文件读写、编辑、批量操作、多文件编辑等工具。
 * 所有文件系统工具均通过此文件统一导出。
 *
 * 子文件:
 *   read.ts     — 文件读取（支持图片/PDF/Office/代码高亮）
 *   write.ts    — 文件写入（自动备份+回滚注册）
 *   edit.ts     — 精确替换编辑（锚点验证+模糊匹配）
 *   batch.ts    — 批量文件操作（read/write/delete/mkdir）
 *   multiEdit.ts — 多文件批量编辑（事务性+失败回滚）
 *   fileLock.ts — 文件锁（异步/同步）
 */

export { fsReadTool } from "./read";
export { fsWriteTool } from "./write";
export { fsEditTool } from "./edit";
export { fsBatchTool } from "./batch";
export { filesystemMultiEditTool } from "./multiEdit";
export { acquireFileLock } from "./fileLock";
