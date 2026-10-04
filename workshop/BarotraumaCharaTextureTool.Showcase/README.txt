Barotrauma Chara Texture Tool
贴图标定工具 · 工坊展示 / 下载指引

项目主页 / Source and setup:
https://github.com/tomTom1010EEE/Bratrauma-texture-tool

这个工坊包只用于介绍独立工具，不包含工具运行程序。
订阅或启用它不会在游戏里增加编辑器、物品或技能，不需要加入联机 Mod 列表。
包内没有 Lua/C# 脚本，也不会自动下载或运行外部程序。

实际工具的功能：
• 图集框选、origin、主贴图及服装衣片缩放。
• 单/双手握点、枪口/工具作用点、静态和瞄准持握实时预览。
• 近战准备/挥击目标姿态、服装多衣片、穿戴＋持握复合装备。
• ItemContainer / Containable 配件挂点和装配联动。
• 标定 XML / 工程导出，本地开发 Mod 的坐标白名单回写。
• 可选的本地 stdio MCP 服务；日常标定不需要 AI 客户端。

使用方法：
1. 打开上述 GitHub 项目，使用 Code → Download ZIP，或 git clone。
2. 当前是 v0.4.0 源码版，需要 Node.js 22.12+ 和 pnpm。
3. 在项目目录运行 pnpm install --frozen-lockfile、pnpm build、pnpm start。
4. 浏览器打开 http://127.0.0.1:4317 。安装依赖后 Windows 可使用 start.cmd。
5. 按项目 README 配置游戏和创意工坊路径，并连接本地素材目录。
6. 人物参照需要自行安装木卫二萌化计划 / EA-HI（2809175631）。
   https://steamcommunity.com/sharedfiles/filedetails/?id=2809175631

注意事项：
• 不包含或重新分发 EA-HI、Empire Arms、DDA、九州或原版美术素材。
• 工坊 / WorkshopMods/Installed 来源只读；仅核验过的 LocalMods 可写回。
• 回写须确认，生成备份；不回写伤害、配方、StatusEffect 或脚本。
• 预览是静态 IK / 目标姿态，不模拟完整游戏物理和任意 Mod Lua/C# 行为。
• 导出的 XML 是标定模板，不是可覆盖完整物品配置的完整 Mod。
• 项目沿用仓库中的 AGPL-3.0 许可证，其他作者内容保持各自授权。
• 非官方工具，与 FakeFish / Undertow / Steam 无隶属关系。

ENGLISH
This Workshop item is an informational showcase, NOT an in-game editor or installer.
Subscribing does not install Node.js or launch the external application. No scripts,
gameplay changes, third-party textures, or automatic downloads are included.
Use the GitHub README to set up the source release. EA-HI character assets must be
installed separately on your own computer. Preview is static IK, not game physics.

维护者 / Maintainer: tomTom1010EEE
工具版本 / Tool version: 0.4.0
