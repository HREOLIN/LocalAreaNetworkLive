# 局域网会议项目设计方案

## 1. 项目目标

实现一个运行在局域网内的会议系统，优先满足以下场景：

- 企业/校园/实验室内网视频会议
- 同网段或可互通局域网环境下的低延迟音视频交流
- 支持创建房间、加入房间、成员上下线、静音/举手/共享屏幕等会议控制
- 后端优先采用 Go 实现，便于部署、并发处理和后续扩展

本仓库当前提供的是 **第一阶段基础版**：

- 提供房间管理
- 提供成员管理
- 提供 WebSocket 信令
- 为 WebRTC 音视频协商预留事件接口

也就是说，它已经是一个可作为前后端联调起点的会议后端骨架。

---

## 2. 总体架构建议

推荐采用下面的分层结构：

1. `Web/客户端层`
   - 浏览器前端（HTML/JS/React/Vue 均可）
   - 使用 WebRTC 采集摄像头、麦克风、屏幕
   - 使用 WebSocket 与 Go 服务端做信令交互

2. `信令层（Go）`
   - 创建会议房间
   - 用户加入/离开会议
   - 转发 WebRTC SDP Offer/Answer
   - 转发 ICE Candidate
   - 广播成员状态变化

3. `媒体层`
   - 第一版建议：P2P Mesh
   - 第二版建议：SFU（Selective Forwarding Unit）
   - 如果要做大房间（6 人以上稳定视频会议），建议尽早切换 SFU

4. `控制与管理层`
   - 主持人权限
   - 成员静音
   - 房间锁定
   - 会议录制（可后续增加）
   - 共享屏幕控制

---

## 3. 为什么优先选 Go

Go 适合这个项目，原因主要有：

- 并发模型简单，适合大量连接管理
- 内存占用和部署成本低
- 标准库对 HTTP 很友好
- 后续接入 WebRTC、TURN、日志、认证都比较顺手
- 适合做信令服务、网关服务、房间服务

---

## 4. 推荐的会议技术路线

### 阶段 1：局域网基础会议版

目标：快速做出可用版本。

- 前端：WebRTC + WebSocket
- 后端：Go 信令服务
- 媒体：浏览器之间 P2P 直连
- 适合人数：2 到 4 人

优点：

- 开发快
- 架构简单
- 局域网环境 NAT 问题较少

缺点：

- 多人会议时连接数指数增长
- 浏览器和终端压力明显上升

### 阶段 2：局域网稳定会议版

目标：支持中型会议。

- 后端增加 SFU
- 推荐使用 Pion WebRTC（Go 实现）
- 每个客户端只上行一份流，SFU 转发给其他参会者

适合人数：

- 5 到 20 人左右的会议室场景

优点：

- 稳定性更强
- 带宽和 CPU 压力更可控
- 更适合屏幕共享和发言人布局

---

## 5. 功能模块设计

### 5.1 房间管理

核心能力：

- 创建房间
- 加入房间
- 离开房间
- 查询房间成员
- 房间自动销毁（无人时）

建议数据结构：

- `Room`
  - `RoomID`
  - `Title`
  - `HostID`
  - `Participants`
  - `CreatedAt`
  - `Locked`

### 5.2 成员管理

成员信息建议包含：

- `UserID`
- `DisplayName`
- `Role`（host/member）
- `AudioMuted`
- `VideoMuted`
- `HandRaised`
- `JoinedAt`

### 5.3 信令管理

WebRTC 需要信令服务器完成协商，典型消息包括：

- `join-room`
- `leave-room`
- `peer-joined`
- `peer-left`
- `offer`
- `answer`
- `ice-candidate`
- `mute-changed`
- `hand-raised`
- `screen-share-started`
- `screen-share-stopped`

### 5.4 主持人控制

建议后续增加：

- 全员静音
- 移除成员
- 锁定会议
- 指定主讲人

### 5.5 局域网发现

如果希望会议系统更像“内网设备可见”：

- 可以增加 mDNS/广播发现入口页
- 或固定服务地址，例如：
  - `http://meeting.local:8080`
  - `http://192.168.1.10:8080`

---

## 6. 网络与部署建议

### 小规模部署

- 一台内网服务器运行 Go 服务
- 所有客户端通过浏览器访问
- 房间数据放内存即可

### 中规模部署

- Go 信令服务
- Redis 做房间状态共享
- SFU 独立部署
- Nginx 做反向代理

### HTTPS 建议

浏览器中的 WebRTC、摄像头、麦克风通常更推荐 HTTPS。

局域网开发阶段可以先：

- 本机 `localhost`
- 或内网 HTTPS 证书

---

## 7. 推荐的 Go 项目结构

```text
lanmeeting/
├─ cmd/
│  └─ server/
│     └─ main.go
├─ internal/
│  ├─ app/
│  │  └─ server.go
│  ├─ meeting/
│  │  ├─ hub.go
│  │  ├─ room.go
│  │  ├─ participant.go
│  │  └─ message.go
│  └─ transport/
│     └─ websocket.go
├─ web/
│  └─ index.html
├─ go.mod
└─ README.md
```

---

## 8. 当前仓库已实现内容

当前代码实现了一个基础 Go 信令服务，支持：

- HTTP 健康检查
- 静态会议页面首页
- 创建房间
- 查询房间
- WebSocket 加入房间
- 广播成员加入/离开
- 点对点转发 `offer/answer/ice-candidate`
- 广播状态类消息
- 浏览器本地音视频采集
- 浏览器端 P2P WebRTC 协商

这意味着你已经可以基于浏览器前端接入 WebRTC 做联调。

---

## 8.1 本地运行方式

启动服务：

```powershell
go run .\cmd\server
```

默认地址：

- `http://localhost:8080`

使用方式：

1. 打开首页
2. 输入昵称和用户 ID
3. 点击“创建会议”或填写房间号后“加入会议”
4. 允许浏览器访问摄像头和麦克风
5. 用另一台局域网设备访问同一地址测试多人会议

局域网访问示例：

- `http://192.168.1.10:8080`

说明：

- 当前是 P2P Mesh 方案，适合小规模局域网会议
- 浏览器调用摄像头/麦克风时，推荐使用 `localhost` 或局域网 HTTPS

---

## 9. 前后端交互流程

### 创建和加入会议

1. 前端调用 `POST /api/rooms` 创建房间
2. 前端建立 WebSocket：`/ws?roomId=xxx&userId=xxx&name=xxx`
3. 服务端将当前房间成员列表返回给新用户
4. 服务端通知其他成员有新用户加入

### WebRTC 协商

1. 新成员对房间内已有成员逐个创建 `RTCPeerConnection`
2. 发起端发送 `offer`
3. 服务端转发给目标成员
4. 目标成员返回 `answer`
5. 双方继续交换 `ice-candidate`
6. 建立音视频连接

---

## 10. 后续演进建议

推荐按下面顺序迭代：

1. 先完成前端基础页面
2. 接入浏览器音视频采集
3. 对接当前信令服务完成 1v1 / 1vN P2P
4. 增加屏幕共享
5. 增加主持人控制
6. 升级到 Pion SFU
7. 增加录制、会议纪要、权限认证

---

## 11. 关键技术选型建议

### 后端

- Go 1.22+
- 标准库 `net/http`
- WebSocket 建议后续使用 `github.com/gorilla/websocket`
- 若升级 SFU：`github.com/pion/webrtc/v4`

### 前端

- 原生 HTML/JS 可先跑通
- 或 React + TypeScript 构建正式版

### 存储

- 第一版：内存
- 第二版：Redis
- 第三版：MySQL/PostgreSQL 保存会议记录

---

## 12. 下一步建议

如果你准备继续推进，我建议下一步直接做这三件事：

1. 补一个浏览器前端页面
2. 接入真实 WebRTC 音视频
3. 将当前信令服务升级成 Gorilla WebSocket 版本

如果你愿意，我下一轮可以继续直接帮你补：

- `web/index.html` 的会议页面
- 前端 WebRTC 连接逻辑
- 或进一步改造成基于 Pion 的 SFU 版本
