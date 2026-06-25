/**
 * RoleSubagent 单元测试。
 *
 * 覆盖范围:
 *   - loadSubAgentCustomRole 项目级优先 → 全局级回退 → null
 *   - loadSubAgentCustomRole 空内容视为无角色
 *   - loadSubAgentCustomRole 读取异常继续查找
 *   - listAvailableSubAgentRoles 合并项目级和全局级
 *   - listAvailableSubAgentRoles 排序去重
 *   - 边界:目录不存在、无匹配文件
 */
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const MOCK_GLOBAL_DIR = "/tmp/crab-test-global-sa";
const MOCK_PROJECT_DIR = "/tmp/crab-test-project-sa";
const BASE_CWD = process.cwd();

const pathsMock = () => ({
  getGlobalCrabDir: () => MOCK_GLOBAL_DIR,
});

function mockExists(value: boolean | ((filePath: string) => boolean)) {
  if (typeof value === "boolean") {
    return spyOn(fs, "existsSync").mockReturnValue(value);
  }
  return spyOn(fs, "existsSync").mockImplementation(((filePath: fs.PathLike) => value(String(filePath))) as any);
}

function mockReadFile(value: string | ((filePath: string) => string)) {
  if (typeof value === "string") {
    return spyOn(fs, "readFileSync").mockReturnValue(value);
  }
  return spyOn(fs, "readFileSync").mockImplementation(((filePath: fs.PathOrFileDescriptor) =>
    value(String(filePath))) as any);
}

function mockReaddir(entries: string[]) {
  return spyOn(fs, "readdirSync").mockReturnValue(entries as any);
}

function mockReaddirImpl(value: (dir: string) => string[]) {
  return spyOn(fs, "readdirSync").mockImplementation(((dir: fs.PathLike) => value(String(dir))) as any);
}

function setupMocks() {
  // @config/paths — alias + resolved paths
  mock.module("@config/paths", pathsMock);
  mock.module(path.resolve(BASE_CWD, "src/config/paths"), pathsMock);
  mock.module(path.resolve(BASE_CWD, "src/config/paths.ts"), pathsMock);
}

describe("roleSubagent", () => {
  beforeEach(setupMocks);
  afterEach(() => mock.restore());

  // ─── loadSubAgentCustomRole ───────────────────────────

  describe("loadSubAgentCustomRole", () => {
    test("项目级角色优先于全局", async () => {
      mockExists(true);
      mockReadFile((p: string) =>
        p.includes(MOCK_PROJECT_DIR) ? "# Project Role for explore" : "# Global Role for explore",
      );

      const { loadSubAgentCustomRole } = await import("@/agent/roles/roleSubagent");
      expect(loadSubAgentCustomRole("explore", MOCK_PROJECT_DIR)).toBe("# Project Role for explore");
    });

    test("无项目级角色回退到全局", async () => {
      mockExists((p) => p.includes(MOCK_GLOBAL_DIR));
      mockReadFile("# Global Role");

      const { loadSubAgentCustomRole } = await import("@/agent/roles/roleSubagent");
      expect(loadSubAgentCustomRole("general", MOCK_PROJECT_DIR)).toBe("# Global Role");
    });

    test("两层都不存在返回 null", async () => {
      mockExists(false);

      const { loadSubAgentCustomRole } = await import("@/agent/roles/roleSubagent");
      expect(loadSubAgentCustomRole("explore", MOCK_PROJECT_DIR)).toBeNull();
    });

    test("空内容文件视为无角色", async () => {
      mockExists(true);
      mockReadFile("   \n\n  ");

      const { loadSubAgentCustomRole } = await import("@/agent/roles/roleSubagent");
      expect(loadSubAgentCustomRole("explore", MOCK_PROJECT_DIR)).toBeNull();
    });

    test("仅空白字符的全局文件也视为无角色", async () => {
      mockExists(true);
      mockReadFile((p: string) => (p.includes(MOCK_PROJECT_DIR) ? "\t" : ""));

      const { loadSubAgentCustomRole } = await import("@/agent/roles/roleSubagent");
      expect(loadSubAgentCustomRole("explore", MOCK_PROJECT_DIR)).toBeNull();
    });

    test("项目级读取异常回退到全局", async () => {
      mockExists(true);
      mockReadFile((p: string) => {
        if (p.includes(MOCK_PROJECT_DIR)) {
          throw new Error("permission denied");
        }
        return "# Global Fallback";
      });

      const { loadSubAgentCustomRole } = await import("@/agent/roles/roleSubagent");
      expect(loadSubAgentCustomRole("explore", MOCK_PROJECT_DIR)).toBe("# Global Fallback");
    });

    test("全局读取异常返回 null", async () => {
      mockExists(true);
      spyOn(fs, "readFileSync").mockImplementation(() => {
        throw new Error("disk error");
      });

      const { loadSubAgentCustomRole } = await import("@/agent/roles/roleSubagent");
      expect(loadSubAgentCustomRole("explore", MOCK_PROJECT_DIR)).toBeNull();
    });

    test("默认 projectRoot 使用 process.cwd() 不报错", async () => {
      mockExists(false);

      const { loadSubAgentCustomRole } = await import("@/agent/roles/roleSubagent");
      expect(loadSubAgentCustomRole("explore")).toBeNull();
    });

    test("文件名格式正确(ROLE-<agentName>.md)", async () => {
      const readPaths: string[] = [];
      mockExists(true);
      mockReadFile((p: string) => {
        readPaths.push(p);
        return "role content";
      });

      const { loadSubAgentCustomRole } = await import("@/agent/roles/roleSubagent");
      loadSubAgentCustomRole("my-agent", MOCK_PROJECT_DIR);

      expect(readPaths[0]).toBe(path.join(MOCK_PROJECT_DIR, ".crab", "ROLE-my-agent.md"));
      expect(readPaths).toHaveLength(1);
    });
  });

  // ─── listAvailableSubAgentRoles ──────────────────────

  describe("listAvailableSubAgentRoles", () => {
    test("合并项目级和全局级角色名", async () => {
      mockExists(true);
      mockReaddirImpl((dir: string) => {
        if (dir === MOCK_GLOBAL_DIR) {
          return ["ROLE-explore.md", "ROLE-xxx.md"];
        }
        return ["ROLE-explore.md", "ROLE-general.md"];
      });

      const { listAvailableSubAgentRoles } = await import("@/agent/roles/roleSubagent");
      expect(listAvailableSubAgentRoles(MOCK_PROJECT_DIR)).toEqual(["explore", "general", "xxx"]);
    });

    test("去重:同名的项目级和全局级只出现一次", async () => {
      mockExists(true);
      mockReaddir(["ROLE-explore.md"]);

      const { listAvailableSubAgentRoles } = await import("@/agent/roles/roleSubagent");
      expect(listAvailableSubAgentRoles(MOCK_PROJECT_DIR)).toEqual(["explore"]);
    });

    test("排序保持稳定", async () => {
      mockExists(true);
      mockReaddir(["ROLE-zzz.md", "ROLE-aaa.md", "ROLE-mid.md"]);

      const { listAvailableSubAgentRoles } = await import("@/agent/roles/roleSubagent");
      expect(listAvailableSubAgentRoles(MOCK_PROJECT_DIR)).toEqual(["aaa", "mid", "zzz"]);
    });

    test("忽略 ROLE.md(不是子代理角色文件)", async () => {
      mockExists(true);
      mockReaddir(["ROLE-explore.md", "ROLE.md", "README.md", "ROLE-abc.md"]);

      const { listAvailableSubAgentRoles } = await import("@/agent/roles/roleSubagent");
      expect(listAvailableSubAgentRoles(MOCK_PROJECT_DIR)).toEqual(["abc", "explore"]);
    });

    test("目录不存在返回空列表", async () => {
      mockExists(false);

      const { listAvailableSubAgentRoles } = await import("@/agent/roles/roleSubagent");
      expect(listAvailableSubAgentRoles(MOCK_PROJECT_DIR)).toEqual([]);
    });

    test("readdirSync 异常静默处理", async () => {
      mockExists(true);
      spyOn(fs, "readdirSync").mockImplementation(() => {
        throw new Error("IO error");
      });

      const { listAvailableSubAgentRoles } = await import("@/agent/roles/roleSubagent");
      expect(listAvailableSubAgentRoles(MOCK_PROJECT_DIR)).toEqual([]);
    });

    test("支持含连字符和下划线的 agentName", async () => {
      mockExists(true);
      mockReaddir(["ROLE-my-agent_v2.md", "ROLE-web-search.md"]);

      const { listAvailableSubAgentRoles } = await import("@/agent/roles/roleSubagent");
      const roles = listAvailableSubAgentRoles(MOCK_PROJECT_DIR);
      expect(roles).toContain("my-agent_v2");
      expect(roles).toContain("web-search");
    });
  });
});
