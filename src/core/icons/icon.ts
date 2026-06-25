/**
 * 统一图标源 — 所有 UI 图标/Emoji 必须从这里导出
 *
 * 规则:
 *   1. 所有图标使用 emoji 字符(字符串常量)，确保终端辨识度
 *   2. 状态/等级使用 🟢🟡🔴 色系
 *   3. 禁止在组件中内联硬编码 emoji
 *   4. 语义命名，按类别分组
 */

// ========== 状态指示 ==========

/** 成功 / 已连接 / 已完成 */
export const iconSuccess = "🟢";
/** 失败 / 错误 / 已断开 */
export const iconError = "🔴";
/** 警告 / 中风险 */
export const iconWarning = "🟡";
/** 运行中 / 处理中 / 刷新 */
export const iconRunning = "🔄";
/** 运行中 / 处理中 / 刷新 */
export const iconRunningTwo = "⚙️";
/** 空闲 / 待机 */
export const iconIdle = "⭕";
/** 禁用 / 阻止 */
export const iconDisabled = "🚫";
/** 加载中 */
export const iconLoading = "⏳";
/** 暂停 */
export const iconPause = "⏸️";
/** 排队 / 等待中 */
export const iconQueued = "📥";
/** 阻塞 / 卡住 */
export const iconBlocked = "🛑";
/** 超时 */
export const iconTimeout = "⏰";
/** 跳过 */
export const iconSkipped = "⏭️";
/** 部分完成 */
export const iconPartial = "◐";
/** 未知 / 未定义 */
export const iconUnknown = "❓";

// ========== 通用符号 ==========

/** 勾选标记(列表/选择等非状态用途) */
export const symCheck = "✅";
/** 叉号标记(非状态用途) */
export const symCross = "❌";
/** 警告符号(非状态用途) */
export const symWarn = "⚠️";
/** 实心圆点 */
export const symDot = "⚫";
/** 空心圆圈 */
export const symEmpty = "⚪";
/** 星号/默认标记 */
export const symStar = "🌟";
/** 信息符号 */
export const symInfo = "ℹ️";
/** 问号 / 帮助 */
export const symQuestion = "❓";
/** 感叹号 */
export const symExclaim = "❗";
/** 右箭头 */
export const symArrowRight = "➜";
/** 左箭头 */
export const symArrowLeft = "⬅";
/** 上箭头 */
export const symArrowUp = "⬆";
/** 下箭头 */
export const symArrowDown = "⬇";
/** 双向箭头 */
export const symArrowSwap = "⇄";
/** 加号 */
export const symPlus = "➕";
/** 减号 */
export const symMinus = "➖";

// ========== 苹果键盘符号 ==========

/** Command 键 */
export const keyCmd = "⌘";
/** Option / Alt 键 */
export const keyOption = "⌥";
/** Shift 键 */
export const keyShift = "⇧";
/** Control 键 */
export const keyControl = "⌃";
/** Return / Enter 键 */
export const keyReturn = "⏎";
/** Escape 键 */
export const keyEscape = "⎋";
/** Delete 键 */
export const keyDelete = "⌫";
/** Tab 键 */
export const keyTab = "⇥";
/** 空格键 */
export const keySpace = "␣";

// ========== 导航面板 ==========

/** 文件夹 / 目录 */
export const iconFolder = "📂";
/** 文件 */
export const iconFile = "📃";
/** 搜索 */
export const iconSearch = "🔎";
/** 智能体 / 子代理 */
export const iconAgent = "🤖";
/** MCP / 插件 */
export const iconMcp = "🔌";
/** LSP / 诊断 */
export const iconLsp = "🔦";
/** 任务 */
export const iconTasks = "📋";
/** 技能 */
export const iconSkills = "🏅";
/** 团队 */
export const iconTeam = "👥";
/** IDE */
export const iconIde = "🖥️";
/** 设置 */
export const iconSettings = "⚙️";
/** 主题 */
export const iconTheme = "🎨";
/** 用户 */
export const iconUser = "🧑";
/** 侧边栏 */
export const iconSidebar = "📑";
/** 首页 / 仪表盘 */
export const iconHome = "🏠";
/** 历史 / 时间轴 */
export const iconHistory = "🕘";
/** 收藏 / 书签 */
export const iconBookmark = "🔖";
/** 标签 / 分类 */
export const iconTag = "🏷️";
/** 通知 / 铃铛 */
export const iconBell = "🔔";
/** 消息 / 对话 */
export const iconMessage = "💬";
/** 帮助 / 问号 */
export const iconHelp = "❓";
/** 退出 / 登出 */
export const iconLogout = "🚪";

// ========== 工具操作 ==========

/** 终端 / Shell 执行 */
export const toolBash = "🛠️";
/** 文件读取 */
export const toolRead = "📖";
/** 文件写入 / 编辑 */
export const toolWrite = "📝";
/** 代码搜索 */
export const toolCodeSearch = "🔎";
/** 网络搜索 */
export const toolWebSearch = "🌍";
/** 网页抓取 */
export const toolWebFetch = "📩";
/** Git */
export const toolGit = "🗃️";
/** 智能体调用 */
export const toolSubagent = "🤖";
/** 通用工具 */
export const toolGeneric = "🛠️";
/** 复制 */
export const toolCopy = "📋";
/** 粘贴 */
export const toolPaste = "📌";
/** 剪切 */
export const toolCut = "✂️";
/** 撤销 */
export const toolUndo = "↩️";
/** 重做 */
export const toolRedo = "↪️";
/** 保存 */
export const toolSave = "💾";
/** 打印 */
export const toolPrint = "🖨️";
/** 上传 */
export const toolUpload = "📤";
/** 下载 */
export const toolDownload = "📥";
/** 链接 / 关联 */
export const toolLink = "🔗";
/** 断开链接 */
export const toolUnlink = "✂️";
/** 压缩 / 打包 */
export const toolCompress = "🗜️";
/** 解压 / 展开 */
export const toolExtract = "📂";
/** 同步 / 刷新 */
export const toolSync = "🔄";
/** 云存储 */
export const toolCloud = "☁️";
/** 发送 */
export const toolSend = "📤";
/** 接收 */
export const toolReceive = "📥";

// ========== 播放 / 界面控件 ==========

/** 随机播放 */
export const controlShuffle = "🔀";
/** 循环播放 */
export const controlRepeat = "🔁";
/** 单曲循环 */
export const controlRepeatOne = "🔂";
/** 刷新 / 循环 */
export const controlRefresh = "🔄";
/** 垂直刷新 */
export const controlRefreshAlt = "🔃";
/** 弹出 */
export const controlEject = "⏏️";
/** 播放 */
export const controlPlay = "▶️";
/** 暂停 */
export const controlPause = "⏸️";
/** 停止 */
export const controlStop = "⏹️";
/** 录制 */
export const controlRecord = "⏺️";
/** 播放/暂停切换 */
export const controlPlayPause = "⏯️";
/** 快进 */
export const controlFastForward = "⏩";
/** 下一项 */
export const controlNext = "⏭️";
/** 后退 */
export const controlRewind = "◀️";
/** 快退 */
export const controlFastRewind = "⏪";
/** 上一项 */
export const controlPrevious = "⏮️";
/** 向上 */
export const controlArrowUp = "🔼";
/** 向下 */
export const controlArrowDown = "🔽";
/** 快速向上 */
export const controlFastUp = "⏫";
/** 快速向下 */
export const controlFastDown = "⏬";
/** 调音控制台 */
export const controlPanel = "🎛️";
/** 单选按钮 */
export const radioButton = "🔘";
/** 轨迹球 */
export const trackball = "🖲️";

// ========== 标识 / 标牌 / 票证 ==========

/** 告示牌 */
export const signNotice = "🪧";
/** 公交站牌 */
export const signBusStop = "🚏";
/** 出入境检查牌 */
export const signImmigration = "🛂";
/** ATM 标识 */
export const signAtm = "🏧";
/** 书签 */
export const tagBookmark = "🔖";
/** 索引卡片 */
export const cardIndex = "📇";
/** 价格吊牌 */
export const tagPrice = "🏷️";
/** 纸质票根 */
export const ticketStub = "🎫";
/** 入场券 */
export const ticketAdmission = "🎟️";
/** 施工路障 */
export const barricade = "🚧";
/** 警示牌 */
export const signWarning = "⚠️";
/** 终点旗 */
export const flagFinish = "🏁";
/** 三角旗 */
export const flagTriangle = "🚩";
/** 姓名胸牌 */
export const badgeName = "📛";
/** 勋章 */
export const awardMedal = "🎖️";
/** 奖牌 */
export const awardTrophy = "🏅";
/** 铭牌 */
export const nameplate = "💠";
/** 证件卡 */
export const idCard = "🪪";

// ========== 办公 / 文档 / 数据 ==========

/** 多层文件夹 */
export const folderArchive = "🗂️";
/** 线圈记事本 */
export const notebook = "🗒️";
/** 线圈日历 */
export const calendarSpiral = "🗓️";
/** 手撕日历 */
export const calendarTorn = "📆";
/** 上升折线图 */
export const chartLineUp = "📈";
/** 下降折线图 */
export const chartLineDown = "📉";
/** 柱状图 */
export const chartBar = "📊";
/** 清单夹板 */
export const clipboard = "📋";
/** 卷轴文书 */
export const scroll = "📜";
/** 单据 */
export const singlePage = "📃";
/** 传真机 */
export const faxMachine = "📠";
/** 放映机 */
export const projector = "📽️";
/** 胶片卷 */
export const filmFrame = "🎞️";
/** 收信邮箱 */
export const mailboxClosed = "📫";
/** 空邮箱 */
export const mailboxOpen = "📭";
/** 邮政号角 */
export const mailHorn = "📯";
/** 信封 */
export const envelope = "✉️";
/** 情书 */
export const loveLetter = "💌";

// ========== 锁具 / 安全 / 工具 ==========

/** 上锁 */
export const lockClosed = "🔒";
/** 开锁 */
export const lockOpen = "🔓";
/** 带钥匙锁 */
export const lockKey = "🔐";
/** 复古钥匙 */
export const keyVintage = "🗝️";
/** 普通钥匙 */
export const key = "🔑";
/** 链条 */
export const chains = "⛓️";
/** 断裂锁链 */
export const chainBroken = "⛓️‍💥";
/** 链扣 */
export const chainLink = "🔗";
/** 磁铁 */
export const magnet = "🧲";
/** 夹紧钳 */
export const clamp = "🗜️";
/** 盾牌 */
export const shield = "🛡️";
/** 灭火器 */
export const fireExtinguisher = "🧯";
/** 手电 */
export const flashlight = "🔦";
/** 警示灯 */
export const siren = "🚨";
/** 锤镐 */
export const toolPickaxe = "⚒️";
/** 铁锹 */
export const toolShovel = "🪏";
/** 挂钩 */
export const toolHook = "🪝";
/** 木锯 */
export const toolSaw = "🪚";
/** 炸弹 */
export const toolBomb = "💣";
/** 回旋镖 */
export const toolBoomerang = "🪃";
/** 盲杖 */
export const toolCane = "🦯";
/** 船锚 */
export const toolAnchor = "⚓";
/** 管道活塞 */
export const toolPlunger = "🪠";
/** 工具箱 */
export const toolToolbox = "🧰";

// ========== 数码 / 外设 ==========

/** 软盘 */
export const storageFloppy = "💾";
/** 光盘 */
export const storageOptical = "💿";
/** DVD 碟片 */
export const storageDisc = "📀";
/** 打印机 */
export const printer = "🖨️";
/** 收音机 */
export const radio = "📻";
/** 卫星天线 */
export const satellite = "📡";
/** 游戏摇杆 */
export const joystick = "🕹️";
/** 游戏手柄 */
export const gamepad = "🎮";
/** 头戴耳机 */
export const headphones = "🎧";
/** 录音麦 */
export const microphone = "🎙️";

// ========== 医疗 / 实验 ==========

/** 试管 */
export const labTestTube = "🧪";
/** 蒸馏烧瓶 */
export const labFlask = "⚗️";
/** 显微镜 */
export const microscope = "🔬";
/** 望远镜 */
export const telescope = "🔭";
/** 创可贴 */
export const bandage = "🩹";
/** 听诊器 */
export const stethoscope = "🩺";
/** 药片 */
export const pills = "💊";
/** 注射器 */
export const syringe = "💉";
/** 血袋 */
export const bloodBag = "🩸";
/** 骨骼 */
export const bone = "🦴";
/** 拐杖 */
export const walkingFrame = "🩼";
/** 轮椅 */
export const wheelchair = "♿";

// ========== 服饰 / 家居 ==========

/** 毛线团 */
export const yarn = "🧶";
/** 针线 */
export const thread = "🧵";
/** 缝衣针 */
export const needleSewing = "🪡";
/** 安全别针 */
export const safetyPin = "🧷";
/** 口红 */
export const lipstick = "💄";
/** 化妆镜 */
export const mirror = "🪞";
/** 草帽 */
export const hatWide = "👒";
/** 高礼帽 */
export const hatTop = "🎩";
/** 鸭舌帽 */
export const cap = "🧢";
/** 安全帽 */
export const helmetSafety = "⛑️";
/** 护目镜 */
export const goggles = "🥽";
/** 眼镜 */
export const glasses = "👓";
/** 太阳镜 */
export const sunglasses = "🕶️";
/** 戒指 */
export const ring = "💍";
/** 宝石 */
export const gem = "💎";
/** 手提包 */
export const handbag = "👜";
/** 背包 */
export const backpack = "🎒";
/** 牙刷 */
export const toothbrush = "🪥";
/** 洗护瓶 */
export const lotion = "🧴";
/** 香皂 */
export const soap = "🧼";
/** 卷纸 */
export const toiletPaper = "🧻";
/** 海绵 */
export const sponge = "🧽";
/** 扫帚 */
export const broom = "🧹";
/** 收纳筐 */
export const laundryBasket = "🧺";
/** 水桶 */
export const bucket = "🪣";
/** 手推车 */
export const shoppingCart = "🛒";
/** 蜡烛 */
export const candle = "🕯️";
/** 盆栽 */
export const pottedPlant = "🪴";
/** 床 */
export const bed = "🛏️";
/** 沙发 */
export const sofa = "🛋️";
/** 木椅 */
export const chair = "🪑";
/** 淋浴 */
export const shower = "🚿";
/** 浴缸 */
export const bathtub = "🛁";
/** 马桶 */
export const toilet = "🚽";

// ========== 乐器 / 舞台 ==========

/** 钢琴 */
export const piano = "🎹";
/** 小号 */
export const trumpet = "🎺";
/** 萨克斯 */
export const saxophone = "🎷";
/** 小提琴 */
export const violin = "🎻";
/** 班卓 */
export const banjo = "🪕";
/** 手风琴 */
export const accordion = "🪗";
/** 架子鼓 */
export const drum = "🥁";
/** 手持喇叭 */
export const megaphone = "📢";
/** 扩音喇叭 */
export const loudspeaker = "📣";
/** 铃铛 */
export const bell = "🔔";
/** 静音铃 */
export const bellOff = "🔕";
/** 乐谱 */
export const musicScore = "🎼";
/** 音符 */
export const musicNotes = "🎶";

// ========== 钱币 / 礼品 / 容器 ==========

/** 钱袋 */
export const moneyBag = "💰";
/** 美元 */
export const banknotesDollar = "💵";
/** 欧元 */
export const banknotesEuro = "💶";
/** 英镑 */
export const banknotesPound = "💷";
/** 飞钱 */
export const moneyWings = "💸";
/** 硬币 */
export const coin = "🪙";
/** 银行卡 */
export const creditCard = "💳";
/** 礼物盒 */
export const giftBox = "🎁";
/** 纸箱 */
export const packageBox = "📦";
/** 陶罐 */
export const amphora = "🏺";
/** 瓷瓶 */
export const urn = "⚱️";
/** 念珠 */
export const prayerBeads = "📿";

// ========== 通用动作 ==========

/** 关闭 / 删除 */
export const actionClose = "🗑️";
/** 提示 / 建议 */
export const actionHint = "🔦";
/** 刷新 */
export const actionRefresh = "🔄";
/** 图片 */
export const actionImage = "🖼️";
/** 展开 */
export const actionExpand = "▶️";
/** 折叠 */
export const actionCollapse = "🔽";
/** 选择器符号 */
export const actionSelect = "➤";
/** 列表项目符号 */
export const actionBullet = "🔸";
/** 编辑 */
export const actionEdit = "📝";
/** 确认 / 确定 */
export const actionConfirm = "👌";
/** 取消 */
export const actionCancel = "🚫";
/** 添加 / 新建 */
export const actionAdd = "➕";
/** 移除 / 减去 */
export const actionRemove = "➖";
/** 前进 / 下一步 */
export const actionNext = "⏩";
/** 后退 / 上一步 */
export const actionPrev = "⏪";
/** 置顶 */
export const actionTop = "🔝";
/** 排序升序 */
export const actionSortAsc = "🔼";
/** 排序降序 */
export const actionSortDesc = "🔽";
/** 过滤 */
export const actionFilter = "🔍";
/** 更多 / 省略 */
export const actionMore = "⋮";

// ========== 默认/预设指示 ==========

/** 默认 / 活跃 / 星标 */
export const iconDefault = "🏆";
/** 内置 / 预设 */
export const iconBuiltin = "💎";
/** 自定义 */
export const iconCustom = "🔹";
/** 锁定 */
export const iconLock = "🔐";
/** 解锁 */
export const iconUnlock = "🔓";
/** 公开 / 开放 */
export const iconPublic = "🌐";
/** 私有 / 隐藏 */
export const iconPrivate = "🚫";

// ========== 系统 / 监控 ==========

/** CPU */
export const sysCpu = "🧠";
/** 内存 / RAM */
export const sysMemory = "🧮";
/** 磁盘 / 存储 */
export const sysDisk = "💿";
/** 电池 */
export const sysBattery = "🔋";
/** 温度 / 热度 */
export const sysTemp = "🌡️";
/** 网络 / WiFi */
export const sysNetwork = "📡";
/** 日志 / 记录 */
export const sysLog = "📜";
/** 监控 / 仪表盘 */
export const sysMonitor = "📊";
/** 时钟 / 定时 */
export const sysClock = "🕐";
/** 日历 */
export const sysCalendar = "📅";
/** 环境变量 / 配置 */
export const sysEnv = "🌲";
/** 容器 / Docker */
export const sysContainer = "🐳";

// ========== 开发 / 代码 ==========

/** 代码 / 源码 */
export const devCode = "💻";
/** 分支 */
export const devBranch = "🌿";
/** 合并 */
export const devMerge = "🔀";
/** 提交 / 快照 */
export const devCommit = "📸";
/** 差异 / 对比 */
export const devDiff = "🆚";
/** Bug / 缺陷 */
export const devBug = "🐛";
/** 测试 / 试管 */
export const devTest = "🧪";
/** 构建 / 锤子 */
export const devBuild = "🔨";
/** 部署 / 火箭 */
export const devDeploy = "🚀";
/** 包 / 依赖 */
export const devPackage = "📦";
/** 版本 / 标签 */
export const devVersion = "🏷️";
/** 文档 / 手册 */
export const devDocs = "📚";
/** API / 接口 */
export const devApi = "🔌";
/** 数据库 */
export const devDatabase = "🗄️";
/** 服务端 / 后端 */
export const devServer = "🖥️";
/** 客户端 / 前端 */
export const devClient = "📱";
/** 缓存 */
export const devCache = "⚡";
/** 流水线 / CI */
export const devPipeline = "🚦";

// ========== 数据展示 ==========

/** 统计 / 图表 */
export const dataChart = "📊";
/** 趋势 / 上升 */
export const dataTrendUp = "📈";
/** 趋势 / 下降 */
export const dataTrendDown = "📉";
/** 表格 */
export const dataTable = "🧮";
/** 列表视图 */
export const dataList = "📃";
/** 网格视图 */
export const dataGrid = "▦";
/** 看板 / 板 */
export const dataBoard = "📋";
/** 饼图 */
export const dataPie = "🥧";
/** 地图 / 位置 */
export const dataMap = "🗺️";
/** 搜索数据 */
export const dataSearch = "🔎";

// ========== 安全 ==========

/** 密钥 */
export const secKey = "🔑";
/** 密码 / 隐藏 */
export const secPassword = "🔒";
/** 证书 / 奖章 */
export const secCert = "📜";
/** 扫描 / 检测 */
export const secScan = "🔍";
/** 漏洞 / 裂缝 */
export const secVuln = "🕳️";
/** 盾牌 / 防护 */
export const secShield = "🛡️";
/** 指纹 / 生物识别 */
export const secFingerprint = "👆";
/** 眼睛 / 可见性 */
export const secEye = "👁️";
/** 隐藏 / 不可见 */
export const secEyeOff = "🙈";

// ========== 多媒体 ==========

/** 音乐 / 音符 */
export const mediaMusic = "🎵";
/** 视频 / 电影 */
export const mediaVideo = "🎬";
/** 播放 */
export const mediaPlay = "▶️";
/** 停止 */
export const mediaStop = "⏹️";
/** 音量高 */
export const mediaVolumeHigh = "🔊";
/** 音量低 */
export const mediaVolumeLow = "🔉";
/** 静音 */
export const mediaVolumeMute = "🔇";
/** 麦克风 */
export const mediaMic = "🎤";
/** 相机 */
export const mediaCamera = "📷";
/** 电话 */
export const mediaPhone = "📞";

// ========== 品牌 ==========

/** Logo(暂保留，后续替换) */
export const brandLogo = "🦀";

// ========== 主题分组输出 ==========

/** CLI / 终端 相关实物拟物 */
export const cliTerminalIcons = [
  toolBash,
  toolRead,
  toolWrite,
  toolCodeSearch,
  toolWebSearch,
  toolWebFetch,
  toolGit,
  toolCopy,
  toolPaste,
  toolCut,
  toolUndo,
  toolRedo,
  toolSave,
  toolPrint,
  toolUpload,
  toolDownload,
  toolCompress,
  toolExtract,
  toolSync,
  toolCloud,
  controlPanel,
  radioButton,
  trackball,
  storageFloppy,
  storageOptical,
  storageDisc,
  printer,
  satellite,
  joystick,
  gamepad,
  headphones,
  microphone,
  shield,
  lockClosed,
  lockOpen,
  lockKey,
  chains,
  magnet,
  clamp,
  toolToolbox,
];

/** Git / CI 相关拟物 */
export const gitCiIcons = [
  toolGit,
  devBranch,
  devMerge,
  devCommit,
  devDiff,
  devBuild,
  devDeploy,
  devPackage,
  devVersion,
  devTest,
  devPipeline,
  tagPrice,
  banknotesDollar,
  coin,
  packageBox,
  giftBox,
  awardTrophy,
  awardMedal,
];

/** 日志 / 监控 / 统计 相关拟物 */
export const logsMonitorIcons = [
  sysLog,
  sysMonitor,
  sysClock,
  sysCalendar,
  sysNetwork,
  sysCpu,
  sysMemory,
  sysDisk,
  sysBattery,
  sysTemp,
  chartLineUp,
  chartLineDown,
  chartBar,
  dataChart,
  dataTrendUp,
  dataTrendDown,
  dataTable,
  dataList,
  dataGrid,
  dataBoard,
  dataSearch,
  mailboxClosed,
  mailboxOpen,
  mailHorn,
  siren,
  bell,
  bellOff,
  flashlight,
];

/** 文件管理 / 文档类拟物 */
export const fileManagementIcons = [
  iconFolder,
  iconFile,
  folderArchive,
  notebook,
  calendarSpiral,
  calendarTorn,
  clipboard,
  scroll,
  singlePage,
  faxMachine,
  projector,
  filmFrame,
  mailboxClosed,
  mailboxOpen,
  envelope,
  loveLetter,
  tagBookmark,
  cardIndex,
  tagPrice,
  ticketStub,
  ticketAdmission,
  packageBox,
  giftBox,
  amphora,
  urn,
  prayerBeads,
  toolCompress,
  toolExtract,
];

// ========== 映射函数 ==========

/** 连接状态 → 图标 */
export function connectionIcon(status: string): string {
  switch (status) {
    case "connected": {
      return iconSuccess;
    }
    case "connecting": {
      return iconRunning;
    }
    case "error": {
      return iconError;
    }
    case "disconnected": {
      return iconIdle;
    }
    case "disabled": {
      return iconDisabled;
    }
    default: {
      return iconIdle;
    }
  }
}

/** 风险等级 → 图标 */
export function riskIcon(level: "low" | "medium" | "high"): string {
  switch (level) {
    case "low": {
      return iconSuccess;
    }
    case "medium": {
      return iconWarning;
    }
    case "high": {
      return iconError;
    }
  }
}

/** 任务状态 → 图标 */
export function taskIcon(status: string): string {
  switch (status) {
    case "pending":
    case "queued": {
      return iconQueued;
    }
    case "running":
    case "in_progress": {
      return iconRunning;
    }
    case "success":
    case "completed": {
      return iconSuccess;
    }
    case "failed":
    case "error": {
      return iconError;
    }
    case "warn":
    case "warning": {
      return iconWarning;
    }
    case "skipped": {
      return iconSkipped;
    }
    case "blocked": {
      return iconBlocked;
    }
    case "timeout": {
      return iconTimeout;
    }
    case "partial": {
      return iconPartial;
    }
    case "cancelled": {
      return actionCancel;
    }
    default: {
      return iconUnknown;
    }
  }
}

// ═══════ 等宽字符补充(用于行内/列对齐,无色彩) ═══════

/** 勾选 ✓(ASCII 等宽,黑白,用于列对齐场景) */
export const asciiCheck = "✓";
/** 叉号 ✗(ASCII 等宽,黑白) */
export const asciiCross = "✗";
/** 加粗叉号 ✘(ASCII 等宽) */
export const asciiCrossHeavy = "✘";
/** 圆点 • */
export const asciiBullet = "•";
/** 圆圈 ○ */
export const asciiCircle = "○";
/** 半圆 ◐ */
export const asciiHalf = "◐";
/** 禁止 ⊘ */
export const asciiNoEntry = "⊘";
/** 加载/旋转 ⟳ */
export const asciiSpinner = "⟳";
/** 菱形 ◆ */
export const asciiDiamond = "◆";
/** 空心菱形 ◇ */
export const asciiDiamondOpen = "◇";
/** 长破折号 — */
export const asciiEmDash = "—";

/** 业务域补充字符 */
export const asciiTimer = "⏱";
/** 目标字符 🎯 */
export const asciiTarget = "🎯";
/** 关闭字符 ⏹ */
export const asciiStop = "⏹";

// ═══════ 动画帧序列(供动画/spinner 使用) ═══════

export const barFrames: readonly string[] = ["▏", "▎", "▍", "▌", "▋", "▊", "▉", "█"];
export const dotFrames: readonly string[] = ["○", "◔", "◑", "◕", "●"];
export const spinnerFrames: readonly string[] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export const complexDotFrames: readonly string[] = ["⡀", "⡄", "⡆", "⡇", "⡏", "⡟", "⡿", "⢿", "⢻", "⢩", "⢈", "⢀"];
export const defaultPulseFrames: readonly string[] = ["●", "○"];
export const waitingFrames: readonly string[] = ["◐", "◓", "◑", "◒"];

// ═══════ Radio / 展开折叠 等宽字符(供派生模块用) ═══════

export const asciiDot = "●";
export const asciiDotFilled = "◉";
export const asciiCircleDouble = "◎";
export const asciiTriangleDown = "▼";
export const asciiTriangleRight = "▶";
export const asciiTriangleDownOpen = "▽";
export const asciiTriangleRightOpen = "▷";
