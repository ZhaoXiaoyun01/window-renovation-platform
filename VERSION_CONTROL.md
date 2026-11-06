# GitHub 版本备份与恢复

本项目于 2026-11-06 建立首个 Git 基线：门窗业务/API **1.5**，3D 装修模块 **4.1**。源码备份不改变应用版本，也不补造此前版本的 Git 历史。

- 公开仓库：https://github.com/ZhaoXiaoyun01/window-renovation-platform
- 主分支：`main`
- 初始恢复标签：`v4.1.0`（同时包含门窗业务/API 1.5）

## 备份范围

Git 保存源码、依赖锁文件、测试、项目 Skill、维护文档、启动脚本和应用必需的视频来源索引。公开源码中包含当前演示模型的几何与默认配置。

`data/`（包括两个 SQLite 数据库、上传资料、模型/API 配置及订阅凭据）、原始图纸与截图、第三方全文下载、研究响应、运行日志、依赖目录、构建产物和本机配置均不上传。它们留在本地，不会随代码回退恢复。不要强制添加 `.gitignore` 排除的文件。

## 后续保存版本

在项目根目录执行以下命令。先检查差异和暂存清单，确认没有私人资料或密钥，再提交。业务更新时按项目约定递增对应应用版本；备份操作本身不改变业务版本。

```powershell
git status --short
git diff
git add .
git diff --cached --stat
git diff --cached
git commit -m "说明这次修改内容"
git push origin main
```

验证稳定后可创建新标签（使用未占用、与对应版本一致的标签名），再执行 `git push origin <标签名>`。本地提交不会自动上传；每次需确认 push 成功。

## 先保护本地业务数据

涉及升级或恢复时，先保存页面编辑、关闭页面，并在项目根目录停止服务；停止失败则先处理，不要继续复制正在写入的数据。停止成功后，将**整个 `data` 目录**复制到项目目录以外的受保护备份位置。数据库和上传原件应一起备份；不要上传到公开仓库。

```powershell
.\stop.cmd
.\status.cmd
```

账号密钥使用当前 Windows 用户的 DPAPI 加密。换电脑或 Windows 用户后，复制数据库也可能无法解密，需要重新配置或登录。浏览器中未保存的草稿不会随 Git 或 `data/` 备份自动恢复；先保存方案或导出草稿。

## 从 GitHub 恢复代码

推荐在新的相邻目录恢复，保留出错目录供排查。在项目的父目录执行：

```powershell
git clone --branch v4.1.0 https://github.com/ZhaoXiaoyun01/window-renovation-platform.git window-renovation-restore-4.1
cd window-renovation-restore-4.1
git switch -c recovery-4.1
.\setup.cmd
```

`setup.cmd` 需要 Python 3.10+、Node.js 22.19+、npm 和网络。它重新安装依赖并构建前端。确认命令成功后，在启动前决定使用空白数据还是已备份的 `data/`。需要恢复业务数据时，将备份复制到新目录的 `data/`；不要覆盖仍在运行的库。确认原服务已停止、8768 端口可用后执行：

```powershell
.\start.cmd
.\status.cmd
```

访问 `http://127.0.0.1:8768/` 和 `http://127.0.0.1:8768/renovation3d.html`，检查历史项目、装修方案、上传资料及模型配置。仅恢复源码不能修复数据损坏；未来旧代码是否兼容新数据库须单独确认。

## 验证与限制

2026-11-06 建立基线前实际运行：后端 84 项测试通过、装修前端 226 项测试通过、TypeScript 检查通过、独立目录生产构建通过（仍有超过 500KB 的分包提示）。191 个暂存文件约 2.35MB，路径检查未包含排除的数据/凭据/图像/下载；凭据模式命中经检查均为测试假值。两库、上传原件与原始图纸等 18 个受保护文件的 SHA-256 与操作前一致。本次未重新进行浏览器或真实模型账号验收。

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -q
cd app
npm.cmd run test:renovation
npm.cmd run typecheck:renovation
npm.cmd run build -- --configLoader runner
```

测试结果以当次实际输出为准。依赖锁文件约束 Node 依赖；Python 依赖目前使用版本范围，不保证未来安装得到完全相同的依赖版本。自动测试与构建通过不等于真实模型账号、图像识别或整套业务已经验收。
