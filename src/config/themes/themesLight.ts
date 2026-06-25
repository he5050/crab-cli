import type { ThemeDefinition } from "../types/themeTypes";

export const ONE_LIGHT: ThemeDefinition = {
  colors: {
    accent: "#b76b01",
    background: "#fafafa",
    border: "#e5e5e6",
    error: "#e45649",
    info: "#4078f2",
    muted: "#a0a1a7",
    primary: "#4078f2",
    secondary: "#a626a4",
    success: "#50a14f",
    text: "#383a42",
    warning: "#986801",
  },
  label: "One Light",
  mode: "light",
  name: "one-light",
  palette: ["#4078f2", "#a626a4", "#50a14f", "#986801"],
};

export const GITHUB_LIGHT: ThemeDefinition = {
  colors: {
    accent: "#e36209",
    background: "#ffffff",
    border: "#e1e4e8",
    error: "#d73a49",
    info: "#005cc5",
    muted: "#6a737d",
    primary: "#005cc5",
    secondary: "#6f42c1",
    success: "#22863a",
    text: "#24292e",
    warning: "#e36209",
  },
  label: "GitHub",
  mode: "light",
  name: "github",
  palette: ["#005cc5", "#6f42c1", "#22863a", "#e36209"],
};

export const SOLARIZED_LIGHT: ThemeDefinition = {
  colors: {
    accent: "#b58900",
    background: "#fdf6e3",
    border: "#eee8d5",
    error: "#dc322f",
    info: "#268bd2",
    muted: "#93a1a1",
    primary: "#268bd2",
    secondary: "#d33682",
    success: "#859900",
    text: "#586e75",
    warning: "#cb4b16",
  },
  label: "Solarized Light",
  mode: "light",
  name: "solarized",
  palette: ["#268bd2", "#d33682", "#859900", "#cb4b16"],
};
