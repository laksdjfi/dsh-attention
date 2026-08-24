# dsh-attention

DeepSeek Harness 的「确认提醒」插件：当 Harness 需要你**审批**（工具越权/权限申请）、**回答**（`ask_user_question` 提问），或**后台任务完成**时，即使你没有盯着页面，也会弹出**系统通知**；点击通知自动聚焦窗口并切到对应会话，落地到 DSH 自带的内联确认卡片上处理。

## 背景

DSH 有两类"需要你"的场景，默认只在聊天区内联渲染卡片：

| 场景 | 触发机制 | 内置 UI |
|---|---|---|
| 权限/审批 | 服务端发 `approval/requested` 帧 | 输入框上方「等待审批」（拒绝 / 允许一次） |
| 提问确认 | 服务端发 `question/requested` 帧 | 输入框上方问题卡片（选项 / 自定义回答） |

如果你没盯着页面（切到别的窗口、标签页在后台、滚到别处），就完全看不到，而 Agent 会一直阻塞等待。本插件用系统通知兜底，并支持一键跳转。

## 功能

- **系统通知**：任意会话出现待处理审批或提问时，通过浏览器 `Notification` API 弹系统级通知（标签页在后台、窗口最小化也能收到）
- **完成通知**：后台会话任务跑完时也弹系统通知（可单独开关）
- **点击跳转**：点击通知 → 聚焦 DSH 窗口 → 自动选中对应会话（内联卡片/完成结果就在眼前）
- **防打扰**：页面正聚焦且正在该会话时，不重复提醒（内置卡片/完成标记已可见）
- **设置分区**：设置 → 确认提醒 —— 总开关、完成通知开关、通知权限授权、测试通知

## 工作原理

纯客户端插件，监控 `sessions` 列表快照中每个会话的 `pendingInteraction` 字段（`approval` / `question`）与 `completed` 标记（后台会话跑完），与上次已通知的状态做差集，只对新出现的待处理项/完成项发通知；状态恢复时自动解除去重。

- 服务端 bundle（`lib/index.js`）是空挂载，仅用于把插件挂进 profile 层栈
- 客户端模块（`lib/client.js`）按 DSH client-module 格式（`window.__ModuleLoader__`）加载
- 配置存 `localStorage`（键 `dsh-attention.settings`）：`enabled`（默认开）、`notifyCompleted`（默认开）、`suppressFocused`（默认开）

## 安装

```powershell
# 在插件目录下执行
powershell -ExecutionPolicy Bypass -File install.ps1
# 可选参数：-Profile webtest / -DshHome D:\data\.dsh
```

脚本会把插件复制到 `~/.dsh/profiles/<Profile>/node_modules/dsh-attention`，并在 profile 的 `package.json` 注册 dependencies 与 `dsh.profile.bundles`。

然后重启 DSH Web（运行你的启动脚本或重启 `dsh web`），刷新浏览器，打开 **设置 → 确认提醒**，点「授权系统通知」，再点「发送测试通知」验证。

> 之后若执行过 `dsh plugin`（pnpm）导致该目录被清理，重新运行 `install.ps1` 即可。

## 目录结构

```
dsh-attention/
├── package.json          # bundle patch + client inject 元数据
├── cordis.patch.yml      # 挂载 bundle 到 profile 层栈
├── install.ps1           # 离线安装脚本
├── lib/
│   ├── index.js          # 服务端空挂载
│   └── client.js         # 浏览器端：监控 + 系统通知 + 设置面板
├── LICENSE               # MIT
├── CHANGELOG.md
└── README.md
```

## 上传到 GitHub

仓库名建议用 `dsh-attention`。手动上传时把本目录内容（`package.json`、`cordis.patch.yml`、`install.ps1`、`lib/`、`LICENSE`、`CHANGELOG.md`、`README.md`、`.gitignore`）拖入仓库即可；`开发日志.md` 是内部记录，可传可不传。上传前把 `package.json` 的 `repository`/`homepage` 字段补成你的仓库地址。

## 说明与限制

- 依赖浏览器 `Notification` API（localhost 下可用）；权限被拒时仅提示，不崩溃
- 通知在**页面打开期间**有效；若浏览器被完全关闭，通知无法送达（DSH Web 本身就是网页应用，天然如此）
- 完成通知基于 DSH 内置的 `completed` 标记（会话在**未被选中**期间跑完才会点亮），所以只在后台任务完成时提醒，不会打扰你正在盯着的会话
- 插件只负责"提醒 + 跳转"，审批/提问的回答仍走 DSH 内置卡片
