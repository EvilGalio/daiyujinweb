# X IND 询价邮件稳定版修复

此分支从 API 服务器确认的稳定提交 `77ccdc49e3ba0140915c995b37379e95873bf2b7` 建立，分支名为 `codex/xindus-mail-77ccdc4`。它仅添加 X IND 在线报价的站点识别、邮件设置和管理入口。

X IND 内部通知收件人为 `johnson@x-indus.com`，通知默认启用，回复地址仍是客户填写的邮箱。原来的四个站点继续使用各自现有设置。已有的 X IND 数据库配置不会被默认值覆盖，因此部署时应显式执行下面的配置命令。

原报价计算和 SMTP 发送服务保持原版本。这次接入的是在线报价计算成功后的内部通知；没有改变其他表单或正式报价请求端点的行为。

## 与稳定版本的差异

- `backend/app.py`：识别 `xindus` 和两个精确域名，已知来源决定站点，防止请求参数将邮件路由到其他站点。
- `backend/services/settings.py`：注册 X IND 的网址、品牌和私有邮件设置。
- `backend/static/admin/admin.js`：添加 X IND 设置选项卡。
- `run-api.ps1`：仅在原有 `ALLOWED_ORIGINS` 字符串末尾追加 `https://x-indus.com` 和 `https://www.x-indus.com`。旧脚本会覆盖该环境变量，因此这一行需要随代码更新。
- `backend/scripts/configure_xindus_quote_email.py`：使用现有 SQLite 数据库，事务内只配置 X IND 收件人和通知开关，并写入审计记录；不执行数据库初始化或结构迁移。
- 配套回归测试验证路由、模拟 SMTP、原站点设置保留及配置脚本事务行为。

此分支不升级 Python 或依赖，不改变运行账户、ACL、worker、数据库模型、生产环境校验或现有启动流程。基线之后的安全性更新不在本分支历史中。

## API 电脑部署

在实际 API 项目根目录操作，先确认当前提交和工作区：

```powershell
git rev-parse HEAD
git status --short
```

首次部署时 HEAD 应为上述稳定提交。如果有未提交修改，先保留并核对这些修改，尤其是曾为恢复启动而调整的文件。不要强制重置、覆盖冲突或自动清理文件。建议部署前记录原分支名称，并使用该服务器现有的备份方式备份数据库。

暂停旧 API 后，获取独立修复分支并切换：

```powershell
git fetch origin codex/xindus-mail-77ccdc4
git switch --create codex/xindus-mail-77ccdc4 --track origin/codex/xindus-mail-77ccdc4
```

这条创建命令供首次部署使用；若同名分支已存在，请先确认它的内容，不要用强制创建覆盖。不要拉取 main，也不要运行会更新其他分支、安装依赖或初始化数据库的全量更新脚本。

配置真实数据库。以下示例使用项目虚拟环境；如果 API 使用另一处 Python，请将第一段路径换成当前能够正常启动 API 的 Python 路径。无需安装新依赖。

```powershell
& ".\.venv\Scripts\python.exe" ".\backend\scripts\configure_xindus_quote_email.py" --database ".\backend\data\daiyujin.db" --apply
```

该数据库路径与本稳定版 `run-api.ps1` 的设置一致。如果实际服务使用自定义启动方式和其他数据库，必须改为实际路径。配置脚本要求数据库已经存在。不要把开发电脑的数据库、.env 或 SMTP 凭据覆盖到服务器。

然后通过服务器目前能够正常运行的方式启动 API。SMTP 发件账户继续使用服务器原有配置。如果不通过 `run-api.ps1` 启动，需在实际启动配置的原有 `ALLOWED_ORIGINS` 中追加 X IND 两个域名。

## 验证与回退

```powershell
$result = Invoke-RestMethod -Uri "https://api.daiyujin.dpdns.org/api/public/settings?tool=quote&site=xindus" -Headers @{ Origin = "https://x-indus.com" }
$result.site
```

应返回 `xindus`，正式报价链接应为 `https://x-indus.com/get-a-quote/`。再在 `https://x-indus.com/online-ai-quote/` 完成一次带有效客户信息的报价，核对邮件日志和 `johnson@x-indus.com` 实际收件。重复使用同一客户邮箱仍遵循原有邮件节流设置。

若需回退，暂停 API，切回部署前记录的稳定分支并沿用原方式启动。不要使用 `git reset --hard` 覆盖服务器修改。本修复没有数据库结构变化，两项私有 X IND 设置有审计记录，可在后台单独禁用。

本地测试中的 SMTP 为模拟发送，不代表生产环境已实际投递。部署和收件仍需在 API 电脑及实际邮箱完成验证。
