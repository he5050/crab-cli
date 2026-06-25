/**
 * Deep Research 存储和元数据管理。
 *
 * 提供报告文件保存、元数据构建和索引更新。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { ResearchReportMetadata, ResearchSourceRecord, ResearchStep } from "./types";

/** 将相对路径解析为绝对保存目录 */
export function resolveSaveDir(saveDir: string): string {
  return isAbsolute(saveDir) ? saveDir : join(process.cwd(), saveDir);
}

/** 从研究步骤中收集并去重来源记录 */
export function collectSourceRecords(steps: ResearchStep[]): ResearchSourceRecord[] {
  const byUrl = new Map<string, ResearchSourceRecord>();
  steps.forEach((step, index) => {
    const round = index + 1;
    const records: ResearchSourceRecord[] = step.sourceRecords?.length
      ? step.sourceRecords
      : step.sources.map((url) => ({ query: step.query, url }));

    for (const record of records) {
      if (!record.url) {
        continue;
      }
      const existing = byUrl.get(record.url);
      byUrl.set(record.url, {
        ...existing,
        ...record,
        query: record.query ?? existing?.query ?? step.query,
        round: record.round ?? existing?.round ?? round,
      });
    }
  });
  return [...byUrl.values()];
}

/** 构建研究报告元数据 */
export function buildResearchMetadata(input: {
  status: ResearchReportMetadata["status"];
  topic: string;
  generatedAt: string;
  reportPath?: string;
  metadataPath: string;
  summary?: string;
  error?: string;
  budget: ResearchReportMetadata["budget"];
  steps: ResearchStep[];
  sources: ResearchSourceRecord[];
}): ResearchReportMetadata {
  return {
    budget: input.budget,
    generatedAt: input.generatedAt,
    metadataPath: input.metadataPath,
    sources: input.sources,
    status: input.status,
    steps: input.steps.map((step) => ({
      findings: step.findings,
      query: step.query,
      sourceRecords: step.sourceRecords ?? [],
      sources: step.sources,
      ...(step.isFollowUp !== undefined ? { isFollowUp: step.isFollowUp } : {}),
    })),
    topic: input.topic,
    version: 1,
    ...(input.reportPath !== undefined ? { reportPath: input.reportPath } : {}),
    ...(input.summary !== undefined ? { summary: input.summary } : {}),
    ...(input.error !== undefined ? { error: input.error } : {}),
  };
}

/** 写入研究报告元数据并更新索引 */
export function writeResearchMetadata(saveDir: string, metadata: ResearchReportMetadata): void {
  writeFileSync(metadata.metadataPath, JSON.stringify(metadata, null, 2), "utf8");
  updateResearchIndex(saveDir, metadata);
}

/** 更新研究报告索引文件 */
export function updateResearchIndex(saveDir: string, metadata: ResearchReportMetadata): void {
  const indexPath = join(saveDir, "index.json");
  let existing: ResearchReportMetadata[] = [];
  if (existsSync(indexPath)) {
    try {
      const parsed = JSON.parse(readFileSync(indexPath, "utf8"));
      if (Array.isArray(parsed)) {
        existing = parsed as ResearchReportMetadata[];
      }
    } catch {
      existing = [];
    }
  }

  const next = [...existing.filter((item) => item.metadataPath !== metadata.metadataPath), metadata].toSorted((a, b) =>
    a.generatedAt.localeCompare(b.generatedAt),
  );
  writeFileSync(indexPath, JSON.stringify(next, null, 2), "utf8");
}
