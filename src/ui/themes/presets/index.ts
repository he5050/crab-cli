/**
 * 预置主题预设 — 内置的完整 RGBA 主题 JSON。
 *
 * 职责:
 *   - 导入 30 个预置主题 JSON
 *   - 提供统一的预设主题列表
 *   - 可作为 ~/.crab/themes/*.json 的参考模板
 *
 * 使用场景:
 *   - 主题选择器展示
 *   - 自定义主题参考
 *   - 默认主题降级
 */
import dracula from "./dracula.json";
import monokai from "./monokai.json";
import nord from "./nord.json";
import catppuccin from "./catppuccin.json";
import gruvbox from "./gruvbox.json";
import onedark from "./onedark.json";
import rosepine from "./rosepine.json";
import tokyonight from "./tokyonight.json";
import solarized from "./solarized.json";
import aura from "./aura.json";
import ayuDark from "./ayu-dark.json";
import ayuLight from "./ayu-light.json";
import ayuMirage from "./ayu-mirage.json";
import carbonfox from "./carbonfox.json";
import dawn from "./dawn.json";
import everforest from "./everforest.json";
import githubDark from "./github-dark.json";
import githubLight from "./github-light.json";
import kanagawa from "./kanagawa.json";
import materialDarker from "./material-darker.json";
import materialOcean from "./material-ocean.json";
import mocha from "./mocha.json";
import nightOwl from "./night-owl.json";
import noctis from "./noctis.json";
import oneDarkPro from "./one-dark-pro.json";
import oxocarbon from "./oxocarbon.json";
import poimandres from "./poimandres.json";
import sweetDark from "./sweet-dark.json";
import synthwave from "./synthwave.json";
import vscodeDark from "./vscode-dark.json";

/** 所有预置主题 JSON */
export const PRESET_THEMES = [
  dracula,
  monokai,
  nord,
  catppuccin,
  gruvbox,
  onedark,
  rosepine,
  tokyonight,
  solarized,
  aura,
  ayuDark,
  ayuLight,
  ayuMirage,
  carbonfox,
  dawn,
  everforest,
  githubDark,
  githubLight,
  kanagawa,
  materialDarker,
  materialOcean,
  mocha,
  nightOwl,
  noctis,
  oneDarkPro,
  oxocarbon,
  poimandres,
  sweetDark,
  synthwave,
  vscodeDark,
] as const;

/** 预置主题名称列表 */
export const PRESET_THEME_NAMES = PRESET_THEMES.map((t) => t.name);
