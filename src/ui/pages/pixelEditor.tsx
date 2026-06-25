/**
 * Pixel 编辑器页面
 *
 * 职责:
 *   - 提供终端像素画编辑功能
 *   - 支持创建、编辑、保存像素画
 *   - 管理绘画文件
 *
 * 模块功能:
 *   - 三视图架构:menu(主菜单)、editor(编辑器)、manager(管理器)
 *   - 半块字符(▀)双像素渲染，2x 垂直分辨率
 *   - 16色色板选择
 *   - 光标 400ms 闪烁动画
 *   - 画布操作:绘制、擦除、清除、切换尺寸(8/16/32)
 *   - 文件操作:保存、加载、删除、导出预览
 *   - 绘画持久化到 ~/.crab/draw/
 *
 * 使用场景:
 *   - 创建简单的像素艺术
 *   - 管理保存的绘画文件
 *
 * 边界:
 *   1. 仅支持 8/16/32 像素画布尺寸
 *   2. 16色固定色板
 *   3. 绘画保存为 JSON 格式
 *
 * 流程:
 *   1. 主菜单选择新建或管理
 *   2. 编辑器中绘制像素
 *   3. Ctrl+S 保存或命名保存
 *   4. 管理器中加载或删除绘画
 */
import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "@/ui/contexts/theme";
import { useRoute } from "@/ui/contexts/route";
import {
  type DrawingMeta,
  arrayToGrid,
  cropGrid,
  deleteDrawing,
  gridToArray,
  listDrawings,
  loadDrawing,
  saveDrawing,
} from "@/core/storage";
import { actionSelect, iconFolder, iconTheme, toolWrite } from "@/ui/utils/icon";
import { checkboxIcon } from "@/core/icons/iconDerived";

// ─── 常量 ──────────────────────────────────────────────────

const SIZES = [8, 16, 32] as const;

const PALETTE = [
  "#000000",
  "#ffffff",
  "#ff0000",
  "#00ff00",
  "#0000ff",
  "#ffff00",
  "#ff00ff",
  "#00ffff",
  "#808080",
  "#ffa500",
  "#ff4444",
  "#44ff44",
  "#4444ff",
  "#884400",
  "#ff8800",
  "#8800ff",
];

/** 半块字符 — 上半部前景色 = 顶部像素，背景色 = 底部像素 */
const BLOCK_CHAR = "▀";

// ─── 辅助函数 ──────────────────────────────────────────────

/** 获取像素颜色(-1 = 空 → 返回背景色) */
function pixelColor(idx: number, bgColor: string): string {
  if (idx < 0) {
    return bgColor;
  }
  return PALETTE[idx] ?? bgColor;
}

/** 光标视觉效果:亮色变暗，暗色变亮 */
function applyCursorEffect(hex: string): string {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) {
    return hex;
  }
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const brightness = (r + g + b) / 3;
  if (brightness > 200) {
    const f = 0.5;
    return `#${[r, g, b]
      .map((c) =>
        Math.round(c * f)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;
  }
  const ratio = 0.6;
  const nr = Math.min(255, Math.round(r + (255 - r) * ratio));
  const ng = Math.min(255, Math.round(g + (255 - g) * ratio));
  const nb = Math.min(255, Math.round(b + (255 - b) * ratio));
  return `#${[nr, ng, nb].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

// ─── 视图类型 ──────────────────────────────────────────────

type View = "menu" | "editor" | "manager";

// ─── 主组件 ────────────────────────────────────────────────

export function PixelEditor() {
  const theme = useTheme();
  const route = useRoute();
  const bg = () => theme.colors.background;

  // ─── 全局视图状态 ─────────────────────────────────────
  const [view, setView] = createSignal<View>("menu");
  const [message, setMessage] = createSignal<string | null>(null);
  const [msgTimer, setMsgTimer] = createSignal<ReturnType<typeof setTimeout> | null>(null);

  // ─── 菜单状态 ─────────────────────────────────────────
  const [menuIndex, setMenuIndex] = createSignal(0);

  // ─── 编辑器状态 ───────────────────────────────────────
  const [sizeIdx, setSizeIdx] = createSignal(1);
  const size = (): number => SIZES[sizeIdx()] ?? 16;
  const [canvas, setCanvas] = createSignal<Int16Array>(new Int16Array(16 * 16).fill(-1));
  const [cursorX, setCursorX] = createSignal(8);
  const [cursorY, setCursorY] = createSignal(8);
  const [currentColor, setCurrentColor] = createSignal(1);
  const [cursorVisible, setCursorVisible] = createSignal(true);
  const [isNamingSave, setIsNamingSave] = createSignal(false);
  const [saveNameInput, setSaveNameInput] = createSignal("");
  const [currentName, setCurrentName] = createSignal("");
  const [confirmClear, setConfirmClear] = createSignal(false);
  const [showExport, setShowExport] = createSignal(false);
  const [exportData, setExportData] = createSignal("");
  const [editorReturnView, setEditorReturnView] = createSignal<View>("menu");

  // ─── 管理器状态 ───────────────────────────────────────
  const [drawings, setDrawings] = createSignal<DrawingMeta[]>([]);
  const [managerIndex, setManagerIndex] = createSignal(0);
  const [selectedNames, setSelectedNames] = createSignal<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = createSignal(false);

  // ─── 光标闪烁(400ms) ──────────────────────────────
  let blinkInterval: ReturnType<typeof setInterval> | undefined;
  onMount(() => {
    blinkInterval = setInterval(() => {
      if (view() === "editor") {
        setCursorVisible((v) => !v);
      }
    }, 400);
  });
  onCleanup(() => {
    if (blinkInterval) {
      clearInterval(blinkInterval);
    }
  });

  // ─── 消息自动清除(1.5s) ────────────────────────────
  const showMsg = (msg: string) => {
    const old = msgTimer();
    if (old) {
      clearTimeout(old);
    }
    setMessage(msg);
    setMsgTimer(setTimeout(() => setMessage(null), 1500));
  };

  // ─── 编辑器操作 ───────────────────────────────────────

  const resetCanvas = (s: number) => {
    setCanvas(new Int16Array(s * s).fill(-1));
    setCursorX(Math.floor(s / 2));
    setCursorY(Math.floor(s / 2));
    setConfirmClear(false);
    setShowExport(false);
  };

  const enterEditor = (initialGrid?: Int16Array, name?: string) => {
    if (initialGrid) {
      setCanvas(initialGrid);
    } else {
      resetCanvas(size());
    }
    setCurrentName(name ?? "");
    setIsNamingSave(false);
    setSaveNameInput("");
    setCursorVisible(true);
    setView("editor");
  };

  const drawPixel = () => {
    const c = canvas();
    const s = size();
    const idx = cursorY() * s + cursorX();
    if (idx < 0 || idx >= c.length) {
      return;
    }
    const next = new Int16Array(c);
    next[idx] = currentColor();
    setCanvas(next);
  };

  const erasePixel = () => {
    const c = canvas();
    const s = size();
    const idx = cursorY() * s + cursorX();
    if (idx < 0 || idx >= c.length) {
      return;
    }
    const next = new Int16Array(c);
    next[idx] = -1;
    setCanvas(next);
  };

  const togglePixel = () => {
    const c = canvas();
    const s = size();
    const idx = cursorY() * s + cursorX();
    if ((c[idx] ?? -1) >= 0) {
      erasePixel();
    } else {
      drawPixel();
    }
  };

  const clearCanvas = () => {
    setCanvas(new Int16Array(size() * size()).fill(-1));
    setConfirmClear(false);
    showMsg("画作已删除");
  };

  const doSave = (name: string) => {
    const s = size();
    saveDrawing(name, s, s, gridToArray(canvas(), s, s));
    setCurrentName(name);
    showMsg(`已保存: ${name}`);
  };

  const exportCropped = () => {
    const s = size();
    const g = gridToArray(canvas(), s, s);
    const cropped = cropGrid(g, s, s);
    const lines: string[] = [];
    for (const row of cropped) {
      let line = "";
      for (const val of row) {
        line += val >= 0 ? "██" : "  ";
      }
      lines.push(line);
    }
    return lines.length === 0 ? "(empty)" : lines.join("\n");
  };

  const refreshDrawings = () => {
    setDrawings(listDrawings());
    setManagerIndex(0);
    setSelectedNames(new Set<string>());
    setPendingDelete(false);
  };

  // ─── 半块渲染 ────────────────────────────────────────

  const renderedRows = createMemo(() => {
    const c = canvas();
    const s = size();
    const cv = cursorVisible();
    const cx = cursorX();
    const cy = cursorY();
    const bgColor = bg();
    const halfRows = Math.ceil(s / 2);
    const rows: { topColor: string; bottomColor: string }[][] = [];

    for (let charY = 0; charY < halfRows; charY++) {
      const row: { topColor: string; bottomColor: string }[] = [];
      const topY = charY * 2;
      const bottomY = topY + 1;
      for (let x = 0; x < s; x++) {
        const topIdx = topY < s ? (c[topY * s + x] ?? -1) : -1;
        const bottomIdx = bottomY < s ? (c[bottomY * s + x] ?? -1) : -1;
        let topCol = pixelColor(topIdx, bgColor);
        let bottomCol = pixelColor(bottomIdx, bgColor);
        if (cv) {
          if (x === cx && topY === cy) {
            topCol = applyCursorEffect(topCol);
          }
          if (x === cx && bottomY === cy) {
            bottomCol = applyCursorEffect(bottomCol);
          }
        }
        row.push({ bottomColor: bottomCol, topColor: topCol });
      }
      rows.push(row);
    }
    return rows;
  });

  // ─── 管理器滚动窗口 ──────────────────────────────────

  const displayWindow = createMemo(() => {
    const all = drawings();
    const idx = managerIndex();
    if (all.length <= 8) {
      return { end: all.length, items: all, start: 0 };
    }
    let start = 0;
    if (idx >= 8) {
      start = idx - 8 + 1;
    }
    const end = Math.min(all.length, start + 8);
    return { end, items: all.slice(start, end), start };
  });

  // ─── 键盘处理 ─────────────────────────────────────────

  useKeyboard((event) => {
    // 导出预览 — 任意键关闭
    if (showExport()) {
      if (event.name === "escape" || event.name === "return" || event.name === "enter") {
        setShowExport(false);
        event.stopPropagation();
      }
      return;
    }

    // ─── 菜单视图 ─────────────────────────────────
    if (view() === "menu") {
      if (event.name === "escape" || event.name === "q") {
        route.back();
        event.stopPropagation();
        return;
      }
      if (event.name === "up") {
        setMenuIndex((i) => (i > 0 ? i - 1 : 1));
        event.stopPropagation();
        return;
      }
      if (event.name === "down") {
        setMenuIndex((i) => (i < 1 ? i + 1 : 0));
        event.stopPropagation();
        return;
      }
      if (event.name === "return" || event.name === "enter") {
        if (menuIndex() === 0) {
          setEditorReturnView("menu");
          enterEditor();
        } else {
          refreshDrawings();
          setView("manager");
        }
        event.stopPropagation();
        return;
      }
      return;
    }

    // ─── 命名保存模式 ────────────────────────────
    if (view() === "editor" && isNamingSave()) {
      if (event.name === "escape") {
        setIsNamingSave(false);
        setSaveNameInput("");
        showMsg("取消");
        event.stopPropagation();
        return;
      }
      if (event.name === "return" || event.name === "enter") {
        const name = saveNameInput().trim();
        if (!name) {
          showMsg("不能为空");
          event.stopPropagation();
          return;
        }
        doSave(name);
        setIsNamingSave(false);
        setSaveNameInput("");
        event.stopPropagation();
        return;
      }
      if (event.name === "backspace" || event.name === "delete") {
        setSaveNameInput((s) => s.slice(0, -1));
        event.stopPropagation();
        return;
      }
      const ch = (event as any).text as string | undefined;
      if (ch && ch.length === 1 && !event.ctrl && !event.meta) {
        setSaveNameInput((s) => s + ch);
        event.stopPropagation();
      }
      return;
    }

    // ─── 确认清除模式 ────────────────────────────
    if (view() === "editor" && confirmClear()) {
      const ch = (event as any).text as string | undefined;
      if (ch === "y" || ch === "Y") {
        clearCanvas();
      } else {
        setConfirmClear(false);
      }
      event.stopPropagation();
      return;
    }

    // ─── 编辑器视图 ──────────────────────────────
    if (view() === "editor") {
      if (event.name === "escape") {
        setView(editorReturnView());
        event.stopPropagation();
        return;
      }
      if (event.name === "up") {
        setCursorY((y) => Math.max(0, y - 1));
        event.stopPropagation();
        return;
      }
      if (event.name === "down") {
        setCursorY((y) => Math.min(size() - 1, y + 1));
        event.stopPropagation();
        return;
      }
      if (event.name === "left") {
        setCursorX((x) => Math.max(0, x - 1));
        event.stopPropagation();
        return;
      }
      if (event.name === "right") {
        setCursorX((x) => Math.min(size() - 1, x + 1));
        event.stopPropagation();
        return;
      }
      if (event.name === " " || event.name === "space") {
        togglePixel();
        event.stopPropagation();
        return;
      }
      if (event.name === "return" || event.name === "enter") {
        drawPixel();
        event.stopPropagation();
        return;
      }
      const ch = (event as any).text as string | undefined;
      if (ch === "0" && !event.ctrl) {
        erasePixel();
        event.stopPropagation();
        return;
      }
      if ((ch === "c" || ch === "C") && !event.ctrl) {
        setConfirmClear(true);
        event.stopPropagation();
        return;
      }
      if ((ch === "s" || ch === "S") && !event.ctrl) {
        setSizeIdx((i) => (i + 1) % SIZES.length);
        resetCanvas(size());
        showMsg(`画布: ${size()}x${size()}`);
        event.stopPropagation();
        return;
      }
      if (ch === "e" || ch === "E") {
        setExportData(exportCropped());
        setShowExport(true);
        event.stopPropagation();
        return;
      }
      if (event.ctrl && (ch === "s" || ch === "S")) {
        const name = currentName();
        if (name) {
          doSave(name);
        } else {
          setIsNamingSave(true);
          setSaveNameInput("");
        }
        event.stopPropagation();
        return;
      }
      if (ch && ch >= "1" && ch <= "9" && !event.ctrl) {
        const idx = parseInt(ch);
        if (idx < PALETTE.length) {
          setCurrentColor(idx);
        }
        event.stopPropagation();
        return;
      }
      return;
    }

    // ─── 管理器视图 ──────────────────────────────
    if (view() === "manager") {
      if (event.name === "escape") {
        if (pendingDelete()) {
          setPendingDelete(false);
          event.stopPropagation();
          return;
        }
        setSelectedNames(new Set<string>());
        setManagerIndex(0);
        setView("menu");
        event.stopPropagation();
        return;
      }
      if (pendingDelete()) {
        const ch = (event as any).text as string | undefined;
        if (event.name === "return" || event.name === "enter" || ch === "y" || ch === "Y") {
          for (const n of selectedNames()) {
            deleteDrawing(n);
          }
          setSelectedNames(new Set<string>());
          setPendingDelete(false);
          refreshDrawings();
          showMsg("画作已删除");
          event.stopPropagation();
          return;
        }
        if (ch === "n" || ch === "N") {
          setPendingDelete(false);
          event.stopPropagation();
          return;
        }
        return;
      }
      if (event.name === "up") {
        const max = Math.max(0, drawings().length - 1);
        setManagerIndex((i) => (i > 0 ? i - 1 : max));
        event.stopPropagation();
        return;
      }
      if (event.name === "down") {
        const max = Math.max(0, drawings().length - 1);
        setManagerIndex((i) => (i < max ? i + 1 : 0));
        event.stopPropagation();
        return;
      }
      if (event.name === " " || event.name === "space") {
        const cur = drawings()[managerIndex()];
        if (cur) {
          const next = new Set(selectedNames());
          if (next.has(cur.fileName)) {
            next.delete(cur.fileName);
          } else {
            next.add(cur.fileName);
          }
          setSelectedNames(next);
        }
        event.stopPropagation();
        return;
      }
      const ch = (event as any).text as string | undefined;
      if ((ch === "d" || ch === "D") && selectedNames().size > 0) {
        setPendingDelete(true);
        event.stopPropagation();
        return;
      }
      if (event.name === "return" || event.name === "enter") {
        const cur = drawings()[managerIndex()];
        if (cur) {
          const data = loadDrawing(cur.fileName);
          if (data) {
            const si = SIZES.indexOf(data.width as any);
            if (si !== -1) {
              setSizeIdx(si);
            }
            const grid = arrayToGrid(data.grid, data.width, data.height);
            setEditorReturnView("manager");
            enterEditor(grid, cur.name);
          }
        }
        event.stopPropagation();
        return;
      }
    }
  });

  // ─── 渲染 ─────────────────────────────────────────────

  const themeCtx = theme;

  return (
    <box flexDirection="column" flexGrow={1} padding={1}>
      {/* ─── 菜单视图 ──────────────────────────────── */}
      <Show when={view() === "menu"}>
        <text fg={themeCtx.colors.accent}>{iconTheme} Pixel Editor</text>
        <box height={1} />
        <text fg={menuIndex() === 0 ? themeCtx.colors.accent : themeCtx.colors.text}>
          {menuIndex() === 0 ? `${actionSelect} ` : "  "}
          {iconTheme} 新建画布
        </text>
        <text fg={menuIndex() === 1 ? themeCtx.colors.accent : themeCtx.colors.text}>
          {menuIndex() === 1 ? `${actionSelect} ` : "  "}
          {iconFolder} 管理绘画
        </text>
        <box height={1} />
        <text fg={themeCtx.colors.muted}>↑↓ 选择 | Enter 确认 | Esc 返回</text>
      </Show>

      {/* ─── 编辑器视图 ────────────────────────────── */}
      <Show when={view() === "editor"}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={themeCtx.colors.accent}>
            {iconTheme} Pixel Editor ({size()}x{size()})
          </text>
          <text fg={themeCtx.colors.muted}>
            {isNamingSave() ? "输入画作名称" : confirmClear() ? "确定清空画布吗？(Y/N)" : "↑↓←→ Space 0 C S E Ctrl+S"}
          </text>
        </box>
        <box height={1} />

        {/* 命名保存 */}
        <Show when={isNamingSave()}>
          <box borderStyle="single" borderColor={themeCtx.colors.accent} padding={1}>
            <text fg={themeCtx.colors.accent}>{toolWrite} 保存绘画</text>
            <box height={1} />
            <text fg={themeCtx.colors.text}>
              名称: {saveNameInput() || "输入画作名称"}
              {saveNameInput().length === 0 ? "_" : ""}
            </text>
          </box>
        </Show>

        {/* 确认清除 */}
        <Show when={confirmClear()}>
          <text fg={themeCtx.colors.warning}>⚠ 确定清除画布？(Y/其他)</text>
        </Show>

        {/* 半块画布 */}
        <box flexDirection="column" flexGrow={1}>
          <For each={renderedRows()}>
            {(row) => (
              <box flexDirection="row">
                <For each={row}>
                  {(cell) => (
                    <text fg={cell.topColor} bg={cell.bottomColor}>
                      {BLOCK_CHAR}
                    </text>
                  )}
                </For>
              </box>
            )}
          </For>
        </box>

        {/* 色板 */}
        <box height={1} />
        <box flexDirection="row">
          <text fg={themeCtx.colors.muted}>色板: </text>
          <For each={PALETTE}>
            {(c, idx) => (
              <text fg={currentColor() === idx() ? themeCtx.colors.accent : c}>
                {currentColor() === idx() ? "▸" : "■"}
              </text>
            )}
          </For>
        </box>
        <text fg={themeCtx.colors.muted}>
          光标: ({cursorX()}, {cursorY()}) 颜色: {PALETTE[currentColor()] ?? "??"}
          {currentName() ? ` | 名称: ${currentName()}` : ""}
        </text>
        <Show when={message()}>
          <text fg={themeCtx.colors.success}>{message()}</text>
        </Show>

        {/* 导出预览 */}
        <Show when={showExport()}>
          <box borderStyle="single" borderColor={themeCtx.colors.accent} padding={1} marginTop={1}>
            <text fg={themeCtx.colors.muted}>导出预览(按任意键关闭):</text>
            <text fg={themeCtx.colors.text}>{exportData()}</text>
          </box>
        </Show>
      </Show>

      {/* ─── 管理器视图 ────────────────────────────── */}
      <Show when={view() === "manager"}>
        <text fg={themeCtx.colors.accent}>{iconFolder} 绘画管理</text>
        <box height={1} />

        <Show when={drawings().length === 0}>
          <text fg={themeCtx.colors.muted}>暂无保存的绘画</text>
          <text fg={themeCtx.colors.muted}>返回菜单创建新画布</text>
        </Show>

        <Show when={drawings().length > 0}>
          <box flexDirection="column">
            <For each={displayWindow().items}>
              {(drawing, idx) => {
                const origIdx = displayWindow().start + idx();
                const sel = origIdx === managerIndex();
                const chk = selectedNames().has(drawing.fileName);
                return (
                  <text fg={sel ? themeCtx.colors.accent : themeCtx.colors.text}>
                    {sel ? `${actionSelect} ` : "  "}
                    {chk ? checkboxIcon(true) : checkboxIcon(false)} {drawing.name}
                  </text>
                );
              }}
            </For>
          </box>
        </Show>

        <box height={1} />
        <Show when={pendingDelete()}>
          <text fg={themeCtx.colors.warning}>⚠ 确定删除 {String(selectedNames().size)} 个绘画？(Y/N)</text>
        </Show>
        <Show when={!pendingDelete()}>
          <text fg={themeCtx.colors.muted}>↑↓ 选择 | Enter 加载 | Space 多选 | D 删除 | Esc 返回</text>
        </Show>
        <Show when={selectedNames().size > 0 && !pendingDelete()}>
          <text fg={themeCtx.colors.warning}>已选 {selectedNames().size} 个</text>
        </Show>
        <Show when={message()}>
          <text fg={themeCtx.colors.success}>{message()}</text>
        </Show>
      </Show>
    </box>
  );
}
