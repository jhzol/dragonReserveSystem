# 封面访问诊断：已启用

2026-09-08：`image-access-logging.caddy` 已用生产同版本 Caddy 2.6.2
完成语法转换与独立 loopback 进程实测；用户授权后已在生产启用。

## 生产启用记录

- 2026-09-08 执行配置备份、校验及 Caddy 平滑 reload，未重启后端。
- 备份：`/etc/caddy/Caddyfile.before-cover-diagnostics-20260908-193034`。
- 日志：`/var/log/caddy/cover-diagnostics.jsonl`。
- 配置 SHA-256：`84eb943faa945e514b9487cd3165ead508a0c968cad2abfa77694652cc7f488e`。
- 启用后健康检查 200，真实图片 GET 200、612791 字节，并确认写入 1 条访问日志。
- 实际日志字段：`duration, level, logger, msg, size, status, ts`，未包含请求或响应 headers。
- 未修改数据库、图片地址，未启用 COS/CDN。新增客户端阶段埋点仍需前端发布才能在线上生效。

## 范围和隐私

仅匹配 `/activity-cover-assets/*`、`/api/v2/activity-covers/*/glass-image`。
保留时间、状态码、响应字节数、处理耗时及 Caddy 固定元数据。
整个 request、响应 headers 和用户字段都被删除，不记录 IP、URI、查询参数、
Authorization、Cookie。固定 `msg` 是 Caddy 的 `handled request`，不是请求正文。
因此只能按时间窗口汇总，不能一对一识别某个用户/图片，也不能计算缓存命中率。

10 MiB 轮转、最多 3 个旧文件；72h 是旧文件的轮转保留策略，不是每条日志
严格到期删除的承诺。活动文件本身不会因时间自动清空。

## 启用流程（需线上变更确认）

1. 重读并另存当前 Caddyfile，记录校验值，防止覆盖并行修改。
2. 将片段插入既有站点块，保留代理、静态目录和响应头。
3. 确认日志目录仅允许 Caddy 服务用户写入；执行 `caddy validate`。
4. 使用 Caddy reload 平滑加载，不重启后端、不改数据库或图片。
5. 检查健康接口、真实封面 GET 和非图片请求；确认日志不含敏感字段。
6. 若验证失败，恢复先前配置并 reload；回滚前再次检查是否有并行变更。

## 解释边界

Caddy duration 表示服务端请求处理时间；size 是响应输出字节数。
不能据此证明手机收到所有字节、完成解码或屏幕已经绘制。
必须结合新版客户端 download/image_info/ready 阶段记录解释；不把统计上的
同时间异常误当作同一个请求。该日志不改变缓存或分发链路，不提供 CDN 加速。

## 配套前端修复验收（2026-09-08，尚未上传发布）

- 图片逻辑超时释放等待槽，但仍接受未被新尝试替代的迟到成功；页面销毁取消请求。
- 下载与本地图片信息处理分阶段记录；下载 API 失败时沿用原 getImageInfo 路径，不替换兜底图。
- 错误仅记录分类编号：1 域名配置、2 超时、3 取消、4 TLS、5 网络、6 其他；分类依据 SDK 文本，是线索而非根因证明。
- logger 保留到 cards[].coverPhases/glassPhases 的结构，避免序列化为字符串；继续限制深度、数组长度、字段数及离线队列体积。
- 首页实际使用外层 page-container（route-embedded），组件转发 afterleave 本身不足以修复该路径。关闭或创建成功后增加 400ms 关闭完成保护（原生动画 240ms），正常回调取消保护；重新打开不误关闭，隐藏页面不干扰其他页面 Tab。
- 前端 Node 测试 251/251 通过。诊断及 CDN 可选配置相关后端测试 8/8 通过，包括阶段数值经过真实 JS logger、离线保存、重启补传、FastAPI 接收后落日志的验证。
- 微信开发者工具实测：首页 11/11 卡片 ready；新建弹层打开时 Tab 隐藏，关闭后 visible=false、container=false、tabHidden=false；没有提交或创建活动。
- git diff --check 通过。尚未完成 V2183A 真机复测，不能据本地结果宣称已解决全部线上慢加载。
- 本轮正式生效仍需前端上传、审核及发布；现有后端接口可接收新增字段，无需为此部署后端。CDN 配置默认关闭，未开通付费服务。

## 2026-09-09：请求关联增强（已验证候选，尚未生产重载）

候选：`cover-request-correlation.caddy`；隔离回归：`validate-cover-request-correlation.py`。
生产核实仍是 Caddy 2.6.2，原配置 SHA-256 与上方 9 月 8 日启用记录一致。
旧版无 log_append，因此候选仅在图片路由上使用 map 提供惰性日志值，由现有
user_id 日志槽重命名为 request_id；不修改请求头、URL、响应或 upstream。
严格前置条件：站点没有 Caddy authentication，且没有其他 http.auth.user.id 消费者。
以后引入 Caddy 鉴权前必须移除此兼容桥接，改用原生自定义日志字段，不能把它当鉴权身份。
请求 ID 只接受既有 hm 格式的有界小写字母/数字串；无值、超长、带分隔符或其他字符均记录空串。
整个 request/resp_headers 仍在编码前删除，不放宽为记录全部请求头。

2026-09-09 同版本独立回环实例测试 12 个场景通过，9 条图片日志仅包含
时间、状态、字节数、耗时、request_id 及固定元数据。验证合法 ID、缺失/非法 ID、
查询参数及任意敏感请求/响应头不落盘，业务请求/响应保持原样，非图片请求不记录。
服务端测试证据：`/tmp/dragon-correlation-validation-6i88q8uw/result.json`。

候选配置 SHA-256：cb536305aee2adca136fbbff2c22a702d8ed21314057bbef9fe3a9dcbcbbb06d。
用户已明确授权本次网关诊断变更；实际部署调用在启动前被执行审批服务限流拒绝，
未执行部署脚本、未备份或替换生产配置、未 reload。不得把上传候选或隔离测试成功当成上线。
部署脚本另含原配置哈希保护、适配后路由差异检查、备份、平滑重载、真实图片字节校验及失败回滚；
这些生产步骤尚未运行，仍需在执行入口获准后完成。

### 2026-09-09 15:28：生产已启用并验收

用户再次确认后完成部署。两次部署前检查分别发现输入配置路径造成的自动 hide 字段差异、
健康检查误用 /health（实际 /api/v1/health）；均在写入生产前退出，修正后重新通过检查。
15:28:11（北京时间）完成备份、caddy validate、systemctl reload caddy；服务 active。
备份：`/etc/caddy/Caddyfile.before-cover-correlation-20260909-152811`。
线上新配置 SHA-256 与上述候选一致。路由与 upstream 等价检查通过。
健康接口、活动列表、原图和毛玻璃均 200；两种图片部署前后 SHA-256 完全相同。
两个服务器请求及一个本机公网请求均已通过 request_id 关联 Caddy 与 image_transfer，
状态及输出字节一致；本机公网原图 181705 B，总耗时约 547ms，不能代替受影响手机链路验收。
生产日志仍仅保留八个预期字段，不包含 request/resp_headers/IP/Cookie/URL query。
本地独立验收记录：`/tmp/dragon-correlation-production-verification.json`。
部署记录在服务端 `/tmp/dragon-cover-correlation-deploy-result.json`。
本轮只更改网关诊断，没有前端上传发布，也没有更改后端业务代码或数据库。
历史日志无法补回请求 ID；慢下载根因仍需启用后的真实慢样本与网关记录联合判断。
