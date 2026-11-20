# 洛阳公服

玩家入口为 `https://111.229.171.148/`。2026 年 11 月 20 日已开放公网访问。HTTPS 首页及健康检查均已从公网验证。公服使用自己的账号、作品、住宅和交易存档。进入 AI 创作时，在游戏设置中连接个人可用的模型服务。

## 部署

在具备 Docker Engine 与 Compose v2 的服务器上，从仓库根目录执行 `docker compose up -d --build`。`web` 发布静态前端并代理 API，`api` 运行 Echo 和世界计算进程。`docker compose ps` 查看服务状态，`curl http://127.0.0.1/api/health` 检查本机服务。

公网注册与登录使用 HTTPS。放行 TCP 80 和 443，并在主机上以支持 IP 证书的 Certbot 执行以下命令。将 `ABWORLD_ACME_ROOT` 指向同一个 Webroot 目录。

```sh
sudo certbot certonly --webroot -w "$PWD/.acme" --ip-address 111.229.171.148 --preferred-profile shortlived --cert-name abworld-ip
docker compose -f compose.yaml -f compose.https.yaml up -d
```

为短期 IP 证书安排自动续期，续签成功后执行 `docker compose exec -T web nginx -s reload`。宿主机的证书目录由前端只读挂载。日常更新保留 `world-data` 命名卷，备份请在停止 API 后复制卷内容。

当前服务器已安装 `abworld-https.timer`。需要手动检查续期时可执行 `sudo systemctl start abworld-https.service` 立即签发和启用证书。使用 `sudo journalctl -u abworld-https.service -n 30` 查看结果。
