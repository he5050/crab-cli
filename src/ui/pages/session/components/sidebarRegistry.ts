/**
 * 侧边栏区块注册表 — 解耦面板注册机制
 *
 * 职责:
 *   - 提供区块注册/注销 API
 *   - 按 order 排序返回所有区块
 *   - 支持插件动态添加自定义区块
 *
 * 使用方式:
 *   onMount(() => {
 *     registerSidebarSection("mySection", (props) => <MySection {...props} />, 25);
 *     onCleanup(() => unregisterSidebarSection("mySection"));
 *   });
 */
import type { JSX } from "solid-js";

/** 传递给每个区块的共享 props */
export interface SidebarSectionProps {
  colors: {
    text: string;
    muted: string;
    accent: string;
    border: string;
    success: string;
    warning: string;
    error: string;
  };
  agentInfo?: any;
  agentStatus?: string;
  mode?: string;
  yoloOverlay?: boolean;
  contextStats?: any;
  lspDiagnostics?: any[];
  todos?: any[];
  tasks?: any[];
  files?: any[];
  diffColors?: any;
  messages?: any[];
  onOpen?: () => void;
}

/** 区块定义 */
export interface SidebarSection {
  id: string;
  order: number;
  render: (props: SidebarSectionProps) => JSX.Element;
}

const sections = new Map<string, SidebarSection>();

/**
 * 注册侧边栏区块
 * @param id 区块唯一标识
 * @param render 渲染函数
 * @param order 排序权重(越小越靠前)
 */
export function registerSidebarSection(id: string, render: SidebarSection["render"], order: number): void {
  sections.set(id, { id, order, render });
}

/**
 * 注销侧边栏区块
 */
export function unregisterSidebarSection(id: string): void {
  sections.delete(id);
}

/**
 * 按 order 排序返回所有区块
 */
export function getSidebarSections(): SidebarSection[] {
  return [...sections.values()].toSorted((a, b) => a.order - b.order);
}

/**
 * 清空所有区块(用于测试或卸载)
 */
export function clearSidebarSections(): void {
  sections.clear();
}

/**
 * 获取区块数量(用于调试)
 */
export function getSidebarSectionCount(): number {
  return sections.size;
}
