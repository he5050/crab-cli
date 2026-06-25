/**
 * 平台通知 — macOS/Windows/Linux 原生 toast 通知
 */

import { execSync } from "node:child_process";

const APP_ID = "Crab CLI";
const MAX_BODY_LENGTH = 240;
const CONTROL_CHARS = /[\0-\x1F\x7F]/g;

function cleanText(value: string): string {
  const cleaned = value
    .replace(CONTROL_CHARS, "")
    .replace(/[\r\n]+/g, " ")
    .trim();
  return cleaned.length > MAX_BODY_LENGTH ? `${cleaned.slice(0, MAX_BODY_LENGTH - 1)}…` : cleaned;
}

function showMacNotification(title: string, body: string): void {
  try {
    const safeTitle = title.replace(/"/g, '\\"').replace(/\\/g, "\\\\");
    const safeBody = body.replace(/"/g, '\\"').replace(/\\/g, "\\\\");
    execSync(`osascript -e 'display notification "${safeBody}" with title "${safeTitle}"'`, {
      stdio: "ignore",
    });
  } catch {
    // 静默失败
  }
}

function showWindowsNotification(title: string, body: string): void {
  try {
    const cleanBody = body.replace(/"/g, '\\"').replace(/`n/g, "`n").replace(/\$/g, "`$");
    const ps = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "[System.Windows.Forms.ToolTipIcon]::None",
      "$n = New-Object System.Windows.Forms.NotifyIcon",
      "$n.Icon = [System.Drawing.SystemIcons]::Information",
      "$n.Visible = $true",
      "$n.ShowBalloonTip(" +
        Math.max(0, title.length) +
        ', 0, "' +
        cleanBody +
        '", "Crab CLI", [System.Windows.Forms.ToolTipIcon]::None)',
      "Start-Sleep -Milliseconds 300",
      "$n.Dispose()",
    ].join("\n");
    const encoded = Buffer.from(ps).toString("base64");
    execSync(`powershell -NoProfile -EncodedCommand ${encoded}`, {
      stdio: "ignore",
    });
  } catch {
    // 静默失败
  }
}

function showLinuxNotification(title: string, body: string): void {
  try {
    const cmd =
      "notify-send " + ["--app-name=" + APP_ID, cleanText(title), cleanText(body)].map((a) => `"${a}"`).join(" ");
    execSync(cmd, { stdio: "ignore" });
  } catch {
    // 静默失败
  }
}

// ─── 公开 API ──────────────────────────────────────────────────

export interface NotificationPayload {
  title: string;
  body: string;
}

/** 发送原生桌面通知 */
export function showDesktopNotification(payload: NotificationPayload): void {
  switch (process.platform) {
    case "darwin":
      showMacNotification(payload.title, payload.body);
      break;
    case "win32":
      showWindowsNotification(payload.title, payload.body);
      break;
    case "linux":
      showLinuxNotification(payload.title, payload.body);
      break;
    default:
      break;
  }
}

/** 发送终端通知（OSC 9 序列） */
export function writeTerminalNotification(title: string, body: string): void {
  const message = [cleanText(title), cleanText(body)].filter(Boolean).join(": ");
  if (message) {
    process.stdout.write(`\x1B]9;${message}\x07`);
  }
}

/** 同时发送终端 + 桌面通知 */
export function showPlatformNotification(
  payload: NotificationPayload,
  options?: { terminal?: boolean; toast?: boolean },
): void {
  const { terminal = true, toast = true } = options ?? {};
  if (terminal) writeTerminalNotification(payload.title, payload.body);
  if (toast) showDesktopNotification(payload);
}

// ─── 通知开关 ──────────────────────────────────────────────

let notificationEnabled = true;

/** 获取通知开关状态 */
export function isNotificationEnabled(): boolean {
  return notificationEnabled;
}

/** 设置通知开关 */
export function setNotificationEnabled(enabled: boolean): void {
  notificationEnabled = enabled;
}

/** 切换通知开关，返回新状态 */
export function toggleNotification(): boolean {
  notificationEnabled = !notificationEnabled;
  return notificationEnabled;
}
