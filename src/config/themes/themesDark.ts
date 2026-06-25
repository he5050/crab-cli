import type { ThemeDefinition } from "../types/themeTypes";
import { OPENCODE_DARK_EXTENDED, OPENCODE_LIGHT_EXTENDED } from "./themesOpenCodeExtended";

import { ONE_DARK_DARK_EXTENDED, ONE_DARK_LIGHT_EXTENDED } from "./themesOneDarkExtended";

export const ONE_DARK: ThemeDefinition = {
  colors: {
    accent: "#e5c07b",
    background: "#282c34",
    border: "#3b4048",
    error: "#e06c75",
    info: "#56b6c2",
    muted: "#5c6370",
    primary: "#61afef",
    secondary: "#c678dd",
    success: "#98c379",
    text: "#d8dee9",
    warning: "#d19a66",
  },
  label: "One Dark",
  lightColors: {
    accent: "#b76b01",
    background: "#fafafa",
    border: "#e5e5e6",
    error: "#e45649",
    info: "#0184bc",
    muted: "#a0a1a7",
    primary: "#4078f2",
    secondary: "#a626a4",
    success: "#50a14f",
    text: "#383a42",
    warning: "#986801",
  },
  mode: "dark",
  name: "one-dark",
  palette: ["#e06c75", "#d19a66", "#98c379", "#61afef"],
  extendedColors: ONE_DARK_DARK_EXTENDED,
  lightExtendedColors: ONE_DARK_LIGHT_EXTENDED,
};

export const DRACULA: ThemeDefinition = {
  colors: {
    accent: "#f1fa8c",
    background: "#282a36",
    border: "#44475a",
    error: "#ff5555",
    info: "#8be9fd",
    muted: "#6272a4",
    primary: "#bd93f9",
    secondary: "#ff79c6",
    success: "#50fa7b",
    text: "#f8f8f2",
    warning: "#ffb86c",
  },
  label: "Dracula",
  mode: "dark",
  name: "dracula",
  palette: ["#bd93f9", "#ff79c6", "#50fa7b", "#8be9fd"],
};

export const CATPPUCCIN: ThemeDefinition = {
  colors: {
    accent: "#f9e2af",
    background: "#1e1e2e",
    border: "#313244",
    error: "#f38ba8",
    info: "#89dceb",
    muted: "#6c7086",
    primary: "#89b4fa",
    secondary: "#cba6f7",
    success: "#a6e3a1",
    text: "#cdd6f4",
    warning: "#fab387",
  },
  label: "Catppuccin Mocha",
  mode: "dark",
  name: "catppuccin",
  palette: ["#cba6f7", "#f38ba8", "#a6e3a1", "#89b4fa"],
};

export const CATPPUCCIN_FRAPPE: ThemeDefinition = {
  colors: {
    accent: "#e5c890",
    background: "#303446",
    border: "#414559",
    error: "#e78284",
    info: "#81c8be",
    muted: "#626880",
    primary: "#8caaee",
    secondary: "#ca9ee6",
    success: "#a6d189",
    text: "#c6d0f5",
    warning: "#ef9f76",
  },
  label: "Catppuccin Frappé",
  mode: "dark",
  name: "catppuccin-frappe",
  palette: ["#ca9ee6", "#e78284", "#a6d189", "#8caaee"],
};

export const CATPPUCCIN_MACCHIATO: ThemeDefinition = {
  colors: {
    accent: "#eed49f",
    background: "#24273a",
    border: "#363a4f",
    error: "#ed8796",
    info: "#8bd5ca",
    muted: "#5b6078",
    primary: "#8aadf4",
    secondary: "#c6a0f6",
    success: "#a6da95",
    text: "#cad3f8",
    warning: "#f5a97f",
  },
  label: "Catppuccin Macchiato",
  mode: "dark",
  name: "catppuccin-macchiato",
  palette: ["#c6a0f6", "#ed8796", "#a6da95", "#8aadf4"],
};

export const GRUVBOX: ThemeDefinition = {
  colors: {
    accent: "#fabd2f",
    background: "#282828",
    border: "#3c3836",
    error: "#fb4934",
    info: "#83a598",
    muted: "#665c54",
    primary: "#83a598",
    secondary: "#d3869b",
    success: "#b8bb26",
    text: "#ebdbb2",
    warning: "#fe8019",
  },
  label: "Gruvbox",
  mode: "dark",
  name: "gruvbox",
  palette: ["#fe8019", "#fabd2f", "#b8bb26", "#83a598"],
};

export const TOKYONIGHT: ThemeDefinition = {
  colors: {
    accent: "#e0af68",
    background: "#1a1b26",
    border: "#292e42",
    error: "#f7768e",
    info: "#7dcfff",
    muted: "#565f89",
    primary: "#7aa2f7",
    secondary: "#bb9af7",
    success: "#9ece6a",
    text: "#c0caf5",
    warning: "#ff9e64",
  },
  label: "Tokyo Night",
  mode: "dark",
  name: "tokyonight",
  palette: ["#7aa2f7", "#bb9af7", "#7dcfff", "#9ece6a"],
};

export const NORD: ThemeDefinition = {
  colors: {
    accent: "#ebcb8b",
    background: "#2e3440",
    border: "#3b4252",
    error: "#bf616a",
    info: "#81a1c1",
    muted: "#4c566a",
    primary: "#88c0d0",
    secondary: "#b48ead",
    success: "#a3be8c",
    text: "#d8dee9",
    warning: "#d08770",
  },
  label: "Nord",
  mode: "dark",
  name: "nord",
  palette: ["#88c0d0", "#81a1c1", "#a3be8c", "#b48ead"],
};

export const MONOKAI: ThemeDefinition = {
  colors: {
    accent: "#e6db74",
    background: "#272822",
    border: "#3e3d32",
    error: "#f92672",
    info: "#66d9ef",
    muted: "#75715e",
    primary: "#66d9ef",
    secondary: "#ae81ff",
    success: "#a6e22e",
    text: "#f8f8f2",
    warning: "#fd971f",
  },
  label: "Monokai",
  mode: "dark",
  name: "monokai",
  palette: ["#f92672", "#e6db74", "#a6e22e", "#66d9ef"],
};

export const MATERIAL: ThemeDefinition = {
  colors: {
    accent: "#ffcb6b",
    background: "#263238",
    border: "#37474f",
    error: "#ff5370",
    info: "#89ddff",
    muted: "#546e7a",
    primary: "#82aaff",
    secondary: "#c792ea",
    success: "#c3e88d",
    text: "#eeffff",
    warning: "#ffcb6b",
  },
  label: "Material",
  mode: "dark",
  name: "material",
  palette: ["#82aaff", "#c792ea", "#c3e88d", "#ffcb6b"],
};

export const AYU: ThemeDefinition = {
  colors: {
    accent: "#e6b450",
    background: "#0a0e14",
    border: "#1a1f29",
    error: "#f26d78",
    info: "#39bae6",
    muted: "#626a73",
    primary: "#39bae6",
    secondary: "#f29668",
    success: "#7fd962",
    text: "#b3b1ad",
    warning: "#ff9940",
  },
  label: "Ayu Dark",
  mode: "dark",
  name: "ayu",
  palette: ["#ff9940", "#e6b450", "#c2d94c", "#39bae6"],
};

export const EVERFOREST: ThemeDefinition = {
  colors: {
    accent: "#dbbc7f",
    background: "#2d353b",
    border: "#404c51",
    error: "#e67e80",
    info: "#7fbbb3",
    muted: "#5c6a72",
    primary: "#a7c080",
    secondary: "#d699b6",
    success: "#a7c080",
    text: "#d3c6aa",
    warning: "#e69875",
  },
  label: "Everforest",
  mode: "dark",
  name: "everforest",
  palette: ["#a7c080", "#dbbc7f", "#e69875", "#d699b6"],
};

export const KANAGAWA: ThemeDefinition = {
  colors: {
    accent: "#e6c384",
    background: "#1f1f28",
    border: "#2a2a37",
    error: "#c34043",
    info: "#7aa89f",
    muted: "#54546d",
    primary: "#7e9cd8",
    secondary: "#957fb8",
    success: "#76946a",
    text: "#dcd7ba",
    warning: "#e6c384",
  },
  label: "Kanagawa",
  mode: "dark",
  name: "kanagawa",
  palette: ["#7e9cd8", "#957fb8", "#7aa89f", "#e6c384"],
};

export const NIGHTOWL: ThemeDefinition = {
  colors: {
    accent: "#ffcb6b",
    background: "#011627",
    border: "#1d3b53",
    error: "#ff5370",
    info: "#82aaff",
    muted: "#676e95",
    primary: "#82aaff",
    secondary: "#c792ea",
    success: "#addb67",
    text: "#d6deeb",
    warning: "#f78c6c",
  },
  label: "Night Owl",
  mode: "dark",
  name: "nightowl",
  palette: ["#82aaff", "#c792ea", "#addb67", "#f78c6c"],
};

export const SYNTHWAVE84: ThemeDefinition = {
  colors: {
    accent: "#ff7edb",
    background: "#1a1c23",
    border: "#2a2d3a",
    error: "#fe4450",
    info: "#36f9f6",
    muted: "#495495",
    primary: "#36f9f6",
    secondary: "#f92aad",
    success: "#39ff9c",
    text: "#e0d0e8",
    warning: "#ff8b39",
  },
  label: "Synthwave 84",
  mode: "dark",
  name: "synthwave84",
  palette: ["#f92aad", "#ff7edb", "#36f9f6", "#7b2fbe"],
};

export const COBALT2: ThemeDefinition = {
  colors: {
    accent: "#ffc600",
    background: "#193549",
    border: "#1f4662",
    error: "#ff0000",
    info: "#0088ff",
    muted: "#666666",
    primary: "#0088ff",
    secondary: "#ff628c",
    success: "#3ad900",
    text: "#ffffff",
    warning: "#ff9f00",
  },
  label: "Cobalt2",
  mode: "dark",
  name: "cobalt2",
  palette: ["#ffc600", "#0088ff", "#ff628c", "#9effff"],
};

export const PALENIGHT: ThemeDefinition = {
  colors: {
    accent: "#ffcb6b",
    background: "#292d3e",
    border: "#3a3f58",
    error: "#ff5370",
    info: "#89ddff",
    muted: "#676e95",
    primary: "#82aaff",
    secondary: "#c792ea",
    success: "#c3e88d",
    text: "#bfc7d5",
    warning: "#ffcb6b",
  },
  label: "Pale Night",
  mode: "dark",
  name: "palenight",
  palette: ["#82aaff", "#c792ea", "#c3e88d", "#ffcb6b"],
};

export const ROSEPINE: ThemeDefinition = {
  colors: {
    accent: "#f6c177",
    background: "#191724",
    border: "#26233a",
    error: "#eb6f92",
    info: "#9ccfd8",
    muted: "#6e6a86",
    primary: "#c4a7e7",
    secondary: "#ebbcba",
    success: "#31748f",
    text: "#e0def4",
    warning: "#f6c177",
  },
  label: "Rosé Pine",
  mode: "dark",
  name: "rosepine",
  palette: ["#c4a7e7", "#ebbcba", "#f6c177", "#9ccfd8"],
};

export const VESPER: ThemeDefinition = {
  colors: {
    accent: "#a6b6ce",
    background: "#101010",
    border: "#1a1a1a",
    error: "#c6797e",
    info: "#8a9bae",
    muted: "#646973",
    primary: "#c8b894",
    secondary: "#8a9bae",
    success: "#8aa6c1",
    text: "#d4d4d4",
    warning: "#c6797e",
  },
  label: "Vesper",
  mode: "dark",
  name: "vesper",
  palette: ["#c8b894", "#8a9bae", "#a6b6ce", "#d4d4d4"],
};

export const ZENBURN: ThemeDefinition = {
  colors: {
    accent: "#f0dfaf",
    background: "#3f3f3f",
    border: "#4f4f4f",
    error: "#cc9393",
    info: "#8cd0d3",
    muted: "#5f5f5f",
    primary: "#8cd0d3",
    secondary: "#dc8cc3",
    success: "#7f9f7f",
    text: "#dcdccc",
    warning: "#f0dfaf",
  },
  label: "Zenburn",
  mode: "dark",
  name: "zenburn",
  palette: ["#f0dfaf", "#8cd0d3", "#cc9393", "#7f9f7f"],
};

export const CARBONFOX: ThemeDefinition = {
  colors: {
    accent: "#e2b714",
    background: "#161616",
    border: "#252525",
    error: "#ee5396",
    info: "#78a9ff",
    muted: "#6b6b6b",
    primary: "#7eb6e2",
    secondary: "#b4b49c",
    success: "#7eb6e2",
    text: "#c1c1c1",
    warning: "#e2b714",
  },
  label: "Carbonfox",
  mode: "dark",
  name: "carbonfox",
  palette: ["#7eb6e2", "#b4b49c", "#a0c0d2", "#c1c1c1"],
};

export const MATRIX: ThemeDefinition = {
  colors: {
    accent: "#00ff41",
    background: "#0d0208",
    border: "#003b00",
    error: "#ff0000",
    info: "#008f11",
    muted: "#003b00",
    primary: "#00ff41",
    secondary: "#008f11",
    success: "#00ff41",
    text: "#00ff41",
    warning: "#ffff00",
  },
  label: "Matrix",
  mode: "dark",
  name: "matrix",
  palette: ["#00ff41", "#008f11", "#003b00", "#00ff41"],
};

export const VERCEL: ThemeDefinition = {
  colors: {
    accent: "#f81ce5",
    background: "#000000",
    border: "#222222",
    error: "#ee0000",
    info: "#50e3c2",
    muted: "#666666",
    primary: "#0070f3",
    secondary: "#7928ca",
    success: "#0070f3",
    text: "#ededed",
    warning: "#f5a623",
  },
  label: "Vercel",
  mode: "dark",
  name: "vercel",
  palette: ["#ffffff", "#888888", "#333333", "#0070f3"],
};

export const ORNG: ThemeDefinition = {
  colors: {
    accent: "#ffcc88",
    background: "#1a1a1a",
    border: "#333333",
    error: "#ff3333",
    info: "#ff9944",
    muted: "#555555",
    primary: "#ff6600",
    secondary: "#ff9944",
    success: "#33cc33",
    text: "#eeeeee",
    warning: "#ffcc00",
  },
  label: "Orng",
  mode: "dark",
  name: "orng",
  palette: ["#ff6600", "#ff9944", "#ffcc88", "#1a1a1a"],
};

export const AURA: ThemeDefinition = {
  colors: {
    accent: "#ffca85",
    background: "#0d0d16",
    border: "#1a1a2e",
    error: "#ff6767",
    info: "#61ffca",
    muted: "#4d4d4d",
    primary: "#a277ff",
    secondary: "#ff6767",
    success: "#61ffca",
    text: "#edecee",
    warning: "#ffca85",
  },
  label: "Aura",
  mode: "dark",
  name: "aura",
  palette: ["#a277ff", "#61ffca", "#ffca85", "#ff6767"],
};

export const OSAKA_JADE: ThemeDefinition = {
  colors: {
    accent: "#b8d4e3",
    background: "#0a1929",
    border: "#1a3a4a",
    error: "#e74c3c",
    info: "#00d4aa",
    muted: "#4a6272",
    primary: "#00a878",
    secondary: "#00d4aa",
    success: "#00a878",
    text: "#c8d6e5",
    warning: "#f39c12",
  },
  label: "Osaka Jade",
  mode: "dark",
  name: "osaka-jade",
  palette: ["#00a878", "#00d4aa", "#b8d4e3", "#1a1a2e"],
};

export const MERCURY: ThemeDefinition = {
  colors: {
    accent: "#e0e0e0",
    background: "#1a1a1a",
    border: "#333333",
    error: "#ff4444",
    info: "#c0c0c0",
    muted: "#505050",
    primary: "#c0c0c0",
    secondary: "#808080",
    success: "#44ff44",
    text: "#d0d0d0",
    warning: "#ffaa00",
  },
  label: "Mercury",
  mode: "dark",
  name: "mercury",
  palette: ["#c0c0c0", "#808080", "#e0e0e0", "#404040"],
};

export const CURSOR_THEME: ThemeDefinition = {
  colors: {
    accent: "#ecc48d",
    background: "#1e1e2e",
    border: "#5c6370",
    error: "#ef6b73",
    info: "#6c9eff",
    muted: "#8b93a3",
    primary: "#6c9eff",
    secondary: "#c792ea",
    success: "#7fdbca",
    text: "#d8dee9",
    warning: "#e4b781",
  },
  label: "Cursor",
  mode: "dark",
  name: "cursor",
  palette: ["#6c9eff", "#c792ea", "#7fdbca", "#ecc48d"],
};

export const LUCENT_ORNG: ThemeDefinition = {
  colors: {
    accent: "#ffcc99",
    background: "#110800",
    border: "#221100",
    error: "#ff4444",
    info: "#ff8844",
    muted: "#443322",
    primary: "#ff8844",
    secondary: "#ffaa66",
    success: "#88cc44",
    text: "#eeddcc",
    warning: "#ffcc44",
  },
  label: "Lucent Orng",
  mode: "dark",
  name: "lucent-orng",
  palette: ["#ff8844", "#ffaa66", "#332211", "#ffcc99"],
};

export const FLEXOKI: ThemeDefinition = {
  colors: {
    accent: "#d0a215",
    background: "#282726",
    border: "#403e3c",
    error: "#d14d41",
    info: "#4385be",
    muted: "#575653",
    primary: "#4385be",
    secondary: "#ce5d97",
    success: "#879a39",
    text: "#cecdc3",
    warning: "#da702c",
  },
  label: "Flexoki",
  mode: "dark",
  name: "flexoki",
  palette: ["#d14d41", "#da702c", "#879a39", "#4385be"],
};

export const OPENCODE: ThemeDefinition = {
  colors: {
    accent: "#9d7cd8",
    background: "#0a0a0a",
    border: "#484848",
    error: "#e06c75",
    info: "#56b6c2",
    muted: "#808080",
    primary: "#fab283",
    secondary: "#5c9cf5",
    success: "#7fd88f",
    text: "#eeeeee",
    warning: "#f5a742",
  },
  extendedColors: OPENCODE_DARK_EXTENDED,
  label: "OpenCode",
  lightColors: {
    accent: "#d68c27",
    background: "#ffffff",
    border: "#b8b8b8",
    error: "#d1383d",
    info: "#318795",
    muted: "#8a8a8a",
    primary: "#3b7dd8",
    secondary: "#7b5bb6",
    success: "#3d9a57",
    text: "#1a1a1a",
    warning: "#d68c27",
  },
  lightExtendedColors: OPENCODE_LIGHT_EXTENDED,
  mode: "dark",
  name: "opencode",
  palette: ["#fab283", "#5c9cf5", "#7fd88f", "#e06c75"],
};
