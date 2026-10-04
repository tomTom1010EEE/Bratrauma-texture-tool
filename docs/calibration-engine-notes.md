# 引擎坐标与本地资源核对

核对日期：2026-10-02。参考 FakeFishGames 公开源码与本机 Mod XML。静态变换复现，不嵌入游戏引擎；版本变化仍需在游戏内抽样验收。

## 坐标约定

设裁切框 `(sx, sy, w, h)`，归一化 origin `(ox, oy)`，图集点 `(px, py)`：

```text
local.x = px - sx - w * ox
local.y = h * oy - (py - sy)
```

图集 Y 向下；XML 物品局部坐标 Y 向上。origin 可以超出 0..1；增大 origin.y 会让贴图相对锚点上移。预览缩放只改变画布，不改变导出值。

| 参数 | 引擎变换 | 标定器处理 |
| --- | --- | --- |
| Holdable.handle1/2 | 局部值乘 Item.Scale | 输出未缩放贴图像素 |
| Item 主 Sprite | 绘制传入 Item.Scale | 主图缩放写入 Item，不输出无效的 Sprite.scale |
| HoldPos | 肩部 + R(torsoRotation + holdAngle × Dir) × (x × Dir,y) | 位置拖动反算该旋转，不乘 Item.Scale |
| AimPos | 肩部 + R(瞄准方向) × (x × Dir,y) | 瞄准角与物品额外角分开 |
| AimAngle | 仅额外影响物品旋转 | 不用它旋转 AimPos；握点随最终物品角旋转 |
| RangedWeapon.barrelpos | 局部值旋转后乘 Item.Scale | 与握点同坐标系 |
| RepairTool.barrelpos | 加 BarrelRotation 旋转，不乘 Item.Scale | 图集点击先乘 Item.Scale 再逆转 BarrelRotation |
| Containable.itempos | 有 Body 时按物品旋转平移，不乘 Item.Scale | 图集点击乘 Item.Scale |
| ItemContainer.itempos | 乘 Item.Scale | 手持物品预览；可挂墙容器的左上角修正暂不模拟 |
| Wearable sprite scale | inheritScale=false 时使用自身 scale | 与 Item.Scale 分离 |
| inheritScale=true | 自身 scale × TextureScale × 肢体 Scale × Ragdoll.LimbScale | 尊重三个 ignore…scale 标志 |
| inheritorigin | 继承肢体 Sprite.Origin 的**像素坐标** | 不直接复制归一化比例 |
| Joint anchor | anchor × joint.Scale × JointScale | 不再乘 LimbScale，避免关节距离二次缩小 |

ContainedSpriteDepth 的标准引擎读取位置是 **ItemContainer**。部分 Mod 将 depth / containedspritedepth 写在 Containable 上；本工具不把这些未经标准引擎读取的字段当作已生效属性。手动编辑的深度导出到片段的 ItemContainer。嵌套节点原路径保存在 JSON 及 XML 注释中，挂点片段需人工合入正确槽位。

## 本地资源

- EA-HI `2809175631`：`Content/Characters/Human/Human.xml` 与 `Ragdolls/HumanDefaultRagdoll.xml`，读取性别贴图、脸型、前发 Moustache / 后发 Beard。游戏原版人物结构为参照的分肢体模型，素材来自 EA-HI，而不是原版贴图。
- Empire Arms：实际 `em_wing_headset`、`mechagirl_basic`、`EM_accurate` 用于穿戴和枪械检查。源文件只读。
- 九州武库 Rebalance `3630177833`、九州前线 CQB 组合包 `3443540295`：ContainedSprite 的收纳状态、弹匣 / 握把 / 灯具 / 枪管 / 皮肤挂点的参考。`2852411866` 是 T.S.M MISSIONS，作为九州武库 `%ModDir:2852411866%` 的外部贴图依赖连接，不混称九州包。
- Deep-Diving-Armory `3159849099`：已找到 **0.5.188**，清单游戏版本 **1.13.4.0**。
  - 生效枪械例：`weapon/rifle/rifle_steel/ak47.xml`，Item.Scale=0.25，SwitchableRangedWeapon.barrelpos=241,24。
  - 同文件共 7 个显式 Containable.itempos，包括 SubContainer 内瞄具 `-14,16.5`、灯具和芯片。
  - `GunSmith/AR/Weapon/M4A1.xml` 有更多嵌套配件实例，但当前 filelist 未注册 GunSmith 目录，**不与生效武器混合导入**。
  - `Lua/Autorun/init.lua` 加载 `Lua/Scripts/BenzeneTechnology/AllSprite/AllSprite.lua`，头盔会按状态更改 SourceRect 与 RelativeOrigin；工具仅读取 XML 初始状态。

第三方美术资产不复制进项目，不发布；依赖开发者本机安装和各自授权。

## 第二阶段持握核对

核对 `AnimController.HoldItem`、`HandIK`、`CalculateArmLengths`、`Holdable.Update` 与客户端 `Item.GetHeldItemDepth`。本次查询时 AnimController.cs 最近提交为 `598966f200581caad47cd4c40f9f60673e8d34c5`（2025-12-08）；公开源码与本机游戏版本可能不完全一致。

- H1 对应右手，H2 对应左手；原 XML 未定义 H2 时导入复制 H1。编辑器导出明确的 H2，所以单手左手校准也能返回独立握点。
- 双手 HoldItem 的位置基准在右肩赋值之后被左肩覆盖；编辑器采用同样顺序，主物品绘制深度仍取右臂。左手单持取左臂，服从原 XML slots 并提示不允许的预览手。
- `aimpos=0,0` 不进入瞄准；`aimable=false` 在瞄准状态使用躯干方向；`usehandrotationforholdangle` 在非瞄准时不强制手臂 IK。零持握位置使用手的 PullPos 和 SpriteOrientation 决定物品位置、角度。
- 关节 anchor 仍只乘 JointScale × joint.Scale；PullPos 乘 LimbScale × limb.Scale。EA-HI 手部 PullPos=0，上臂 SpriteOrientation 继承图集的 180°。
- 引擎 HandIK 是带扭矩、阻尼和关节限制的动态目标，并假定双臂长度一致。这里使用各侧实际关节锚点构建保长二段 IK、沿用相同肘部弯曲方向，手与前臂同角；这能让可达握点闭合，同时避免纹理长度当作骨长。**不是逐步移植 Farseer 物理解算**：不模拟关节限位、身体碰撞、延迟、受伤或动作噪声；非共线锚点可能与游戏稳定解有小差异。
- 超出手臂长度时保持目标物品位置、限制手臂到可达范围，显示红色距离线。游戏的物品实际位置来自主手 PullJointWorldAnchorA 减握点，因此这种状态不能视为游戏内可达，需调位置、握点或缩放。
- 人物画布将朝向镜像放在整体坐标系外层；拖动先逆镜像、逆物品角，再除正确的缩放。衣片、主图原点支持越界值。缩放固定原点；不偷偷移动图像来补偿握点。
- DDA AK47 初始 holdpos=0,-23 / aimpos=45,50 / holdangle=170 是 XML 初始值，不假定它就是运行时的正常持枪姿态；九州亦有换弹期间的姿态改写。界面读取显式 setvalue=true 且以 This 为目标的姿态片段，可手动应用，不执行原 Mod。

## 源码依据

- [Holdable.cs](https://github.com/FakeFishGames/Barotrauma/blob/master/Barotrauma/BarotraumaShared/SharedSource/Items/Components/Holdable/Holdable.cs)：scaledHandlePos。
- [AnimController.cs](https://github.com/FakeFishGames/Barotrauma/blob/598966f200581caad47cd4c40f9f60673e8d34c5/Barotrauma/BarotraumaShared/SharedSource/Characters/Animation/AnimController.cs)：HoldItem、HandIK 与臂长。
- [客户端 Item.cs](https://github.com/FakeFishGames/Barotrauma/blob/master/Barotrauma/BarotraumaClient/ClientSource/Items/Item.cs)：主图 Item.Scale、持握深度、装饰图变换。
- [RangedWeapon.cs](https://github.com/FakeFishGames/Barotrauma/blob/master/Barotrauma/BarotraumaShared/SharedSource/Items/Components/Holdable/RangedWeapon.cs)：TransformedBarrelPos。
- [RepairTool.cs](https://github.com/FakeFishGames/Barotrauma/blob/master/Barotrauma/BarotraumaShared/SharedSource/Items/Components/Holdable/RepairTool.cs)：BarrelRotation / TransformedBarrelPos。
- [客户端 Limb.cs](https://github.com/FakeFishGames/Barotrauma/blob/master/Barotrauma/BarotraumaClient/ClientSource/Characters/Limb.cs)：CalculateDrawParameters、穿戴排序。
- [共享 Limb.cs](https://github.com/FakeFishGames/Barotrauma/blob/master/Barotrauma/BarotraumaShared/SharedSource/Characters/Limb.cs)：关节及肢体缩放。
- [Wearable.cs](https://github.com/FakeFishGames/Barotrauma/blob/master/Barotrauma/BarotraumaShared/SharedSource/Items/Components/Wearable.cs)：穿戴默认属性。
- [共享 ItemContainer.cs](https://github.com/FakeFishGames/Barotrauma/blob/master/Barotrauma/BarotraumaShared/SharedSource/Items/Components/ItemContainer.cs)：GetContainedPosition / SetContainedItemPositions。
- [客户端 ItemContainer.cs](https://github.com/FakeFishGames/Barotrauma/blob/master/Barotrauma/BarotraumaClient/ClientSource/Items/Components/ItemContainer.cs)：DrawContainedItems，配件自身 Scale、容器深度。

## 验证

`pnpm test` 覆盖图集坐标、超范围 origin、武器与工具枪口差异、工具旋转、容器坐标差异、关节闭合、继承规则、拖动反算、XML 转义 / 模板清理、JSON 输入校验。另对本机 EA-HI、Empire Arms 和 DDA 做真实资源集成检查；其他电脑缺少对应 Mod 时这些集成测试会明确跳过。

本机结果：15 项测试全部通过（含九州跨 Mod 贴图引用），生产构建成功。浏览器验收确认：翅膀拖动更新 origin 且可撤销；闪雷点选 H1 同步数值；下载的 XML 可重新解析；DDA AK47 可挂接 holographic_sight 并保留当前武器；正式构建加载人物 / 服装时控制台无警告和错误。HTTP 跨站请求返回 403。

第一阶段人物 / 服装、DDA 配件组装的验收截图保存在开发者本地，未随源码分发第三方素材或演示截图。第二阶段已实现静态持握联动，游戏内物理仍需开发者抽样验收。

第二阶段本机验收：28 项测试全部通过，生产构建成功。包括真实 EA-HI 单 / 双手、静态 / 瞄准和绑定 / 放松组合的关节闭合，真实 RepairTool、正反坐标变换、aimangle 解耦、单手 H2、越界距离和旧 JSON 兼容。浏览器实际验证了主图 holdpos 拖动、H1 拖动及整次撤销、主图 origin 和 Item.scale 回写、朝左时衣片 origin 反算、穿戴 scale 独立撤销、DDA 六个姿态片段的应用 / 撤销和 XML 下载。正式页面控制台无警告 / 错误。

第二阶段实时持握的本地验收：独立演示草稿中将闪雷 aimpos.X 改为 90 以展示双手均可达，未改原 Mod XML。默认项目草稿与测试草稿隔离。

## 坐标回写、近战和配件联动补充（2026-10-02）

### 安全回写

`server/saveback.mjs` 保存服务端的原始 XML、指纹、原 identifier 和图层 / 容器路径；前端不能借修改路径把补丁写到 StatusEffect 或其他物品。XML 词法跨度只定位真实元素属性，跳过注释 / CDATA / PI，校验前后 XML；不整体序列化。格式、脚本、子节点和其他物品保持原字节（仅允许无损 UTF-8）。新增属性只插入原开始标签，现有属性只替换值。共享容器深度单独提示，已有槽位深度数组不强行改写。

来源必须在真实 LocalMods/<Mod> 路径、有有效清单、XML 仍在该 Mod 内，并不是工坊 / Installed / 硬链接。导入、预览、提交分别检查；提交前复查文件指纹和目录，备份原文后用同目录临时文件原子替换。一个待确认方案绑定预览时的数据；随后改动前端不会暗中改变该方案。保存后重新导入取得下一轮基线。仅修改白名单坐标，结构性新增容器和配件自身源文件都不会随父武器写回。

### MeleeWeapon

核对 [MeleeWeapon.cs](https://github.com/FakeFishGames/Barotrauma/blob/master/Barotrauma/BarotraumaShared/SharedSource/Items/Components/Holdable/MeleeWeapon.cs) 与 [AnimController.HoldItem](https://github.com/FakeFishGames/Barotrauma/blob/master/Barotrauma/BarotraumaShared/SharedSource/Characters/Animation/AnimController.cs)。原预览将 MeleeWeapon 当成枪械，错误地以准星方向和 aimangle 求解。

近战准备传入 aim=false，hitPos 以 3 rad/s 增加到 45°：位置旋转为 torso + hitPos，物品还叠加 holdangle + hitPos + aimangle。不是普通枪械 aimpos 分支。挥击时 hitPos 以 15 rad/s 减少，低于 -π 结束；Swing=true 使用 SwingPos（已是物理单位，不走 HoldPos 的显示单位转换），物品额外旋转 holdangle。RequireAimToUse=false 不先蓄起 45°；Swing=false 使用普通持握位置。Reload 是冷却，不是挥击角速度。

画布反转 Y 和角度后实现这些目标变换，用保长 IK 展示手臂；不可达时将物品位置绑定主手实际握点，避免默认 SwingPos=2,0 让武器悬浮在 200 像素外。预览不实现扭矩、身体 SwingForce 冲量、关节限位和碰撞，不声称游戏内逐帧一致。动作进度和半速播放不写 XML；源攻击行为参数只读。

### DDA 配件

真实样本：`3159849099/weapon/rifle/rifle_steel/ak47.xml` 和 `weapon/sight/sight.xml`。AK47 的主容器存弹匣，SubContainer 分别存左右灯具、瞄具、芯片；同一个瞄具子容器的多个 Containable 是候选规则，不是三个独立槽。装配预览每组只选择一个，遵守 identifier/tag 与 excludedidentifiers；隐藏规则不自动装配。不执行 OnInserted 等状态效果。

引擎依据：[共享 ItemContainer](https://github.com/FakeFishGames/Barotrauma/blob/master/Barotrauma/BarotraumaShared/SharedSource/Items/Components/ItemContainer.cs)、[客户端 ItemContainer](https://github.com/FakeFishGames/Barotrauma/blob/master/Barotrauma/BarotraumaClient/ClientSource/Items/Components/ItemContainer.cs)。ItemContainer.itempos 乘父 Item.scale，Containable.itempos 则直接是显示像素。配件大小使用它自己的 Item.scale，旋转跟随父物品，并叠加非零 Containable.rotation（0 时回退到容器 itemrotation）。HideItems 默认 true；显式 hideitems=false 才显示。容器绘制深度读取顶层 containedspritedepth / containedspritedepths，而非 DDA 个别 Containable 上的同名属性。

自动选中匹配父物品 identifier/tag 的 ContainedSprite，否则使用 Sprite；静态装饰图跟随绘制。未知条件、动态脚本、容器网格间距和配件内部再嵌套容器不做完整仿真。配件 origin/scale 可在组装中试调，返回独立标定片段并保存在工程；原文件保存需单独导入配件，避免无意修改共享工坊资产。

本轮验证：43 项自动测试通过，包含真实 DDA / Empire Arms / EA-HI 资源、近战公式 / 主手约束、属性级补丁、注释脚本字节保持、备份恢复依据、外部修改冲突、目录链接 / 硬链接 / 工坊拦截，以及实际 HTTP 导入→差异→提交闭环和跨站拒绝。浏览器验收了夜煌准备 / 挥击 / 半速播放、真实源 XML 只生成一项缩放差异、DDA 自动四挂点装配、拖动瞄具 itempos 与单次撤销、匹配列表更换瞄具、工坊保存按钮禁用。实际写入仅使用隔离测试目录，没有更改用户真实 Mod 文件。

v0.3 正式版近战准备预览已在本地验收。该演示使用单独测试草稿，不替换用户日常工程。
