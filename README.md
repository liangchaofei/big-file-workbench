# big-file-workbench / 大文件上传测试工作台

React + Vite 前端，Node.js 原生 HTTP 后端。依赖已安装。

## 启动

```bash
cd /Users/curry/Desktop/demo/file-demo
npm run dev
```

打开 http://127.0.0.1:5173 。前端 5173，后端 3001，通过 Vite 代理访问 API。
若 5173 被占用，以终端打印的地址为准。Node 要求 22.12+。

生产方式：`npm run build` 后 `npm start`，打开 http://127.0.0.1:3001 。

## 手动上传测试

已生成文件：`test-files/upload-test-500MiB.pdf`，精确 524,288,000 字节（500 MiB，约 524.3 MB）。
这是结构完整、可正常打开的 PDF，含一页说明和内嵌测试数据，不依赖外网下载。

1. 选择“整文件上传”，上传上述 PDF，记录结果。
2. 切换“分片上传”，选择同一文件，使用默认 8 MiB / 3 并发上传。
3. 尝试修改分片大小和并发；暂停后继续，或刷新页面重新选择同一文件及相同分片大小恢复。
4. 导出 JSON 查看 SHA-256、字节数、哈希预计算耗时和上传/校验耗时。

已完成文件再次上传会真正重新传输；未完成任务会复用已保存分片。测试记录是成功记录，并非失败日志。
恢复只统计本次新传输字节的平均速度，恢复耗时也只代表本次操作，不宜和全新上传直接比较。
同一文件请在一个标签页测试，避免相互清理已完成任务。

这里没有预设浏览器通用上限。服务端默认允许 16 GiB，可用环境变量修改：

```bash
MAX_FILE_SIZE=34359738368 npm run dev
```

默认分片 8 MiB，范围 1–64 MiB；并发 1–6。服务端允许最多 100000 个分片。
整文件模式直接发送 File；分片模式发送 File.slice()。Worker 每次读取 8 MiB 增量计算 SHA-256，服务端流式写盘和合并。
哈希预计算与传输/合并分开计时；同一文件在当前页面重用已计算哈希时，预计算耗时接近零。

## 存储与清理

- `data/chunks/`：未完成分片及任务元数据。
- `data/files/`：上传后合并的文件，以任务 ID 命名，可从结果列表下载。
- 已成功合并的分片自动清理；未完成分片和已上传文件不会自动过期。
- 停止服务后，可删除 `data/` 清空全部上传产物；保留 `test-files/` 就能继续手动测试。
- 分片合并过程中峰值磁盘占用约为文件大小的两倍，另加原文件占用。

生成其他大小稀疏二进制测试文件（参数 MiB）：

```bash
node scripts/generate-file.js 1024
node scripts/generate-file.js 4096
```

不要在浏览器里用一个超大 ArrayBuffer 构造测试文件，否则测到的可能是内存分配限制。

## 验证与可选自动测试

初始后端集成测试已通过，前端已完成生产构建。按用户要求，未继续进行浏览器容量测试，因此没有浏览器最大成功大小结论。
本环境启动自动化 Chrome 进程失败；该启动失败不代表上传失败。

如以后需要自行运行：

```bash
npm test
npm run build
npm run test:browser
```

浏览器脚本使用本机 Chrome。可通过 `BROWSER_EXECUTABLE` 指定浏览器二进制；默认测试 100 MiB、1 GiB、2 GiB+1 字节、4 GiB+1 字节的两种模式，并验证暂停/刷新恢复。
用 `TEST_SIZES=104857600` 可只测 100 MiB；结果写入 `browser-test-report.json`。脚本会清理自己创建的文件，不操作 `data/` 和 `test-files/`。

## API

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/config` | 查询服务端大小限制 |
| POST | `/api/uploads` | `{name,size,chunkSize,sha256}` 创建或恢复任务 |
| GET | `/api/uploads/:id` | 查询已上传分片 |
| PUT | `/api/uploads/:id/chunks/:index` | 原始分片二进制 |
| POST | `/api/uploads/:id/complete` | 合并并校验大小和 SHA-256 |
| DELETE | `/api/uploads/:id` | 删除该任务、分片与合并文件 |
| POST | `/api/raw?name=...&size=...&sha256=...` | 整文件流式上传 |
| GET | `/api/files/:id` | 下载文件 |

该项目面向本地单进程实验，服务绑定 127.0.0.1，无账号系统。


## Vercel 云端部署（私有 Blob）

云端与本地使用不同存储适配器：本地仍是 Node 流式落盘；Vercel 使用浏览器直传 Blob，Vercel Functions 只做口令校验、签发短期上传凭证、查询大小和签发下载 URL，不接收文件二进制。

1. 将 GitHub 仓库导入 Vercel，Framework 选择 Vite（配置已包含在 vercel.json）。
2. 在项目 Storage 中创建 **Private Blob**，连接 Production 和 Preview，并勾选添加 read-write token；确保环境变量名为 `BLOB_READ_WRITE_TOKEN`。
3. 在项目 Environment Variables 设置 `UPLOAD_PASSWORD`，作为网页上的上传口令。不要将令牌或口令放入 `VITE_` 变量或提交到 Git。
4. 可选 `MAX_FILE_SIZE`，云端默认 1 GiB，支持当前 500 MiB 测试 PDF。
5. 重新部署后输入口令即可上传。

云端分片可选 8/16/32/64 MiB，1–6 并发；通过 SDK 直接发送到 Blob。断点保存在当前标签页的 sessionStorage，刷新后重新选择同一文件及分片大小可恢复，24 小时内有效；关闭标签页后不能恢复。整文件模式不做断点恢复。完成后再次上传会创建新对象，原有对象仍保留；请在 Blob 控制台清理测试产物。

云端只核对存储文件大小，SHA-256 是 Worker 在本地计算的源文件摘要，**不代表已进行云端 SHA-256 比对**。本地模式仍提供完整哈希比对。私有文件下载使用 1 小时有效签名 URL，点击历史记录会用当前口令重新签发；导出的 JSON 中签名 URL 也有这个有效期。

上传口令只用于该测试工作台的访问控制，保存在当前标签页 sessionStorage。不要把口令分享给无关人员。Blob 的存储和传输消耗你自己的 Vercel 配额。

忽略提交和部署的目录：`test-files/`、`data/`、`work/`、`node_modules/`、`.env*`（仅 `.env.example` 会提交）。
