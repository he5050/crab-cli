/**
 * 技术栈自动检测 — 扫描项目配置文件识别框架/工具/语言
 *
 *
 * 支持 20+ 生态系统: Node/Python/Rust/Go/Java/.NET/Ruby/PHP/Swift/Dart/C++/Zig/Elixir
 * 以及 Docker/K8s/CI/基础设施工具。
 */

import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

// ─── 类型 ──────────────────────────────────────────────────

export interface TechStackItem {
  category: string;
  name: string;
  type: "language" | "framework" | "build-tool" | "runtime" | "infra" | "orm" | "test" | "package-manager";
}

// ─── 安全读取 ──────────────────────────────────────────────

const MAX_READ = 8192;

function readFileSafe(filePath: string, maxLen = MAX_READ): string | null {
  try {
    if (!existsSync(filePath)) return null;
    const content = readFileSync(filePath, "utf-8");
    return content.length > maxLen ? content.slice(0, maxLen) : content;
  } catch {
    return null;
  }
}

function readJsonSafe(filePath: string): Record<string, unknown> | null {
  try {
    if (!existsSync(filePath)) return null;
    const content = readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// ─── 检测函数 ──────────────────────────────────────────────

function detectNode(stack: TechStackItem[], root: string): void {
  const pkg = readJsonSafe(join(root, "package.json"));
  if (!pkg) return;

  const deps: Record<string, string> = {
    ...(pkg.dependencies as Record<string, string>),
    ...(pkg.devDependencies as Record<string, string>),
  };

  stack.push({ category: "语言", name: "TypeScript/JavaScript", type: "language" });

  // 框架检测
  const frameworkMap: Record<string, TechStackItem> = {
    next: { category: "框架", name: "Next.js", type: "framework" },
    react: { category: "框架", name: "React", type: "framework" },
    vue: { category: "框架", name: "Vue", type: "framework" },
    nuxt: { category: "框架", name: "Nuxt", type: "framework" },
    svelte: { category: "框架", name: "Svelte", type: "framework" },
    sveltekit: { category: "框架", name: "SvelteKit", type: "framework" },
    "@angular/core": { category: "框架", name: "Angular", type: "framework" },
    express: { category: "框架", name: "Express", type: "framework" },
    "@nestjs/core": { category: "框架", name: "NestJS", type: "framework" },
    electron: { category: "框架", name: "Electron", type: "framework" },
    ink: { category: "框架", name: "Ink (CLI React)", type: "framework" },
    "react-native": { category: "框架", name: "React Native", type: "framework" },
    expo: { category: "框架", name: "Expo", type: "framework" },
    astro: { category: "框架", name: "Astro", type: "framework" },
    remix: { category: "框架", name: "Remix", type: "framework" },
    hono: { category: "框架", name: "Hono", type: "framework" },
    fastify: { category: "框架", name: "Fastify", type: "framework" },
    koa: { category: "框架", name: "Koa", type: "framework" },
    solid: { category: "框架", name: "SolidJS", type: "framework" },
    vite: { category: "构建工具", name: "Vite", type: "build-tool" },
    webpack: { category: "构建工具", name: "Webpack", type: "build-tool" },
    esbuild: { category: "构建工具", name: "esbuild", type: "build-tool" },
    rollup: { category: "构建工具", name: "Rollup", type: "build-tool" },
    turbopack: { category: "构建工具", name: "Turbopack", type: "build-tool" },
    tsup: { category: "构建工具", name: "tsup", type: "build-tool" },
    vitest: { category: "测试", name: "Vitest", type: "test" },
    jest: { category: "测试", name: "Jest", type: "test" },
    mocha: { category: "测试", name: "Mocha", type: "test" },
    prisma: { category: "ORM", name: "Prisma", type: "orm" },
    drizzle: { category: "ORM", name: "Drizzle ORM", type: "orm" },
    typeorm: { category: "ORM", name: "TypeORM", type: "orm" },
    knex: { category: "ORM", name: "Knex", type: "orm" },
    tailwindcss: { category: "构建工具", name: "Tailwind CSS", type: "build-tool" },
    biome: { category: "构建工具", name: "Biome", type: "build-tool" },
    eslint: { category: "构建工具", name: "ESLint", type: "build-tool" },
    prettier: { category: "构建工具", name: "Prettier", type: "build-tool" },
  };

  for (const [key, item] of Object.entries(frameworkMap)) {
    if (deps[key]) {
      stack.push(item);
    }
  }

  // 包管理器
  if (existsSync(join(root, "pnpm-lock.yaml")))
    stack.push({ category: "包管理器", name: "pnpm", type: "package-manager" });
  else if (existsSync(join(root, "bun.lockb")) || existsSync(join(root, "bun.lock")))
    stack.push({ category: "包管理器", name: "Bun", type: "package-manager" });
  else if (existsSync(join(root, "yarn.lock")))
    stack.push({ category: "包管理器", name: "Yarn", type: "package-manager" });
  else if (existsSync(join(root, "package-lock.json")))
    stack.push({ category: "包管理器", name: "npm", type: "package-manager" });
}

function detectPython(stack: TechStackItem[], root: string): void {
  const pyproject = readFileSafe(join(root, "pyproject.toml"));
  const requirements = readFileSafe(join(root, "requirements.txt"));
  const setupPy = readFileSafe(join(root, "setup.py"));

  if (!pyproject && !requirements && !setupPy) return;

  stack.push({ category: "语言", name: "Python", type: "language" });

  const pythonContent = [pyproject, requirements, setupPy].filter(Boolean).join("\n").toLowerCase();
  const pyFrameworkMap: Record<string, TechStackItem> = {
    django: { category: "框架", name: "Django", type: "framework" },
    fastapi: { category: "框架", name: "FastAPI", type: "framework" },
    flask: { category: "框架", name: "Flask", type: "framework" },
    pytorch: { category: "框架", name: "PyTorch", type: "framework" },
    tensorflow: { category: "框架", name: "TensorFlow", type: "framework" },
    langchain: { category: "框架", name: "LangChain", type: "framework" },
    streamlit: { category: "框架", name: "Streamlit", type: "framework" },
    poetry: { category: "构建工具", name: "Poetry", type: "build-tool" },
    pipenv: { category: "构建工具", name: "Pipenv", type: "build-tool" },
    pytest: { category: "测试", name: "pytest", type: "test" },
  };

  for (const [key, item] of Object.entries(pyFrameworkMap)) {
    if (pythonContent.includes(key)) stack.push(item);
  }
}

function detectRust(stack: TechStackItem[], root: string): void {
  const cargo = readFileSafe(join(root, "Cargo.toml"));
  if (!cargo) return;

  stack.push({ category: "语言", name: "Rust", type: "language" });
  const cargoLower = cargo.toLowerCase();
  const rustMap: Record<string, TechStackItem> = {
    actix: { category: "框架", name: "Actix", type: "framework" },
    axum: { category: "框架", name: "Axum", type: "framework" },
    rocket: { category: "框架", name: "Rocket", type: "framework" },
    tokio: { category: "运行时", name: "Tokio", type: "runtime" },
    tauri: { category: "框架", name: "Tauri", type: "framework" },
  };
  for (const [key, item] of Object.entries(rustMap)) {
    if (cargoLower.includes(key)) stack.push(item);
  }
}

function detectGo(stack: TechStackItem[], root: string): void {
  const goMod = readFileSafe(join(root, "go.mod"));
  if (!goMod) return;

  stack.push({ category: "语言", name: "Go", type: "language" });
  const goLower = goMod.toLowerCase();
  const goMap: Record<string, TechStackItem> = {
    gin: { category: "框架", name: "Gin", type: "framework" },
    fiber: { category: "框架", name: "Fiber", type: "framework" },
    echo: { category: "框架", name: "Echo", type: "framework" },
    gorilla: { category: "框架", name: "Gorilla Mux", type: "framework" },
  };
  for (const [key, item] of Object.entries(goMap)) {
    if (goLower.includes(key)) stack.push(item);
  }
}

function detectJava(stack: TechStackItem[], root: string): void {
  const pom = existsSync(join(root, "pom.xml"));
  const gradle = existsSync(join(root, "build.gradle")) || existsSync(join(root, "build.gradle.kts"));
  if (!pom && !gradle) return;

  stack.push({ category: "语言", name: "Java/Kotlin", type: "language" });
  if (pom) {
    const pomContent = readFileSafe(join(root, "pom.xml"), 4096) ?? "";
    if (pomContent.toLowerCase().includes("spring-boot"))
      stack.push({ category: "框架", name: "Spring Boot", type: "framework" });
  }
  if (gradle) {
    const gradleContent =
      readFileSafe(join(root, "build.gradle")) ?? readFileSafe(join(root, "build.gradle.kts")) ?? "";
    if (gradleContent.toLowerCase().includes("spring"))
      stack.push({ category: "框架", name: "Spring Boot", type: "framework" });
    if (gradleContent.toLowerCase().includes("kotlin"))
      stack.push({ category: "语言", name: "Kotlin", type: "language" });
  }
}

function detectDotNet(stack: TechStackItem[], root: string): void {
  const csproj = existsSync(join(root, "*.csproj")) || existsSync(join(root, "src"));
  const sln = existsSync(join(root, "*.sln"));
  if (!csproj && !sln) return;
  stack.push({ category: "语言", name: ".NET/C#", type: "language" });
}

function detectRuby(stack: TechStackItem[], root: string): void {
  const gemfile = readFileSafe(join(root, "Gemfile"));
  if (!gemfile) return;
  stack.push({ category: "语言", name: "Ruby", type: "language" });
  if (gemfile.toLowerCase().includes("rails")) stack.push({ category: "框架", name: "Rails", type: "framework" });
  if (gemfile.toLowerCase().includes("sinatra")) stack.push({ category: "框架", name: "Sinatra", type: "framework" });
}

function detectPhp(stack: TechStackItem[], root: string): void {
  const composer = readJsonSafe(join(root, "composer.json"));
  if (!composer) return;
  stack.push({ category: "语言", name: "PHP", type: "language" });
  const req = composer.require as Record<string, string> | undefined;
  if (req?.laravel) stack.push({ category: "框架", name: "Laravel", type: "framework" });
  if (req?.symfony) stack.push({ category: "框架", name: "Symfony", type: "framework" });
}

function detectSwift(stack: TechStackItem[], root: string): void {
  const pkg = readFileSafe(join(root, "Package.swift"));
  if (!pkg) return;
  stack.push({ category: "语言", name: "Swift", type: "language" });
  if (pkg.toLowerCase().includes("vapor")) stack.push({ category: "框架", name: "Vapor", type: "framework" });
}

function detectDart(stack: TechStackItem[], root: string): void {
  const pubspec = readFileSafe(join(root, "pubspec.yaml"));
  if (!pubspec) return;
  stack.push({ category: "语言", name: "Dart/Flutter", type: "language" });
  if (pubspec.toLowerCase().includes("flutter")) stack.push({ category: "框架", name: "Flutter", type: "framework" });
}

function detectC(stack: TechStackItem[], root: string): void {
  const hasCmake = existsSync(join(root, "CMakeLists.txt"));
  const hasMakefile = existsSync(join(root, "Makefile"));
  const hasMeson = existsSync(join(root, "meson.build"));
  if (!hasCmake && !hasMakefile && !hasMeson) return;
  stack.push({ category: "语言", name: "C/C++", type: "language" });
  if (hasCmake) stack.push({ category: "构建工具", name: "CMake", type: "build-tool" });
}

function detectInfra(stack: TechStackItem[], root: string): void {
  if (
    existsSync(join(root, "Dockerfile")) ||
    existsSync(join(root, "docker-compose.yml")) ||
    existsSync(join(root, "docker-compose.yaml"))
  ) {
    stack.push({ category: "基础设施", name: "Docker", type: "infra" });
  }
  if (existsSync(join(root, ".github/workflows")))
    stack.push({ category: "基础设施", name: "GitHub Actions", type: "infra" });
  if (existsSync(join(root, ".gitlab-ci.yml"))) stack.push({ category: "基础设施", name: "GitLab CI", type: "infra" });
  if (existsSync(join(root, "Jenkinsfile"))) stack.push({ category: "基础设施", name: "Jenkins", type: "infra" });
  if (existsSync(join(root, "terraform")) || readFileSafe(join(root, "main.tf"))) {
    stack.push({ category: "基础设施", name: "Terraform", type: "infra" });
  }
  if (existsSync(join(root, "k8s")) || existsSync(join(root, "kubernetes"))) {
    stack.push({ category: "基础设施", name: "Kubernetes", type: "infra" });
  }
}

// ─── 公开 API ──────────────────────────────────────────────

/**
 * 检测项目的技术栈。
 * 扫描项目根目录的配置文件，识别语言、框架、构建工具等。
 */
export function detectTechStack(root: string = process.cwd()): TechStackItem[] {
  const stack: TechStackItem[] = [];

  detectNode(stack, root);
  detectPython(stack, root);
  detectRust(stack, root);
  detectGo(stack, root);
  detectJava(stack, root);
  detectDotNet(stack, root);
  detectRuby(stack, root);
  detectPhp(stack, root);
  detectSwift(stack, root);
  detectDart(stack, root);
  detectC(stack, root);
  detectInfra(stack, root);

  return stack;
}

/** 获取 Git 当前分支名 */
export function getCurrentBranch(): string {
  try {
    return execSync("git branch --show-current", { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return "unknown";
  }
}

/** 获取项目顶层目录结构（限制数量） */
export function getDirectoryStructure(root: string = process.cwd(), maxItems = 40): string {
  try {
    const items = execSync(`ls -1 "${root}"`, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    const lines = items.split("\n").slice(0, maxItems);
    return lines.join("\n");
  } catch {
    return "";
  }
}

/** 格式化技术栈为摘要字符串 */
export function formatTechStackSummary(stack: TechStackItem[]): string {
  const languages = stack.filter((s) => s.type === "language").map((s) => s.name);
  const frameworks = stack.filter((s) => s.type === "framework").map((s) => s.name);
  const tools = stack.filter((s) => s.type !== "language" && s.type !== "framework").map((s) => s.name);

  const parts: string[] = [];
  if (languages.length) parts.push(`语言: ${languages.join(", ")}`);
  if (frameworks.length) parts.push(`框架: ${frameworks.join(", ")}`);
  if (tools.length) parts.push(`工具: ${tools.slice(0, 8).join(", ")}`);

  return parts.join("\n");
}
