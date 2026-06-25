// P3-2: 显式导出公共类型，不暴露内部 LspClientEntry
export * from "./manager";
export * from "./managerFeatures";
export * from "./managerProtocol";
export type { LspServerConfig } from "./managerTypes";
