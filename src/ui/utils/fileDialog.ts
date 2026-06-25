/**
 * 文件对话框模块
 *
 * 职责:
 *   - 提供跨平台原生文件保存对话框
 *   - 支持 macOS、Windows、Linux 三大平台
 *   - 处理平台特定的对话框调用
 *
 * 模块功能:
 *   - 显示跨平台文件保存对话框
 *   - 检查平台是否支持原生文件对话框
 *   - 自动选择平台特定的实现(osascript/PowerShell/zenity/kdialog)
 *
 * 使用场景:
 *   - 导出对话内容时选择保存位置
 *   - 保存配置文件
 *   - 导出日志文件
 *
 * 边界:
 *   1. 仅支持文件保存对话框，不支持打开对话框
 *   2. macOS 使用 osascript (AppleScript)
 *   3. Windows 使用 PowerShell SaveFileDialog
 *   4. Linux 优先使用 zenity，回退到 kdialog
 *   5. 对话框外观依赖系统原生实现
 *   6. 不支持自定义文件过滤器(使用默认文本/Markdown/所有文件)
 *
 * 流程:
 *   1. 检测当前操作系统平台
 *   2. 根据平台调用对应的对话框实现
 *   3. 传入默认文件名和标题
 *   4. 等待用户选择或取消
 *   5. 返回选定的文件路径或 null
 */

import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as os from "node:os";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

function escapePowerShellString(value: string): string {
  return value.replace(/'/g, "''");
}

async function showWindowsSaveDialog(defaultFilename: string, title: string): Promise<string | null> {
  const downloadsPath = path.join(os.homedir(), "Downloads");
  const filterStr = "Text files (*.txt)|*.txt|Markdown files (*.md)|*.md|All files (*.*)|*.*";
  const psScript = [
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;",
    "$OutputEncoding = [System.Text.Encoding]::UTF8;",
    "Add-Type -AssemblyName System.Windows.Forms;",
    "$dialog = New-Object System.Windows.Forms.SaveFileDialog;",
    `$dialog.Title = '${escapePowerShellString(title)}';`,
    `$dialog.Filter = '${escapePowerShellString(filterStr)}';`,
    `$dialog.FileName = '${escapePowerShellString(defaultFilename)}';`,
    `$dialog.InitialDirectory = '${escapePowerShellString(downloadsPath)}';`,
    "$dialog.RestoreDirectory = $true;",
    "$result = $dialog.ShowDialog();",
    "if ($result -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.WriteLine($dialog.FileName); }",
  ].join(" ");
  const encodedCommand = Buffer.from(psScript, "utf16le").toString("base64");
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-STA",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    encodedCommand,
  ]);
  const result = stdout.trim();
  return result || null;
}

/**
 * 跨平台文件保存对话框。
 */
export async function showSaveDialog(
  defaultFilename: string = "export.txt",
  title: string = "保存文件",
): Promise<string | null> {
  const platform = os.platform();

  try {
    if (platform === "darwin") {
      const defaultPath = path.join(os.homedir(), "Downloads", defaultFilename);
      const script = `
        set defaultPath to POSIX file "${defaultPath}"
        set saveFile to choose file name with prompt "${title}" default location (POSIX file "${os.homedir()}/Downloads") default name "${defaultFilename}"
        return POSIX path of saveFile
      `;
      const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, String.raw`'\''`)}'`);
      return stdout.trim();
    } else if (platform === "win32") {
      return showWindowsSaveDialog(defaultFilename, title);
    } else {
      // Linux — zenity / kdialog
      const defaultPath = path.join(os.homedir(), "Downloads", defaultFilename);
      try {
        const { stdout } = await execAsync(
          `zenity --file-selection --save --title="${title}" --filename="${defaultPath}" --confirm-overwrite`,
        );
        return stdout.trim();
      } catch {
        try {
          const { stdout } = await execAsync(
            `kdialog --getsavefilename "${defaultPath}" "*.*|All Files" --title "${title}"`,
          );
          return stdout.trim();
        } catch {
          return null;
        }
      }
    }
  } catch {
    return null;
  }
}

/**
 * 检查平台是否支持原生文件对话框。
 */
export function isFileDialogSupported(): boolean {
  const platform = os.platform();
  return platform === "darwin" || platform === "win32" || platform === "linux";
}
