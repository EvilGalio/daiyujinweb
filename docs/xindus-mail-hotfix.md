# 4U 与 X IND 后台站点设置稳定版修复

此分支从 API 服务器确认的稳定提交 `77ccdc49e3ba0140915c995b37379e95873bf2b7` 建立，分支名为 `codex/xindus-mail-77ccdc4`。它添加 4U 与 X IND 在线报价的站点识别、邮件设置和管理入口，配置可以直接在现有管理后台保存。

X IND 内部通知收件人为 `johnson@x-indus.com`，通知默认启用，回复地址仍是客户填写的邮箱。原来的四个站点继续使用各自现有设置。已有的 X IND 数据库配置不会被默认值覆盖，部署时应在后台核对并保存实际需要的设置。

4U 对应 `4umachining.com` 和 `www.4umachining.com`，默认水印为 `4U MACHINING`，联系链接为 `https://4umachining.com/contact/`。其通知开关和默认收件人沿用原服务器环境规则，实际收件人由管理员确认后保存，不自动指定新邮箱。已有站点配置均保留。

## 已部署修复分支：通过后台配置

在实际 API 电脑暂停 API 和独立管理后台进程，项目目录执行：

```powershell
git branch --show-current
git pull --ff-only origin codex/xindus-mail-77ccdc4
```

第一条应显示 `codex/xindus-mail-77ccdc4`；若不是，先核对当前分支，不要直接执行第二条。此次更新不修改 `run-api.ps1`，服务器本地 CORS 修改可以保留。确认原有域名名单包含 `https://4umachining.com`、`https://www.4umachining.com`、`https://x-indus.com` 和 `https://www.x-indus.com`。

按之前正常运行的方式分别重新启动 API 和管理后台。在 API 电脑打开 `http://127.0.0.1:5010/admin`，按 Ctrl+F5 刷新，进入“系统设置”，即可选择“4U Machining”或“X IND MFG”。

在所选站点的“邮件通知”中，先填写“收件邮箱”并点击旁边“保存”，再打开“启用报价邮件通知”。X IND 收件人使用 `johnson@x-indus.com`；4U 填写实际需要的邮箱。开关自动保存，其他输入框逐项点击“保存”。SMTP 主机、端口、登录账号和发件邮箱使用现有能正常发信的站点配置；新站点若显示空白，应在后台补齐这些字段。SMTP 密码继续使用 API 服务器现有 `SMTP_PASSWORD`，不在后台设置，因此切换站点不等于切换独立的 SMTP 密码。

同一页面也可以分别修改两站的联系链接、页面文案、表单规则、水印和缩略图设置。保存后对后续请求生效，无需再次运行邮件配置脚本或重启；已打开的报价页面需刷新。切换到其他站点再切回来，可核对保存结果。不要在后台修改 X IND 收件人后又重复运行固定收件人的配置脚本。

最后在对应报价页面填写客户姓名和邮箱，完成一次成功报价，检查实际收件。重复使用同一客户邮箱仍遵循后台设置的发送间隔，默认 30 分钟。

原报价计算和 SMTP 发送服务保持原版本。这次接入的是在线报价计算成功后的内部通知；没有改变其他表单或正式报价请求端点的行为。

## 与稳定版本的差异

- `backend/app.py`：识别 `4u`、`xindus` 和各自精确域名，已知来源决定站点，防止请求参数将邮件路由到其他站点。
- `backend/services/settings.py`：注册两站的网址、品牌和私有邮件设置；公共设置按全局、默认站点、当前站点依次覆盖，修复 4U 设置被默认站点覆盖的问题。
- `backend/static/admin/admin.js`：添加两站设置选项卡，忽略快速切换后返回的旧站点响应。
- `backend/scripts/configure_xindus_quote_email.py`：使用现有 SQLite 数据库，事务内只配置 X IND 收件人和通知开关，并写入审计记录；不执行数据库初始化或结构迁移。
- 配套回归测试验证路由、模拟 SMTP、原站点设置保留及配置脚本事务行为。

此分支不升级 Python 或依赖，不改变运行账户、ACL、worker、数据库模型、生产环境校验或现有启动流程。基线之后的安全性更新不在本分支历史中。

`run-api.ps1` 与稳定提交的版本完全一致，服务器自行维护的 CORS 修改应保留在本地。请确认其实际 `ALLOWED_ORIGINS` 包含 `https://x-indus.com` 和 `https://www.x-indus.com`。旧启动脚本会覆盖 .env 中的域名名单，因此应检查实际启动脚本或实际启动配置。测试中的 X IND CORS 名单显式模拟这一服务器配置，不代表仓库默认名单已经包含这些域名。

## API 电脑部署

在实际 API 项目根目录操作，先确认当前提交和工作区：

```powershell
git rev-parse HEAD
git status --short
```

首次部署时 HEAD 应为上述稳定提交。如果有未提交修改，先保留并核对这些修改，尤其是曾为恢复启动而调整的文件。不要强制重置、覆盖冲突或自动清理文件。建议部署前记录原分支名称，并使用该服务器现有的备份方式备份数据库。

如果唯一改动是服务器的 `run-api.ps1` CORS 配置，重新 fetch 本分支最新版本后即可直接切换；本分支最终版本的该文件与稳定基线相同，Git 会保留本地修改。无需 stash、restore 或覆盖该文件。如果还有其他文件冲突，停止并先核对差异。

暂停旧 API 后，获取独立修复分支并切换：

```powershell
git fetch origin codex/xindus-mail-77ccdc4
git switch --create codex/xindus-mail-77ccdc4 --track origin/codex/xindus-mail-77ccdc4
```

这条创建命令供首次部署使用；若同名分支已存在，请先确认它的内容，不要用强制创建覆盖。不要拉取 main，也不要运行会更新其他分支、安装依赖或初始化数据库的全量更新脚本。

优先按上面的后台步骤配置。也可以使用以下命令直接配置真实数据库中的 X IND 收件人和通知开关；这是可选方式，不必与后台配置重复执行。以下示例使用项目虚拟环境；如果 API 使用另一处 Python，请将第一段路径换成当前能够正常启动 API 的 Python 路径。无需安装新依赖。

```powershell
& ".\.venv\Scripts\python.exe" ".\backend\scripts\configure_xindus_quote_email.py" --database ".\backend\data\daiyujin.db" --apply
```

该数据库路径与本稳定版 `run-api.ps1` 的设置一致。如果实际服务使用自定义启动方式和其他数据库，必须改为实际路径。配置脚本要求数据库已经存在。不要把开发电脑的数据库、.env 或 SMTP 凭据覆盖到服务器。

然后通过服务器目前能够正常运行的方式启动 API。SMTP 发件账户继续使用服务器原有配置；保留服务器原有 CORS 域名，并确认两个 X IND 域名已经加入实际启动配置。

## 验证与回退

```powershell
$result = Invoke-RestMethod -Uri "https://api.daiyujin.dpdns.org/api/public/settings?tool=quote&site=xindus" -Headers @{ Origin = "https://x-indus.com" }
$result.site
```

应返回 `xindus`，正式报价链接应为 `https://x-indus.com/get-a-quote/`。再在 `https://x-indus.com/online-ai-quote/` 完成一次带有效客户信息的报价，核对邮件日志和 `johnson@x-indus.com` 实际收件。重复使用同一客户邮箱仍遵循原有邮件节流设置。

若需回退，暂停 API，切回部署前记录的稳定分支并沿用原方式启动。不要使用 `git reset --hard` 覆盖服务器修改。本修复没有数据库结构变化，两项私有 X IND 设置有审计记录，可在后台单独禁用。

本地测试中的 SMTP 为模拟发送，不代表生产环境已实际投递。部署和收件仍需在 API 电脑及实际邮箱完成验证。
