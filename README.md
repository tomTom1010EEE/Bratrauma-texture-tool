# Barotrauma Chara Texture Tool

Barotrauma Mod 贴图标定器，第二阶段：实时持握、贴图坐标与服装对照。
使用 React + Mantine 组件库、Konva 画布；Node 本地资源服务。本地开发 Mod 支持安全坐标回写，工坊 / Installed 只读；不上传或打包第三方贴图。

项目地址：<https://github.com/tomTom1010EEE/Bratrauma-texture-tool>。

**当前发布的是 v0.4.0 源码版本，不是免安装便携版。** 在浏览器中独立运行，不是在游戏内打开的插件。日常标定不需要 AI 客户端；MCP 是可选功能。人物参照需要用户自行订阅并在本地安装 [木卫二萌化计划 / EA-HI](https://steamcommunity.com/sharedfiles/filedetails/?id=2809175631)，本仓库不包含其贴图。Empire Arms、DDA 和九州只用于对应资源的导入与验证，不是工具启动的全部必需依赖。

许可证沿用仓库既有的 [AGPL-3.0](LICENSE)。第三方库、游戏及各 Mod 美术资产不因本仓库的许可证而改变各自授权。本项目不是官方 Barotrauma 编辑器。

## 启动

首次使用需要 Node.js 22.12+（或更新的兼容 LTS 版本）和 pnpm。克隆仓库，或使用 GitHub 的 Code → Download ZIP 并解压，在项目目录运行：

```text
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

随后在浏览器打开 <http://127.0.0.1:4317>。安装过依赖后，Windows 也可双击 **start.cmd**：后台服务隐藏运行，日志位于 `.local/server.log`。重复启动复用现有服务；修改服务端代码后请重启服务。终端启动可在终端用 Ctrl+C 停止。`dist/` 只是前端构建产物，不能脱离 Node 资源服务直接双击使用。

开发模式 `pnpm dev`；自动化检查 `pnpm test`。默认只监听本机，不向局域网开放。

自动检测以下目录：

- `D:/SteamLibrary/steamapps/common/Barotrauma/LocalMods/Empire Arms`
- `D:/SteamLibrary/steamapps/workshop/content/602960/{2809175631,3159849099,3630177833,3443540295,2852411866}`（末项为九州武库引用的 T.S.M 贴图依赖）

这些是开发机的默认搜索路径，不要求用户使用 D 盘。其他位置请在启动前通过 `BAROTRAUMA_GAME`、`BAROTRAUMA_WORKSHOP`、`PORT` 环境变量调整。例如 PowerShell：

```powershell
$env:BAROTRAUMA_GAME = 'E:/SteamLibrary/steamapps/common/Barotrauma'
$env:BAROTRAUMA_WORKSHOP = 'E:/SteamLibrary/steamapps/workshop/content/602960'
pnpm start
```

`BAROTRAUMA_GAME` 应指向包含 `Barotrauma.exe` 和 `LocalMods` 的游戏目录，安全回写的 LocalMods 边界由此决定。若素材位于游戏的 `WorkshopMods/Installed` 副本，可在界面齿轮中连接具体 Mod 目录（当前运行期间有效，重启需重新连接）。EA-HI 缺失时会报错，**不会改用原版人物**。

## 建议工作流

1. **导入已有物品**：资源库 → 选择 Mod → 搜索名称 / identifier / XML 路径 → 点击物品。只读取 filelist 注册的 Item，避免未启用的实验资源覆盖正式物品。或新建“服装 / 武器 / 工具”，选择本地 PNG/JPEG/WebP。
2. **贴图标定**：左画布拖出 SourceRect；拖边框调整尺寸；按住 Shift 可从现有框内重新框选。点击“原点”设置 origin，可拖出框外。参数区支持精确输入。滚轮缩放、V 平移、C 框选、O 原点；“聚焦框选”放大当前区域，“适应贴图”恢复全图。
3. **武器 / 工具**：导入后进入“持握”页。标定 H1（右手）、H2（左手）和枪口 / 工具作用点；单双手开关与预览手分别控制装备方式和查看哪只手。单手左手仍使用 H2。切换“静态 / 瞄准”，实时查看 holdpos / aimpos / holdangle / aimangle；瞄准方向仅影响预览，不导出。武器保持 XML 未缩放坐标，工具作用点按 RepairTool 规则换算。
4. **服装**：选择一片 Wearable 图层，指定肢体。直接在人物上拖动这片衣物，实时反算 origin；Alt + 滚轮改穿戴 scale，或勾选“滚轮改贴图”免按 Alt。继承 origin 的衣片需先取消继承才能拖动。切换朝向、性别、脸型和前后发。“适应预览”重新居中，空白处拖动平移画布。
5. **配件**：打开独立“配件”页，点击“按接纳规则装配预览”。读取 ItemContainer / SubContainer / Containable，按 identifier 或 tag 和排除项匹配本机独立物品，同一子容器候选只装配一个。选中挂点后可在人物 / 物品组装页拖紫色挂点或配件框调 itempos；原点模式拖配件图调其预览 origin，Alt + 滚轮调配件自身预览 scale。支持合适的 ContainedSprite 和静态 DecorativeSprite；不执行动态脚本。增加新逻辑槽位会改变容器功能，故“新增挂点模板”仅进入工程与待合并 XML；已有规则缺少 itempos 时可直接补充并回写坐标。
6. **保存与导出**：保存 `.sprite-lab.json` 可继续编辑；本地上传的图像内嵌 JSON，Mod 图片保留本地引用。浏览器自动存草稿，不替代下载保存。导出 XML 只含当前 Item 的外观 / 坐标模板，不带原伤害、配方、StatusEffect 或 Lua。容器坐标为独立待合并片段，不复制原容器槽位结构；配件预览的物品不重复导出。Body 为框选宽高占位，需要开发者调整。新建服装没有物品主图时，暂用第一片衣物作物品主图，可再添加专用主图。

删除图层、导入和新建都可用撤销恢复；刷新页面不保留撤销历史。画布眼睛只控制预览，是否导出由“包含在导出模板中”控制。

### 保存回 Mod

导入时显示来源权限；仅真实路径位于游戏 `LocalMods/<Mod>/` 且具有有效 filelist 的源 XML 可回写。Steam workshop、WorkshopMods/Installed、未知目录、越界目录链接、硬链接文件均只读。发布过、带 Workshop ID 的本地开发副本仍可保存。

点击“保存回 Mod”先查看差异，再确认保存。仅替换当前物品的 Item.scale、图层 sourcerect/origin/offset/rotation/depth（Wearable/Decorative 的 scale）、握点、holdpos/aimpos/角度、barrelpos/工具角度和既有挂点的位置/旋转、可确认的容器绘制深度。**不回写 identifier、贴图路径、Body、slots、接纳/隐藏规则、伤害、配方、StatusEffect 或任何脚本。**新增/删除节点不写回，界面明确提示跳过项。配件预览的 scale/origin 不跨文件写入，需独立导入该配件再保存。

每次保存生成源 XML 同目录的 `.sprite-lab-时间-随机值.bak`，随后原子替换 XML。保留原大小写、引号、BOM、换行、注释和未修改字节；非无损 UTF-8 文件拒绝回写。导入后若文件被外部修改，预览或确认时都会拒绝覆盖。确认采用服务端保存的差异快照，保存后点击“重新读取来源”进入下一轮。服务重启后的旧草稿需下载工程备份、重新导入来源建立安全会话；不自动覆盖草稿。

### 外骨骼 / 穿戴与持握复合装备

自动识别 Wearable 与 Holdable 使用相同槽位组合、且同时占用穿戴槽位与手的物品（如 `OuterClothes+RightHand`）。不依赖名字或专用 tag，已有 schema-1 工程也适用。

- **穿戴＋持握**：衣片绘制在实时 IK 人物上；STRV 122B+ 的车体随 Torso、炮管随 RightForearm，穿戴状态不重复绘制 Item 主图及其装饰。
- **衣片选择器**：可直接切换车体 / 炮管，自动打开贴图参数。拖动衣片只改变该片 origin，Alt＋滚轮改变该片 scale；橙色物理原点和“握点”模式仍标定 holdpos / aimpos、H1 / H2 / 枪口。衣片局部原点不是 Item 物理原点，不能直接把炮管裁切框当作主图坐标系。
- **落地主图**：单独查看、调整 Item 主图，不绘制穿戴衣片。Item.scale 影响落地主图及持握坐标，穿戴衣片的 scale 仍独立。
- 实时返回的标定 XML 同时包含 Wearable 和 Holdable。安全回写沿用坐标白名单，不改槽位、脚本或其他功能字段。普通服装、独立手持武器与分开占用槽位的背包不作为这种复合装备处理。

规则对齐引擎 [Holdable.Equip](https://github.com/FakeFishGames/Barotrauma/blob/master/Barotrauma/BarotraumaShared/SharedSource/Items/Components/Holdable/Holdable.cs) 的槽位一致判断和 [Item.Draw](https://github.com/FakeFishGames/Barotrauma/blob/master/Barotrauma/BarotraumaClient/ClientSource/Items/Item.cs) 的穿戴时隐藏手持主图规则。自定义 TriggerAnimation / Lua 仍不运行，预览是参考人物上的静态 IK。

### 近战预览

MeleeWeapon（扳手、刀、双手剑）使用独立“静态 / 准备 / 挥击”模式。进度条逐帧查看，播放按钮半速循环准备、挥击和冷却。按引擎 MeleeWeapon.Update 的抬手角度与额外物品角度处理，不将近战当作枪械瞄准；不可达的挥击目标会让物品留在主手而非飞向目标点。读取 Swing、SwingPos、SwingForce、Reload、RequireAimToUse，**只预览、不回写攻击参数**。坐标仍通过 holdpos/aimpos/角度/握点/原点/scale 编辑；挥击阶段禁用持握位置拖动，避免误改静态位置。

这是引擎目标姿态 + 保长 IK 预览，并非 Farseer 物理模拟；关节限位、惯性、身体冲量、真实命中和 Lua 动作仍需游戏内验收。

## 人物预览快捷编辑

- **位置**：在人物预览拖动主图或橙色 O 点，回写当前 holdpos / aimpos；蓝色旋钮调 holdangle / aimangle。
- **原点**：拖动主图改 Sprite.origin，物品原点与握点 XML 保持不变。物品组装视图默认采用这种拖动方式。
- **握点**：在人物上直接拖 H1 / H2 / 枪口，图集与右侧数值同步更新。
- **缩放**：Alt + 滚轮改选中衣片 / 装饰图层的 scale，主图则改 Item.scale。勾选“滚轮改贴图”后直接滚轮编辑，Alt + 滚轮反而用于查看倍率。缩放中心为原点，不会暗中补偿 origin。普通查看倍率不写 XML。
- **看清细节**：“展开人物预览”隐藏图集，“聚焦持握”聚焦上半身和武器；空白处拖动平移，普通滚轮以鼠标位置缩放视图。
- **数据返回**：“持握”页下方 XML 随编辑实时更新，可复制；“导出 XML”生成完整标定模板。一次拖动只需一次撤销。JSON 继续兼容第一阶段的 schemaVersion=1。

主贴图的实际缩放是 **Item.scale**，不是 Sprite.scale。第一阶段的入口位于“物品 / 握点”，现在“贴图”页主图与“持握”页也都有同步入口。穿戴衣片 scale 与 Item.scale 相互独立。

## 范围与限制

- EA-HI 男女角色：从真实 Ragdoll XML 重建 **15 个肢体、14 个关节**。按游戏 JointScale、LimbScale、TextureScale 和各肢体的 scale、origin 绘制，不拉伸成统一身高。
- 原点、裁切、握点、枪口、穿戴缩放 / 旋转 / 肢体绑定、depth / depthlimb、继承规则、hidelimb / hideotherwearables 静态预览。
- DecorativeSprite 的静态 offset / rotation / scale、ContainedSprite 与 InventoryIcon 的独立框选。随机装饰、动画条件、AlphaClip、灯光、变形着色器、物理碰撞、穿戴组合脚本、装备切换状态不模拟。
- 身体采用 XML 关节连接的绑定参考姿态；“放松姿态”是关节闭合的静态示意。持握为保留关节长度和 PullPos 的静态手臂 IK。未运行游戏物理和动画控制器，**不承诺与游戏任意一帧逐像素一致**。
- holdpos / aimpos 是肩部到物品原点的未缩放显示像素；holdpos 也随 holdangle 旋转。aimangle 只额外旋转物品，不额外旋转 aimpos。双手使用左肩作为位置基准（对齐 HoldItem 的赋值顺序）。手臂够不到时显示红线和差距，不拉长肢体。此时物品显示的是标定目标位置，游戏实际位置可能不同。
- holdpos=0,0 / usehandrotationforholdangle=true 时预览自由随手模式；位置拖动禁用，可用“启用固定持握”设置非零位置。aimpos=0,0 会退回静态持握；aimable=false 的瞄准方向跟随躯干。
- 一次标定一个 Item 的多图层；尚不提供多件独立服装叠穿的装备模拟器。variantof 仅读取显式字段，提示手动核对基类。
- DDA 的 SwitchableRangedWeapon 识别为枪械，保留组件名但不模拟射击模式。DDA / 九州等源 XML 的显式 StatusEffect setvalue 姿态赋值列为可选片段；只手动应用列出的参数，**不执行条件、Lua、计时或自动状态叠加**。动态摆动、后坐力、瞄准抖动、游泳姿态不模拟；近战支持目标动作预览，非完整物理。
- 通用可挂墙容器、物品网格间隔、Lua/C# 动态绘制不作完整仿真；主要支持具有物理 Body 的手持物品。

## MCP 接入与调试

v0.4 提供本地 **stdio MCP 服务**，基于官方 TypeScript SDK 2.2。它连接现有 4317 本地资源服务，不建立第二份编辑器状态。当前不是远程 HTTP MCP，也不提供公网入口。不会自动修改任何 AI 客户端的全局配置。

### 启动和连接

1. 双击 `start.cmd` 启动本地服务。升级后请重启旧服务并刷新网页；`/api/health` 应返回 `version: "0.4.0", mcp: true`。
2. 在 MCP 客户端增加一个 stdio 服务，**command 是 Node 可执行文件的绝对路径，args 是本项目 `server/mcp.mjs` 的绝对路径**。不要将 HTTP 地址当成 MCP 地址；也不要将 `pnpm mcp` 的包管理器提示输出混进协议通道。
3. `node scripts/mcp-config.mjs` 会输出适用于 `mcpServers` 配置格式的本机 JSON 示例；其他客户端按其配置格式填写相同 command / args / env。可用 `node -p process.execPath` 查询自己机器上的 Node 绝对路径，不要复制其他用户的运行时路径。
4. 网页右上角打开 **MCP**，开启“共享当前工程给 MCP”。默认只读；要实时调整，再开启“允许 MCP 修改坐标和预览”。每个标签页独立共享，关闭 / 刷新后默认不共享。AI 通过 `list_editors` 找到页面显示的 sessionId。

```json
{
  "mcpServers": {
    "abyss-sprite-lab": {
      "command": "C:/path/to/node.exe",
      "args": ["C:/path/to/barotrauma/server/mcp.mjs"],
      "env": { "SPRITE_LAB_PORT": "4317" }
    }
  }
}
```

本地 HTTP 服务用 `PORT` 指定端口，MCP 客户端用 `SPRITE_LAB_PORT` 指向同一个端口。连接凭据由服务生成在 `.local/mcp-<端口>.json`，MCP 入口自动读取；无需将 token 填进客户端配置。`SPRITE_LAB_RUNTIME` 可让两端使用相同的自定义运行目录。`.local` 已被 Git 忽略，不要公开或提交其中的凭据。

### 已实现的 18 个工具

| 类别 | 工具 | 行为 |
| --- | --- | --- |
| 发现与导入 | `get_status`, `list_mods`, `search_items`, `load_item` | 读取已连接资源库；load_item 只读磁盘，不替换网页草稿 |
| 页面会话 | `list_editors`, `get_editor_state`, `open_item` | 读取共享页面未保存数据；open_item 导入到页面，可撤销 |
| 标定 | `patch_calibration`, `set_preview`, `undo`, `redo` | 坐标白名单修改和预览切换；每次标定作为单个撤销步骤，不写 XML |
| 检查与输出 | `evaluate_pose`, `render_preview`, `export_calibration` | 姿态 / 握点误差，PNG 预览，标定模板 XML |
| 装配 | `assemble_attachments` | 复用容器接纳规则，在页面自动装配预览；不新增容器功能 |
| 安全保存 | `preview_save`, `commit_save`, `get_save_status` | 预览差异、请求页面人工确认、查询结果 |

建议调用流程：`list_editors` → `get_editor_state` → `patch_calibration` → `evaluate_pose` / `render_preview` → `preview_save` → `commit_save` → 用户在页面核对确认 → `get_save_status`。

修改、取图和保存预览均需当前 `expectedRevision`。例如：

```json
{
  "sessionId": "从 list_editors 获取",
  "expectedRevision": 12,
  "patch": {
    "itemScale": 0.35,
    "handle1": [-72, 3],
    "pose": { "holdpos": [65, -60], "aimangle": 30 },
    "layers": [{ "id": "从工程读取图层 ID", "origin": [0.5, 0.5] }],
    "sockets": [{ "id": "从工程读取挂点 ID", "position": [22, 7] }]
  }
}
```

字段不能使用任意 XML 路径。pose 坐标采用游戏的未缩放显示像素和 Y 向上规则；origin 是相对裁切框的比例；Item.scale 与衣片 scale 独立。继承 origin 的衣片需先在 UI 解除继承。禁止通过 MCP 修改 identifier、来源、贴图路径、slots、攻击参数、StatusEffect、Lua、接纳规则或新增结构节点。新增逻辑挂点仍通过现有 UI 模板流程处理。

`set_preview` 支持 mode=`hold` / `aim` / `swing`、hand、direction、progress=0..1、facing=1/-1、bodyPose、skeleton，并暂停近战播放。`evaluate_pose` 可带 preview 覆盖进行只读分析，不改页面；返回坐标为未镜像、Y 向下的编辑器世界显示像素，并非游戏物理模拟。

`render_preview` 默认 `fit=true`，从同一 Konva 场景生成 1000×800 完整取景 PNG，不移动用户镜头；`fit=false` 捕获当前画布范围。返回实际取景参数和 revision。图片未加载 / 页面离线会报错，不返回假预览。不提供无需浏览器的服务端渲染。

### 确认保存和冲突保护

`preview_save` 只生成约 9 分钟有效的 proposalId 和差异。`commit_save` **不直接写文件**，只在页面弹出人工确认，返回 pending；AI 应查询 `get_save_status`，不能把 pending 描述为已保存。页面没有提供给 MCP 的自动批准工具。拒绝、超时、工程版本变化、源文件变化或只读来源均不会写入。成功后返回 backup 和修改数；继续下一轮保存需重新导入来源。

页面约每 650ms 同步快照，命令在服务端与页面执行时双重检查 revision；本地拖动期间拒绝执行，单个页面只接收一个待处理命令。发生 `REVISION_CONFLICT` 时重新读取，不强制覆盖。超时可能发生在页面已执行、回执尚未到达的边界，应先读取工程确认，不能盲目重试修改。撤销只恢复草稿，不回滚已落盘 XML；磁盘恢复使用 `.bak`。

MCP 工具不开放任意目录注册、任意文件读写、代码执行或浏览器调试器。业务接口仍只监听本机，并验证 Host / Origin；MCP 调用另外验证每次服务启动生成的 bearer token，浏览器确认使用独立会话凭据。这是本机协作边界，不是抵御同一操作系统账户恶意程序的沙箱，不应代理到公网。

### 开发调试

```text
node scripts/mcp-call.mjs get_status
node scripts/mcp-call.mjs --list
node scripts/mcp-call.mjs list_editors
```

`mcp-call.mjs` 是真实 SDK stdio 客户端，不读取页面私有变量。第三个参数可传 JSON，也可传 `-` 从标准输入读 JSON，便于 PowerShell 管道调用。图片工具的结果写入本项目 `.local/mcp-preview.png`，其他结果打印 JSON。`pnpm test` 包含握点 / 近战数学、XML 安全回写、MCP 握手与工具调用、只读权限、版本冲突、人工确认和测试副本备份校验。

代码入口：`shared/mcp-contract.mjs` 是运行时白名单 / 工具 schema；`server/mcp.mjs` 是协议适配器；`server/mcp-service.mjs` 是工具服务；`server/editor-sessions.mjs` 是会话与命令队列；`src/components/McpPanel.tsx` 是页面桥接、授权和确认 UI。无需在浏览器暴露 window 调试对象，也无需执行任意 JavaScript。

SDK 和协议依据：[官方 TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)、[MCP 工具规范](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)。

详见 [坐标与资源核对记录](docs/calibration-engine-notes.md)。
