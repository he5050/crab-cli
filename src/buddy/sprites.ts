/**
 * Buddy/Pet 宠物伴侣系统 — ASCII 精灵数据
 *
 */

import type { CompanionBones, Eye, Hat, Species } from "./types";
import {
  axolotl,
  blob,
  basketball,
  cactus,
  capybara,
  cat,
  chicken,
  chonk,
  dragon,
  duck,
  fox,
  ghost,
  goose,
  hamster,
  laptop,
  moon,
  cloud,
  lantern,
  treasure,
  book,
  star,
  coffee,
  snowman,
  mushroom,
  octopus,
  owl,
  panda,
  penguin,
  rabbit,
  raccoon,
  robot,
  snail,
  turtle,
  unicorn,
  whale,
  teapot,
  rocket,
} from "./types";

// ─── 物种颜色映射 ─────────────────────────────────────────────

export function speciesColor(species: Species): string {
  switch (species) {
    case duck:
    case chicken:
      return "yellow";
    case goose:
    case ghost:
    case rabbit:
    case snowman:
      return "white";
    case blob:
    case octopus:
    case axolotl:
    case unicorn:
      return "magenta";
    case cat:
    case capybara:
    case hamster:
    case chonk:
      return "yellowBright";
    case dragon:
    case turtle:
    case cactus:
      return "green";
    case owl:
    case snail:
    case mushroom:
    case raccoon:
      return "gray";
    case penguin:
    case panda:
      return "whiteBright";
    case robot:
    case laptop:
      return "cyan";
    case fox:
      return "red";
    case whale:
      return "blue";
    case teapot:
    case treasure:
    case book:
    case coffee:
    case basketball:
      return "yellow";
    case rocket:
    case moon:
      return "whiteBright";
    case cloud:
      return "cyanBright";
    case lantern:
    case star:
      return "yellowBright";
  }
}

// ─── 精灵身体（30 物种 × 3 帧） ───────────────────────────────

const BODIES: Record<Species, string[][]> = {
  [duck]: [
    ["            ", "    __      ", "  <({E} )___  ", "   (  ._>   ", "    `--´    "],
    ["            ", "    __      ", "  <({E} )___  ", "   (  ._>   ", "    `--´~   "],
    ["            ", "    __      ", "  <({E} )___  ", "   (  .__>  ", "    `--´    "],
  ],
  [goose]: [
    ["            ", "     ({E}>    ", "     ||     ", "   _(__)_   ", "    ^^^^    "],
    ["            ", "    ({E}>     ", "     ||     ", "   _(__)_   ", "    ^^^^    "],
    ["            ", "     ({E}>>   ", "     ||     ", "   _(__)_   ", "    ^^^^    "],
  ],
  [chicken]: [
    ["            ", "    __      ", "  _({E})>    ", "  (  v )    ", "   ^^ ^^    "],
    ["            ", "    __      ", "  _({E})>    ", "  (  V )    ", "   ^^ ^^    "],
    ["    ,       ", "    __      ", "  _({E})>>   ", "  (  v )    ", "   ^^ ^^    "],
  ],
  [blob]: [
    ["            ", "   .----.   ", "  ( {E}  {E} )  ", "  (      )  ", "   `----´   "],
    ["            ", "  .------.  ", " (  {E}  {E}  ) ", " (        ) ", "  `------´  "],
    ["            ", "    .--.    ", "   ({E}  {E})   ", "   (    )   ", "    `--´    "],
  ],
  [cat]: [
    ["            ", String.raw`   /\_/\    `, "  ( {E}   {E})  ", "  (  ω  )   ", '  (")_(")   '],
    ["            ", String.raw`   /\_/\    `, "  ( {E}   {E})  ", "  (  ω  )   ", '  (")_(")~  '],
    ["            ", String.raw`   /\-/\    `, "  ( {E}   {E})  ", "  (  ω  )   ", '  (")_(")   '],
  ],
  [dragon]: [
    ["            ", String.raw`  /^\  /^\  `, " <  {E}  {E}  > ", " (   ~~   ) ", "  `-vvvv-´  "],
    ["            ", String.raw`  /^\  /^\  `, " <  {E}  {E}  > ", " (        ) ", "  `-vvvv-´  "],
    ["   ~    ~   ", String.raw`  /^\  /^\  `, " <  {E}  {E}  > ", " (   ~~   ) ", "  `-vvvv-´  "],
  ],
  [octopus]: [
    ["            ", "   .----.   ", "  ( {E}  {E} )  ", "  (______)  ", String.raw`  /\/\/\/\  `],
    ["            ", "   .----.   ", "  ( {E}  {E} )  ", "  (______)  ", String.raw`  \/\/\/\/  `],
    ["     o      ", "   .----.   ", "  ( {E}  {E} )  ", "  (______)  ", String.raw`  /\/\/\/\  `],
  ],
  [owl]: [
    ["            ", String.raw`   /\  /\   `, "  (({E})({E}))  ", "  (  ><  )  ", "   `----´   "],
    ["            ", String.raw`   /\  /\   `, "  (({E})({E}))  ", "  (  ><  )  ", "   .----.   "],
    ["            ", String.raw`   /\  /\   `, "  (({E})(-))  ", "  (  ><  )  ", "   `----´   "],
  ],
  [penguin]: [
    ["            ", "  .---.     ", "  ({E}>{E})     ", String.raw` /(   )\    `, "  `---´     "],
    ["            ", "  .---.     ", "  ({E}>{E})     ", " |(   )|    ", "  `---´     "],
    ["  .---.     ", "  ({E}>{E})     ", String.raw` /(   )\    `, "  `---´     ", "   ~ ~      "],
  ],
  [turtle]: [
    ["            ", "   _,--._   ", "  ( {E}  {E} )  ", String.raw` /[______]\ `, "  ``    ``  "],
    ["            ", "   _,--._   ", "  ( {E}  {E} )  ", String.raw` /[______]\ `, "   ``  ``   "],
    ["            ", "   _,--._   ", "  ( {E}  {E} )  ", String.raw` /[======]\ `, "  ``    ``  "],
  ],
  [snail]: [
    ["            ", " {E}    .--.  ", String.raw`  \  ( @ )  `, "   \\_`--´   ", "  ~~~~~~~   "],
    ["            ", "  {E}   .--.  ", "  |  ( @ )  ", "   \\_`--´   ", "  ~~~~~~~   "],
    ["            ", " {E}    .--.  ", String.raw`  \  ( @  ) `, "   \\_`--´   ", "   ~~~~~~   "],
  ],
  [ghost]: [
    ["            ", "   .----.   ", String.raw`  / {E}  {E} \  `, "  |      |  ", "  ~`~``~`~  "],
    ["            ", "   .----.   ", String.raw`  / {E}  {E} \  `, "  |      |  ", "  `~`~~`~`  "],
    ["    ~  ~    ", "   .----.   ", String.raw`  / {E}  {E} \  `, "  |      |  ", "  ~~`~~`~~  "],
  ],
  [axolotl]: [
    ["            ", "}~(______)~{", "  }~({E} .. {E})~{", "  ( .--. )  ", String.raw`  (_/  \_)  `],
    ["            ", "~}(______){~", "  ~}({E} .. {E}){~", "  ( .--. )  ", String.raw`  (_/  \_)  `],
    ["            ", "}~(______)~{", "  }~({E} .. {E})~{", "  (  --  )  ", String.raw`  ~_/  \_~  `],
  ],
  [capybara]: [
    ["            ", "  n______n  ", " ( {E}    {E} ) ", " (   oo   ) ", "  `------´  "],
    ["            ", "  n______n  ", " ( {E}    {E} ) ", " (   Oo   ) ", "  `------´  "],
    ["    ~  ~    ", "  u______n  ", " ( {E}    {E} ) ", " (   oo   ) ", "  `------´  "],
  ],
  [cactus]: [
    ["            ", " n  ____  n ", " | |{E}  {E}| | ", " |_|    |_| ", "   |    |   "],
    ["            ", "    ____    ", " n |{E}  {E}| n ", " |_|    |_| ", "   |    |   "],
    [" n        n ", " |  ____  | ", " | |{E}  {E}| | ", " |_|    |_| ", "   |    |   "],
  ],
  [basketball]: [
    ["            ", "   .----.   ", String.raw`  /{E} || {E}\  `, " |---++---| ", String.raw`  \_ || _/  `],
    ["            ", "   .----.   ", String.raw`  /{E} /\ {E}\  `, " |--<  >--| ", String.raw`  \_/\_/  `],
    ["    dunk    ", "   .----.   ", String.raw`  /{E} || {E}\  `, " |---++---| ", String.raw`  \_ || _/  `],
  ],
  [robot]: [
    ["            ", "   .[||].   ", "  [ {E}  {E} ]  ", "  [ ==== ]  ", "  `------´  "],
    ["            ", "   .[||].   ", "  [ {E}  {E} ]  ", "  [ -==- ]  ", "  `------´  "],
    ["     *      ", "   .[||].   ", "  [ {E}  {E} ]  ", "  [ ==== ]  ", "  `------´  "],
  ],
  [rabbit]: [
    ["            ", String.raw`   (\__/)   `, "  ( {E}  {E} )  ", " =(  ..  )= ", '  (")__(")  '],
    ["            ", "   (|__/)   ", "  ( {E}  {E} )  ", " =(  ..  )= ", '  (")__(")  '],
    ["            ", String.raw`   (\__/)   `, "  ( {E}  {E} )  ", " =( .  . )= ", '  (")__(")  '],
  ],
  [mushroom]: [
    ["            ", " .-o-OO-o-. ", "(__________)", "   |{E}  {E}|   ", "   |____|   "],
    ["            ", " .-O-oo-O-. ", "(__________)", "   |{E}  {E}|   ", "   |____|   "],
    ["   . o  .   ", " .-o-OO-o-. ", "(__________)", "   |{E}  {E}|   ", "   |____|   "],
  ],
  [chonk]: [
    ["            ", String.raw`  /\    /\  `, " ( {E}    {E} ) ", " (   ..   ) ", "  `------´  "],
    ["            ", String.raw`  /\    /|  `, " ( {E}    {E} ) ", " (   ..   ) ", "  `------´  "],
    ["            ", String.raw`  /\    /\  `, " ( {E}    {E} ) ", " (   ..   ) ", "  `------´~ "],
  ],
  [fox]: [
    ["            ", String.raw`  /\___/\  `, " ( {E}   {E} ) ", " (  ==v== ) ", "  `-uu-u´~ "],
    ["            ", String.raw`  /\___/|  `, " ( {E}   {E} ) ", " (  ==v== ) ", " ~`-uu-u´  "],
    ["   *        ", String.raw`  /\___/\  `, " ( {E}   {E} ) ", " (  ==^== ) ", "  `-uu-u´~ "],
  ],
  [panda]: [
    ["            ", "  .-.__.-.  ", " (o {E} {E} o) ", " (   __   ) ", "  `-(__)-´  "],
    ["            ", "  .-.__.-.  ", " (O {E} {E} o) ", " (   __   ) ", "  `-(__)-´  "],
    ["            ", "  .-.__.-.  ", " (o {E} {E} O) ", " (  ____  ) ", "  `-(__)-´  "],
  ],
  [raccoon]: [
    ["            ", String.raw`  /\_M_/\  `, " (#{E} {E}#) ", " (  .--.  ) ", "  `-m--m´~ "],
    ["            ", String.raw`  /\_W_/\  `, " (#{E} {E}#) ", " (  .--.  ) ", " ~`-m--m´  "],
    ["   .  .     ", String.raw`  /\_M_/\  `, " (#{E} {E}#) ", " (  ----  ) ", "  `-m--m´~ "],
  ],
  [unicorn]: [
    [String.raw`    /\      `, String.raw`  /\__/\   `, " ( {E}  {E} )  ", " (  ~~~  ) ", "  `-vvv-´  "],
    ["    //      ", String.raw`  /\__/\   `, " ( {E}  {E} )  ", " (  ~~~  ) ", "  `-v-v-´  "],
    [String.raw`  . /\ .    `, String.raw`  /\__/\   `, " ( {E}  {E} )  ", " (  ***  ) ", "  `-vvv-´  "],
  ],
  [whale]: [
    ["     __     ", String.raw`  __/  \__  `, String.raw` / {E}    {E} \ `, String.raw` \__    __/ `, "    `~~´    "],
    ["   . __ .   ", String.raw`  __/  \__  `, String.raw` / {E}    {E} \ `, String.raw` \__    __/ `, "    `~~´    "],
    ["    __  o   ", String.raw`  __/  \__  `, String.raw` / {E}    {E} \ `, String.raw` \__~~~~__/ `, "    `~~´    "],
  ],
  [hamster]: [
    ["            ", String.raw`  (\___/)  `, " ( {E}   {E} ) ", " (  >oo<  ) ", "  `-(__)-´ "],
    ["            ", String.raw`  (\___/)  `, " ( {E}   {E} ) ", " (  >OO<  ) ", "  `-(__)-´ "],
    ["   crumbs   ", String.raw`  (\___/)  `, " ( {E}   {E} ) ", " (  >.. < ) ", "  `-(__)-´ "],
  ],
  [teapot]: [
    ["    ___     ", "   (___)    ", String.raw`  / {E} {E}\__ `, " (   ~~  _ )", "  `-____-´  "],
    ["     ~      ", "   (___)    ", String.raw`  / {E} {E}\__ `, " (   ~~  _ )", "  `-____-´  "],
    ["   ~   ~    ", "   (___)    ", String.raw`  / {E} {E}\__ `, " (   ..  _ )", "  `-____-´  "],
  ],
  [rocket]: [
    [String.raw`     /\     `, String.raw`    /  \    `, "   |{E}{E}|   ", "   |____|   ", String.raw`    //\    `],
    [String.raw`     /\     `, String.raw`    /  \    `, "   |{E}{E}|   ", "   |____|   ", String.raw`    /^^\    `],
    [String.raw`     /\     `, String.raw`    /  \    `, "   |{E}{E}|   ", "   |____|   ", "    *  *    "],
  ],
  [laptop]: [
    ["            ", "  .------.  ", "  | {E}{E} |  ", "  |  __  |  ", "  `-====-´  "],
    ["            ", "  .------.  ", "  | {E}{E} |  ", "  |  --  |  ", "  `-====-´  "],
    ["    ping    ", "  .------.  ", "  | {E}{E} |  ", "  |  <>  | ", "  `-====-´  "],
  ],
  [moon]: [
    ["            ", "   .----.   ", "  / {E} {E})   ", " (   ..  )  ", "  `----´   "],
    ["      *     ", "   .----.   ", "  / {E} {E})   ", " (   oo  )  ", "  `----´   "],
    ["   *        ", "   .----.   ", "  / {E} -)   ", " (   ..  )  ", "  `----´   "],
  ],
  [cloud]: [
    ["            ", "   .--.     ", " .({E} {E}).  ", "(        ) ", " `------´  "],
    ["            ", "  .----.    ", " ({E}  {E}).. ", "(        ) ", " `------´  "],
    ["   drip     ", "   .--.     ", " .({E} {E}).  ", "(        ) ", "  `----´   "],
  ],
  [lantern]: [
    ["    __      ", "   [__]     ", String.raw`  /{E} {E}\    `, "  |  **|    ", "  `----´    "],
    ["    __      ", "   [__]     ", String.raw`  /{E} {E}\    `, "  |  ++|    ", "  `----´    "],
    ["   glow     ", "   [__]     ", String.raw`  /{E} {E}\    `, "  |  **|    ", "  `----´    "],
  ],
  [treasure]: [
    ["            ", "  .------.  ", String.raw` / {E}  {E}\ `, " |  $$$ |  ", " `-====-´  "],
    ["    *       ", "  .------.  ", String.raw` / {E}  {E}\ `, " |  $$$ |  ", " `-====-´  "],
    ["       *    ", "  .------.  ", String.raw` / {E}  {E}\ `, " |  ### |  ", " `-====-´  "],
  ],
  [book]: [
    ["            ", "  ________  ", " / {E}  {E}/| ", "|  lines | ", "|_______|/ "],
    ["            ", "  ________  ", " / {E}  {E}/| ", "|  notes | ", "|_______|/ "],
    ["   flip     ", "  ________  ", " / {E}  -/| ", "|  notes | ", "|_______|/ "],
  ],
  [star]: [
    [String.raw`     /\     `, String.raw`  --/  \--  `, "   > {E}{E} <   ", String.raw`  --\__/--  `, "     /     "],
    [String.raw`   . /\ .   `, String.raw`  --/  \--  `, "   > {E}{E} <   ", String.raw`  --\__/--  `, "     /     "],
    [String.raw`     /\     `, String.raw`  --/  \--  `, "   > {E}- <   ", String.raw`  --\__/--  `, "   . / .   "],
  ],
  [coffee]: [
    ["     ~~     ", "   .----.   ", "  | {E}{E} |__", "  |  __  |  )", "  `------´  "],
    ["    ~  ~    ", "   .----.   ", "  | {E}{E} |__", "  |  --  |  )", "  `------´  "],
    ["   zzz      ", "   .----.   ", "  | -{E} |__", "  |  __  |  )", "  `------´  "],
  ],
  [snowman]: [
    ["    _i_     ", "   ({E} {E})    ", "   ( : )    ", "  (  :  )   ", "   `---´    "],
    ["    _i_     ", "   ({E} {E})    ", "   ( - )    ", "  (  :  )   ", "   `---´    "],
    ["   snow     ", "   ({E} -)    ", "   ( : )    ", "  (  :  )   ", "   `---´    "],
  ],
};

// ─── 帽子 ──────────────────────────────────────────────────

const HAT_LINES: Record<Hat, string> = {
  none: "",
  crown: "   \\^^^/    ",
  tophat: "   [___]    ",
  propeller: "    -+-     ",
  halo: "   (   )    ",
  wizard: "    /^\\     ",
  beanie: "   (___)    ",
  tinyduck: "    ,>      ",
  pirate: "   /###\\    ",
  flower: "   .-o-.    ",
  bucket: "   [___)    ",
  party: "    /!\\     ",
  visor: "   =====    ",
};

// ─── 抚摸台词 ──────────────────────────────────────────────

const PET_LINES: Record<Species, string[]> = {
  [duck]: ["  scritch  ", "  wing wig ", "  tail wag "],
  [goose]: [" neck rub  ", "  honk hum ", "  feather  "],
  [chicken]: ["  comb pat ", "  wing flap", "  peck hop "],
  [blob]: ["  squish   ", "  wobble   ", "  jiggle   "],
  [cat]: ["  chin rub ", "  purr purr", "  tail curl"],
  [dragon]: ["  scale rub", " smoke puff", "  wing hum "],
  [octopus]: [" tentacle  ", "  bubble   ", "  soft pat "],
  [owl]: ["  head pat ", "  feather  ", "  blink hoot"],
  [penguin]: ["  belly pat", "  flipper  ", "  slide hop"],
  [turtle]: [" shell rub ", "  slow nod ", "  tiny step"],
  [snail]: [" shell buff", " feeler wig", "  slime hop"],
  [ghost]: ["  spooky pat", "  soft boo ", "  drift hug"],
  [axolotl]: ["  gill rub ", "  water wig", "  happy gill"],
  [capybara]: ["  cozy rub ", "  nose boop", "  chill hum"],
  [cactus]: ["  safe pat ", " flower nod", "  prickly ok"],
  [basketball]: ["  spin pat ", "  bounce   ", "  swish    "],
  [robot]: ["  tune up  ", "  beep purr", "  gear hum "],
  [rabbit]: ["  ear rub  ", "  nose wig ", "  hop hop  "],
  [mushroom]: [" cap brush ", "  spore puff", "  damp hum "],
  [chonk]: [" belly rub ", "  chonk hum", "  loaf wig "],
  [fox]: ["  ear scritch", "  tail swish", "  sly purr "],
  [panda]: ["  bamboo pat", "  paw wave ", "  munch hum"],
  [raccoon]: [" mask rub  ", "  paw grab ", "  trash joy"],
  [unicorn]: [" mane brush", "  horn glow", "  prance   "],
  [whale]: ["  wave pat ", "  splash   ", "  whale hum"],
  [hamster]: ["  cheek rub", "  tiny paws", "  wheel hop"],
  [teapot]: ["  lid pat  ", "  steam hum", "  warm sip "],
  [rocket]: ["  fin polish", "  boost hum", "  spark puff"],
  [laptop]: [" key taps  ", "  fan purr ", "  screen glow"],
  [moon]: ["  moon rub ", "  crater pat", "  tide hum "],
  [cloud]: ["  fluff pat", "  mist puff", "  floaty   "],
  [lantern]: [" glass wipe", "  warm glow", "  wick hum "],
  [treasure]: [" coin shine", " latch pat", "  gem blink"],
  [book]: [" page brush", "  spine pat", "  quiet hum "],
  [star]: ["  star polish", "  twinkle  ", "  comet hop"],
  [coffee]: [" mug warm  ", "  steam pat", "  cozy sip "],
  [snowman]: ["  snow pat ", "  scarf tug", "  chilly hum"],
};

// ─── 睡眠帧 ──────────────────────────────────────────────

const SLEEP_ZZZ_FRAMES = ["  z   ", " Zz   ", " Zzz  ", "Zzzz  "];
const SLEEP_BREATH_FRAMES = [0, 0, 1, 1];

function sleepBodyFrame(frame: number): number {
  return SLEEP_BREATH_FRAMES[frame % SLEEP_BREATH_FRAMES.length] ?? 0;
}

function sleepZzzLine(frame: number, width: number): string {
  const zzz = SLEEP_ZZZ_FRAMES[frame % SLEEP_ZZZ_FRAMES.length] ?? "  z   ";
  return zzz
    .padStart(Math.floor((width + zzz.length) / 2), " ")
    .padEnd(width, " ")
    .slice(0, width);
}

// ─── 渲染函数 ──────────────────────────────────────────────

function spriteFramesFor(species: Species): string[][] {
  return (BODIES as Partial<Record<Species, string[][]>>)[species] ?? BODIES[duck];
}

function petLinesFor(species: Species): string[] {
  return (PET_LINES as Partial<Record<Species, string[]>>)[species] ?? PET_LINES[duck];
}

/** 渲染精灵（正常/睡眠/抚摸模式） */
export function renderSprite(bones: CompanionBones, frame = 0, sleeping = false): string[] {
  const frames = spriteFramesFor(bones.species);
  const bodyFrame = sleeping ? sleepBodyFrame(frame) : Math.max(0, frame) % frames.length;
  const eye = sleeping ? "-" : bones.eye;
  const body = frames[bodyFrame]!.map((line) => line.replaceAll("{E}", eye));
  const lines = [...body];
  const hatLine = bones.hat === "none" ? undefined : HAT_LINES[bones.hat];
  if (hatLine && !lines[0]!.trim()) {
    lines[0] = hatLine;
  }
  if (sleeping) {
    const width = lines[0]!.length;
    lines.unshift(sleepZzzLine(frame, width));
  }
  if (!lines[0]!.trim() && frames.every((f) => !f[0]!.trim())) {
    lines.shift();
  }
  return lines;
}

/** 渲染睡眠模式精灵 */
export function renderSleepSprite(bones: CompanionBones, frame = 0): string[] {
  return renderSprite(bones, frame, true);
}

/** 渲染抚摸模式精灵 */
export function renderPetSprite(bones: CompanionBones, frame = 0): string[] {
  const lines = renderSprite(bones, frame);
  const petLines = petLinesFor(bones.species);
  const normalizedFrame = Math.max(0, frame) % petLines.length;
  const petLine = petLines[normalizedFrame]!;
  const targetIndex = Math.max(0, lines.length - 1);
  lines[targetIndex] = petLine;
  return lines;
}

/** 获取物种精灵帧数 */
export function spriteFrameCount(species: Species): number {
  return spriteFramesFor(species).length;
}

/** 渲染 face（窄终端模式） */
export function renderFace(bones: CompanionBones): string {
  const eye: Eye = bones.eye;
  switch (bones.species) {
    case duck:
    case goose:
    case chicken:
      return `(${eye}>`;
    case blob:
      return `(${eye}${eye})`;
    case cat:
      return `=${eye}ω${eye}=`;
    case dragon:
      return `<${eye}~${eye}>`;
    case octopus:
      return `~(${eye}${eye})~`;
    case owl:
      return `(${eye})(${eye})`;
    case penguin:
      return `(${eye}>)`;
    case turtle:
      return `[${eye}_${eye}]`;
    case snail:
      return `${eye}(@)`;
    case ghost:
      return `/${eye}${eye}\\`;
    case axolotl:
      return `}${eye}.${eye}{`;
    case capybara:
      return `(${eye}oo${eye})`;
    case cactus:
      return `|${eye}  ${eye}|`;
    case robot:
      return `[${eye}${eye}]`;
    case rabbit:
      return `(${eye}..${eye})`;
    case mushroom:
      return `|${eye}  ${eye}|`;
    case chonk:
      return `(${eye}.${eye})`;
    case fox:
      return `=${eye}v${eye}=`;
    case panda:
      return `o${eye}_${eye}o`;
    case raccoon:
      return `#${eye}${eye}#`;
    case unicorn:
      return `/${eye}~${eye}`;
    case whale:
      return `/${eye}~~${eye}\\`;
    case hamster:
      return `(${eye}oo${eye})`;
    case teapot:
      return `/${eye}${eye}\\`;
    case rocket:
      return `|${eye}${eye}|`;
    case laptop:
      return `[${eye}${eye}]`;
    case moon:
      return `(${eye}.${eye})`;
    case cloud:
      return `(${eye}${eye})`;
    case lantern:
      return `/${eye}${eye}\\`;
    case treasure:
      return `/${eye}_${eye}\\`;
    case book:
      return `/${eye}${eye}/`;
    case star:
      return `<${eye}${eye}>`;
    case coffee:
      return `|${eye}${eye}|`;
    case basketball:
      return `(${eye}||${eye})`;
    case snowman:
      return `(${eye}_${eye})`;
  }
}

/** 渲染睡眠 face */
export function renderSleepFace(bones: CompanionBones, frame = 0): string {
  const zzz = "z".repeat(1 + (frame % 3));
  return `${renderFace({ ...bones, eye: "-" })} ${zzz}`;
}
