const els = {
  serviceStatus: document.getElementById("serviceStatus"),
  activeRoomId: document.getElementById("activeRoomId"),
  participantCount: document.getElementById("participantCount"),
  displayName: document.getElementById("displayName"),
  userId: document.getElementById("userId"),
  roomTitle: document.getElementById("roomTitle"),
  roomId: document.getElementById("roomId"),
  roomLink: document.getElementById("roomLink"),
  createRoomBtn: document.getElementById("createRoomBtn"),
  joinRoomBtn: document.getElementById("joinRoomBtn"),
  leaveRoomBtn: document.getElementById("leaveRoomBtn"),
  toggleAudioBtn: document.getElementById("toggleAudioBtn"),
  toggleVideoBtn: document.getElementById("toggleVideoBtn"),
  shareScreenBtn: document.getElementById("shareScreenBtn"),
  raiseHandBtn: document.getElementById("raiseHandBtn"),
  copyLinkBtn: document.getElementById("copyLinkBtn"),
  spawnGuestBtn: document.getElementById("spawnGuestBtn"),
  refreshRoomBtn: document.getElementById("refreshRoomBtn"),
  participantList: document.getElementById("participantList"),
  stageVideo: document.getElementById("stageVideo"),
  stageTitle: document.getElementById("stageTitle"),
  stageMeta: document.getElementById("stageMeta"),
  stageModeTag: document.getElementById("stageModeTag"),
  galleryHint: document.getElementById("galleryHint"),
  videoGrid: document.getElementById("videoGrid"),
  localVideo: document.getElementById("localVideo"),
  localShareTag: document.getElementById("localShareTag"),
  localRoleTag: document.getElementById("localRoleTag"),
  localMeta: document.getElementById("localMeta"),
  connectionState: document.getElementById("connectionState"),
  logOutput: document.getElementById("logOutput"),
  clearLogBtn: document.getElementById("clearLogBtn"),
  toast: document.getElementById("toast"),
};

const state = {
  roomId: "",
  role: "member",
  socket: null,
  localParticipant: null,
  participants: new Map(),
  peers: new Map(),
  remoteStreams: new Map(),
  localStream: null,
  cameraStream: null,
  screenStream: null,
  isScreenSharing: false,
  activeSharerId: "",
  handRaised: false,
  autoJoinRequested: false,
  refreshTimer: null,
};

const rtcConfig = {
  iceServers: [],
};

boot();

function boot() {
  seedDefaults();
  bindEvents();
  checkHealth();
  hydrateFromQuery();
  updateRoomLink();
  updateShareUI();
  renderParticipants();
  renderStage();
  scheduleAutoJoin();
}

function seedDefaults() {
  if (!els.displayName.value) {
    els.displayName.value = `用户${Math.floor(Math.random() * 900 + 100)}`;
  }
  if (!els.userId.value) {
    els.userId.value = `user-${crypto.randomUUID().slice(0, 8)}`;
  }
}

function bindEvents() {
  els.createRoomBtn.addEventListener("click", createRoom);
  els.joinRoomBtn.addEventListener("click", joinRoom);
  els.leaveRoomBtn.addEventListener("click", leaveRoom);
  els.toggleAudioBtn.addEventListener("click", toggleAudio);
  els.toggleVideoBtn.addEventListener("click", toggleVideo);
  els.shareScreenBtn.addEventListener("click", toggleScreenShare);
  els.raiseHandBtn.addEventListener("click", toggleHandRaise);
  els.copyLinkBtn.addEventListener("click", copyRoomLink);
  els.spawnGuestBtn.addEventListener("click", openGuestWindow);
  els.refreshRoomBtn.addEventListener("click", refreshRoom);
  els.clearLogBtn.addEventListener("click", () => {
    els.logOutput.textContent = "";
  });

  els.displayName.addEventListener("input", updateRoomLink);
  els.userId.addEventListener("input", updateRoomLink);
  els.roomId.addEventListener("input", updateRoomLink);

  window.addEventListener("beforeunload", leaveRoom);
}

async function checkHealth() {
  try {
    const response = await fetch("/healthz");
    if (!response.ok) {
      throw new Error("服务不可用");
    }
    els.serviceStatus.textContent = "在线";
  } catch (error) {
    els.serviceStatus.textContent = "不可用";
    log(`服务健康检查失败: ${error.message}`);
  }
}

function hydrateFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get("roomId");
  const name = params.get("name");
  const userId = params.get("userId");
  const autoJoin = params.get("autoJoin");

  if (roomId) {
    els.roomId.value = roomId;
  }
  if (name) {
    els.displayName.value = name;
  }
  if (userId) {
    els.userId.value = userId;
  }
  if (autoJoin === "1" && roomId) {
    state.autoJoinRequested = true;
  }
}

function scheduleAutoJoin() {
  if (!state.autoJoinRequested) {
    return;
  }
  window.setTimeout(async () => {
    if (state.socket) {
      return;
    }
    toast("检测到会议链接，正在自动加入...");
    await joinRoom();
  }, 150);
}

function getIdentity() {
  const displayName = els.displayName.value.trim();
  const userId = els.userId.value.trim();
  if (!displayName || !userId) {
    throw new Error("昵称和用户 ID 都不能为空");
  }
  return { displayName, userId };
}

async function createRoom() {
  try {
    const { userId } = getIdentity();
    const response = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: els.roomTitle.value.trim(),
        hostId: userId,
      }),
    });
    if (!response.ok) {
      throw new Error((await response.json()).error || "创建房间失败");
    }
    const room = await response.json();
    els.roomId.value = room.id;
    updateRoomLink();
    toast(`会议已创建，房间号 ${room.id}`);
    log(`房间已创建: ${room.id}`);
    await joinRoom();
  } catch (error) {
    toast(error.message, true);
    log(`创建会议失败: ${error.message}`);
  }
}

async function joinRoom() {
  try {
    if (state.socket) {
      toast("你已经在会议中了");
      return;
    }

    const identity = getIdentity();
    const roomId = els.roomId.value.trim();
    if (!roomId) {
      throw new Error("请输入房间 ID");
    }

    const summary = await fetchRoomSummary(roomId);
    state.role = summary.hostId === identity.userId ? "host" : "member";
    await ensureLocalMedia();
    openSocket(roomId, identity);
  } catch (error) {
    toast(error.message, true);
    log(`加入会议失败: ${error.message}`);
  }
}

async function fetchRoomSummary(roomId) {
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "房间不存在" }));
    throw new Error(payload.error || "房间不存在");
  }
  return response.json();
}

async function ensureLocalMedia() {
  if (state.localStream) {
    return state.localStream;
  }

  try {
    state.cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: { width: 1280, height: 720 },
    });
    state.localStream = state.cameraStream;
    els.localVideo.srcObject = state.localStream;
    els.localMeta.textContent = trackSummary(state.localStream);
    log("本地媒体采集成功");
  } catch (error) {
    state.cameraStream = new MediaStream();
    state.localStream = new MediaStream();
    els.localVideo.srcObject = null;
    els.localMeta.textContent = "未检测到可用摄像头或麦克风，当前以无媒体模式入会";
    els.toggleAudioBtn.disabled = true;
    els.toggleVideoBtn.disabled = true;
    toast("未检测到媒体设备，将以无音视频模式加入会议", true);
    log(`本地媒体采集失败，切换为无媒体模式: ${error.message}`);
  }

  renderStage();
  return state.localStream;
}

function openSocket(roomId, identity) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const query = new URLSearchParams({
    roomId,
    userId: identity.userId,
    name: identity.displayName,
    role: state.role,
  });
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws?${query.toString()}`);
  state.socket = socket;
  state.roomId = roomId;

  socket.addEventListener("open", () => {
    syncMeetingState();
    log(`WebSocket 已连接，加入房间 ${roomId}`);
  });

  socket.addEventListener("message", async (event) => {
    try {
      const message = JSON.parse(event.data);
      await handleSignal(message);
    } catch (error) {
      log(`解析消息失败: ${error.message}`);
    }
  });

  socket.addEventListener("close", () => {
    log("信令连接已关闭");
    cleanupSocketState();
  });

  socket.addEventListener("error", () => {
    toast("信令连接异常", true);
    log("WebSocket 发生异常");
  });
}

async function handleSignal(message) {
  switch (message.type) {
    case "welcome":
      await handleWelcome(message);
      break;
    case "peer-joined":
      await handlePeerJoined(message);
      break;
    case "peer-left":
      handlePeerLeft(message);
      break;
    case "offer":
      await handleOffer(message);
      break;
    case "answer":
      await handleAnswer(message);
      break;
    case "ice-candidate":
      await handleICECandidate(message);
      break;
    case "mute-changed":
      handleMuteChanged(message);
      break;
    case "hand-raised":
      handleHandRaised(message);
      break;
    case "screen-share-started":
      handleScreenShareStarted(message);
      break;
    case "screen-share-stopped":
      handleScreenShareStopped(message);
      break;
    case "error":
      handleServerError(message);
      break;
    default:
      log(`收到未处理消息: ${message.type}`);
  }
}

async function handleWelcome(message) {
  const payload = parsePayload(message.data);
  state.localParticipant = payload.self || null;
  state.participants.clear();
  for (const participant of payload.participants || []) {
    state.participants.set(participant.userId, participant);
  }

  updateLocalRole();
  updateRoomLink();
  renderParticipants();
  renderStage();
  toast(`已进入房间 ${message.roomId}`);

  const others = (payload.participants || []).filter(
    (participant) => participant.userId !== state.localParticipant.userId,
  );
  for (const participant of others) {
    await createOfferForParticipant(participant.userId);
  }
}

async function handlePeerJoined(message) {
  const participant = parsePayload(message.data);
  state.participants.set(participant.userId, participant);
  renderParticipants();
  renderStage();
  log(`${participant.displayName} 已加入会议`);
}

function handlePeerLeft(message) {
  const payload = parsePayload(message.data);
  const participant = state.participants.get(payload.userId);
  if (participant) {
    log(`${participant.displayName} 已离开会议`);
  }

  state.participants.delete(payload.userId);
  if (state.activeSharerId === payload.userId) {
    state.activeSharerId = "";
  }
  closePeer(payload.userId);
  removeRemoteTile(payload.userId);
  state.remoteStreams.delete(payload.userId);
  renderParticipants();
  renderStage();
}

async function handleOffer(message) {
  const pc = await ensurePeerConnection(message.from);
  const offer = parsePayload(message.data);
  await pc.setRemoteDescription(offer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  sendSignal("answer", {
    to: message.from,
    data: pc.localDescription,
  });
  log(`已响应 ${message.from} 的 offer`);
}

async function handleAnswer(message) {
  const pc = state.peers.get(message.from);
  if (!pc) {
    return;
  }
  const answer = parsePayload(message.data);
  await pc.setRemoteDescription(answer);
  log(`已接收 ${message.from} 的 answer`);
}

async function handleICECandidate(message) {
  const pc = await ensurePeerConnection(message.from);
  const candidate = parsePayload(message.data);
  if (candidate) {
    await pc.addIceCandidate(candidate);
  }
}

function handleMuteChanged(message) {
  const payload = parsePayload(message.data);
  const participant = state.participants.get(message.from);
  if (!participant) {
    return;
  }
  participant.audioMuted = !!payload.audioMuted;
  participant.videoMuted = !!payload.videoMuted;
  state.participants.set(message.from, participant);
  renderParticipants();
  renderStage();
}

function handleHandRaised(message) {
  const payload = parsePayload(message.data);
  const participant = state.participants.get(message.from);
  if (!participant) {
    return;
  }
  participant.handRaised = !!payload.handRaised;
  state.participants.set(message.from, participant);
  renderParticipants();
}

function handleScreenShareStarted(message) {
  const payload = parsePayload(message.data);
  state.activeSharerId = message.from;
  renderStage();
  const participant = state.participants.get(message.from);
  const name = participant ? participant.displayName : payload.displayName || message.from;
  log(`${name} 开始共享屏幕`);
}

function handleScreenShareStopped(message) {
  const payload = parsePayload(message.data);
  if (state.activeSharerId === message.from) {
    state.activeSharerId = "";
  }
  renderStage();
  const participant = state.participants.get(message.from);
  const name = participant ? participant.displayName : payload.userId || message.from;
  log(`${name} 停止共享屏幕`);
}

function handleServerError(message) {
  const payload = parsePayload(message.data);
  toast(payload.message || "服务端返回错误", true);
  log(`服务端错误: ${payload.message || "unknown error"}`);
}

async function createOfferForParticipant(userId) {
  const pc = await ensurePeerConnection(userId);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  sendSignal("offer", {
    to: userId,
    data: pc.localDescription,
  });
  log(`已向 ${userId} 发起 offer`);
}

async function ensurePeerConnection(userId) {
  const existing = state.peers.get(userId);
  if (existing) {
    ensureMediaTransceivers(existing);
    return existing;
  }

  const pc = new RTCPeerConnection(rtcConfig);
  state.peers.set(userId, pc);
  ensureMediaTransceivers(pc);
  await syncPeerSenders(pc);

  pc.addEventListener("icecandidate", (event) => {
    if (!event.candidate) {
      return;
    }
    sendSignal("ice-candidate", {
      to: userId,
      data: event.candidate,
    });
  });

  pc.addEventListener("track", (event) => {
    const stream = getOrCreateRemoteStream(userId, event);
    state.remoteStreams.set(userId, stream);
    upsertRemoteTile(userId, stream);
    renderStage();
    const participant = state.participants.get(userId);
    log(`收到 ${participant ? participant.displayName : userId} 的远端媒体流`);
  });

  pc.addEventListener("connectionstatechange", () => {
    const participant = state.participants.get(userId);
    log(`与 ${participant ? participant.displayName : userId} 的连接状态: ${pc.connectionState}`);
    if (pc.connectionState === "failed" || pc.connectionState === "closed") {
      removeRemoteTile(userId);
      state.remoteStreams.delete(userId);
      renderStage();
    }
  });

  return pc;
}

function ensureMediaTransceivers(pc) {
  if (typeof pc.addTransceiver !== "function" || typeof pc.getTransceivers !== "function") {
    return;
  }

  const transceivers = pc.getTransceivers();
  const hasAudio = transceivers.some((transceiver) => transceiver.receiver.track.kind === "audio");
  const hasVideo = transceivers.some((transceiver) => transceiver.receiver.track.kind === "video");

  if (!hasAudio) {
    pc.addTransceiver("audio", { direction: "sendrecv" });
  }
  if (!hasVideo) {
    pc.addTransceiver("video", { direction: "sendrecv" });
  }
}

function findSenderByKind(pc, kind) {
  if (typeof pc.getTransceivers === "function") {
    const transceiver = pc
      .getTransceivers()
      .find((item) => item.sender && item.receiver.track.kind === kind);
    if (transceiver) {
      return transceiver.sender;
    }
  }
  return pc.getSenders().find((sender) => sender.track && sender.track.kind === kind) || null;
}

function getOrCreateRemoteStream(userId, event) {
  const [existingStream] = event.streams || [];
  if (existingStream) {
    const cached = state.remoteStreams.get(userId);
    if (cached && cached.id === existingStream.id) {
      if (!cached.getTracks().some((track) => track.id === event.track.id)) {
        cached.addTrack(event.track);
      }
      return cached;
    }
    return existingStream;
  }

  let stream = state.remoteStreams.get(userId);
  if (!stream) {
    stream = new MediaStream();
  }
  if (!stream.getTracks().some((track) => track.id === event.track.id)) {
    stream.addTrack(event.track);
  }
  return stream;
}

async function syncPeerSenders(pc) {
  const videoTrack = state.localStream.getVideoTracks()[0] || null;
  const audioTrack = state.localStream.getAudioTracks()[0] || null;
  const tasks = [];

  const videoSender = findSenderByKind(pc, "video");
  if (videoSender) {
    tasks.push(videoSender.replaceTrack(videoTrack));
  } else if (videoTrack) {
    tasks.push(pc.addTrack(videoTrack, state.localStream));
  }

  const audioSender = findSenderByKind(pc, "audio");
  if (audioSender) {
    tasks.push(audioSender.replaceTrack(audioTrack));
  } else if (audioTrack) {
    tasks.push(pc.addTrack(audioTrack, state.localStream));
  }

  await Promise.all(tasks);
}

function sendSignal(type, { to = "", data = null } = {}) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    return;
  }
  state.socket.send(
    JSON.stringify({
      type,
      to,
      data,
    }),
  );
}

function syncMeetingState() {
  els.leaveRoomBtn.disabled = false;
  els.spawnGuestBtn.disabled = false;
  const hasAudio = state.localStream && state.localStream.getAudioTracks().length > 0;
  const hasVideo = state.localStream && state.localStream.getVideoTracks().length > 0;
  els.toggleAudioBtn.disabled = !hasAudio;
  els.toggleVideoBtn.disabled = !hasVideo;
  els.shareScreenBtn.disabled = !canShareScreen();
  els.raiseHandBtn.disabled = false;
  els.copyLinkBtn.disabled = false;
  els.refreshRoomBtn.disabled = false;
  els.activeRoomId.textContent = state.roomId;
  els.connectionState.textContent = "已连接";
  updateShareUI();
  updateRoomLink();
  renderStage();
  startRoomPolling();
}

async function leaveRoom() {
  stopScreenStreamOnly();
  if (state.socket) {
    const socket = state.socket;
    state.socket = null;
    try {
      socket.close();
    } catch (_) {
    }
  }

  for (const peer of state.peers.values()) {
    peer.close();
  }
  state.peers.clear();
  state.remoteStreams.clear();
  Array.from(document.querySelectorAll(".video-tile.remote")).forEach((node) => node.remove());

  cleanupSocketState();
  renderParticipants();
  renderStage();
}

function cleanupSocketState() {
  stopRoomPolling();
  state.socket = null;
  state.roomId = "";
  state.role = "member";
  state.localParticipant = null;
  state.participants.clear();
  state.screenStream = null;
  state.isScreenSharing = false;
  state.activeSharerId = "";
  state.handRaised = false;
  els.leaveRoomBtn.disabled = true;
  els.toggleAudioBtn.disabled = true;
  els.toggleVideoBtn.disabled = true;
  els.shareScreenBtn.disabled = true;
  els.raiseHandBtn.disabled = true;
  els.copyLinkBtn.disabled = true;
  els.spawnGuestBtn.disabled = true;
  els.refreshRoomBtn.disabled = true;
  els.activeRoomId.textContent = "未加入";
  els.participantCount.textContent = "0";
  els.connectionState.textContent = "未连接";
  els.localRoleTag.textContent = "未加入";
  updateRoomLink();
  updateShareUI();
}

async function refreshRoom() {
  if (!els.roomId.value.trim()) {
    return;
  }
  try {
    const summary = await fetchRoomSummary(els.roomId.value.trim());
    state.participants.clear();
    for (const participant of summary.participants || []) {
      state.participants.set(participant.userId, participant);
    }
    renderParticipants();
    syncRemoteTileLabels();
    renderStage();
    log("已刷新房间成员");
  } catch (error) {
    toast(error.message, true);
  }
}

function startRoomPolling() {
  stopRoomPolling();
  state.refreshTimer = window.setInterval(() => {
    if (state.socket && state.roomId) {
      refreshRoom();
    }
  }, 3000);
}

function stopRoomPolling() {
  if (state.refreshTimer) {
    window.clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }
}

function updateLocalRole() {
  els.localRoleTag.textContent = state.role === "host" ? "主持人" : "成员";
}

function updateRoomLink() {
  const roomId = state.roomId || els.roomId.value.trim();
  if (!roomId) {
    els.roomLink.value = "尚未生成";
    return;
  }
  els.roomLink.value = buildGuestURL({
    roomId,
    name: els.displayName.value.trim() || "会议成员",
    userId: els.userId.value.trim() || `user-${crypto.randomUUID().slice(0, 8)}`,
  });
}

async function copyRoomLink() {
  if (!state.roomId) {
    return;
  }
  await navigator.clipboard.writeText(els.roomLink.value);
  toast("会议链接已复制");
}

function openGuestWindow() {
  const roomId = state.roomId || els.roomId.value.trim();
  if (!roomId) {
    toast("请先创建或加入会议", true);
    return;
  }

  const suffix = Math.floor(Math.random() * 900 + 100);
  const url = buildGuestURL({
    roomId,
    name: `测试成员${suffix}`,
    userId: `guest-${crypto.randomUUID().slice(0, 8)}`,
  });
  const popup = window.open(url, "_blank", "noopener,noreferrer");
  if (!popup) {
    navigator.clipboard
      .writeText(url)
      .then(() => {
        toast("浏览器拦截了新窗口，测试分身链接已复制");
      })
      .catch(() => {
        toast("浏览器拦截了新窗口，请手动复制会议链接打开", true);
      });
    log(`浏览器拦截了测试分身窗口: ${url}`);
    return;
  }
  toast("测试分身已在新标签页打开");
  log("已打开测试分身页面");
}

function buildGuestURL({ roomId, name, userId }) {
  const url = new URL(window.location.origin);
  url.searchParams.set("roomId", roomId);
  url.searchParams.set("name", name);
  url.searchParams.set("userId", userId);
  url.searchParams.set("autoJoin", "1");
  return url.toString();
}

function renderParticipants() {
  const participants = Array.from(state.participants.values()).sort((a, b) =>
    a.joinedAt > b.joinedAt ? 1 : -1,
  );
  els.participantCount.textContent = String(participants.length);
  els.participantList.innerHTML = "";

  if (!participants.length) {
    const li = document.createElement("li");
    li.className = "empty-state";
    li.textContent = "当前还没有成员加入。";
    els.participantList.appendChild(li);
    return;
  }

  for (const participant of participants) {
    const li = document.createElement("li");
    li.className = "participant-item";
    li.innerHTML = `
      <div class="participant-top">
        <span class="participant-name">${escapeHTML(participant.displayName)}</span>
        <span class="participant-meta">${participant.role === "host" ? "主持人" : "成员"}</span>
      </div>
      <div class="participant-tags">
        ${participant.audioMuted ? '<span class="tag">麦克风关闭</span>' : ""}
        ${participant.videoMuted ? '<span class="tag">摄像头关闭</span>' : ""}
        ${participant.handRaised ? '<span class="tag">已举手</span>' : ""}
        ${
          state.localParticipant && participant.userId === state.localParticipant.userId
            ? '<span class="mini-tag">你自己</span>'
            : ""
        }
      </div>
      <div class="participant-meta">${escapeHTML(participant.userId)}</div>
    `;
    els.participantList.appendChild(li);
  }
}

function upsertRemoteTile(userId, stream) {
  const participant = state.participants.get(userId);
  let tile = document.getElementById(`remote-${userId}`);
  if (!tile) {
    tile = document.createElement("article");
    tile.className = "video-tile remote";
    tile.id = `remote-${userId}`;
    tile.innerHTML = `
      <div class="tile-head">
        <span class="remote-name"></span>
        <span class="mini-tag remote-role"></span>
      </div>
      <video autoplay playsinline></video>
      <div class="tile-meta remote-id"></div>
    `;
    els.videoGrid.appendChild(tile);
  }

  tile.querySelector(".remote-name").textContent = participant ? participant.displayName : userId;
  tile.querySelector(".remote-role").textContent =
    participant && participant.role === "host" ? "主持人" : "远端";
  tile.querySelector(".remote-id").textContent = participant ? participant.userId : userId;
  tile.querySelector("video").srcObject = stream;
}

function syncRemoteTileLabels() {
  for (const tile of Array.from(els.videoGrid.querySelectorAll(".video-tile.remote"))) {
    const userId = tile.id.replace("remote-", "");
    const participant = state.participants.get(userId);
    if (!participant) {
      continue;
    }
    const nameEl = tile.querySelector(".remote-name");
    const roleEl = tile.querySelector(".remote-role");
    const idEl = tile.querySelector(".remote-id");
    if (nameEl) {
      nameEl.textContent = participant.displayName;
    }
    if (roleEl) {
      roleEl.textContent = participant.role === "host" ? "主持人" : "远端";
    }
    if (idEl) {
      idEl.textContent = participant.userId;
    }
  }
}

function removeRemoteTile(userId) {
  const tile = document.getElementById(`remote-${userId}`);
  if (tile) {
    tile.remove();
  }
}

function closePeer(userId) {
  const pc = state.peers.get(userId);
  if (!pc) {
    return;
  }
  pc.close();
  state.peers.delete(userId);
}

function toggleAudio() {
  const targetStream = state.cameraStream || state.localStream;
  if (!targetStream || targetStream.getAudioTracks().length === 0) {
    return;
  }
  const enabled = toggleTracks(targetStream.getAudioTracks());
  els.toggleAudioBtn.textContent = enabled ? "关闭麦克风" : "打开麦克风";
  els.localMeta.textContent = localMetaText();
  sendMuteChanged();
}

function toggleVideo() {
  const targetStream = state.isScreenSharing ? state.screenStream : state.cameraStream;
  if (!targetStream || targetStream.getVideoTracks().length === 0) {
    return;
  }
  const enabled = toggleTracks(targetStream.getVideoTracks());
  els.toggleVideoBtn.textContent = enabled ? "关闭摄像头" : "打开摄像头";
  els.localMeta.textContent = localMetaText();
  sendMuteChanged();
  renderStage();
}

async function toggleScreenShare() {
  if (state.isScreenSharing) {
    await stopScreenShare();
    return;
  }

  try {
    if (!canShareScreen()) {
      throw new Error("当前浏览器不支持屏幕共享");
    }
    const screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });
    await startScreenShare(screenStream);
  } catch (error) {
    toast(error.message || "共享屏幕失败", true);
    log(`共享屏幕失败: ${error.message}`);
  }
}

async function startScreenShare(screenStream) {
  const screenVideoTrack = screenStream.getVideoTracks()[0];
  if (!screenVideoTrack) {
    throw new Error("未获取到桌面视频轨道");
  }

  state.screenStream = screenStream;
  state.isScreenSharing = true;
  state.activeSharerId = state.localParticipant ? state.localParticipant.userId : "";

  const audioTracks = [];
  if (state.cameraStream && state.cameraStream.getAudioTracks().length > 0) {
    audioTracks.push(...state.cameraStream.getAudioTracks());
  } else if (screenStream.getAudioTracks().length > 0) {
    audioTracks.push(...screenStream.getAudioTracks());
  }

  state.localStream = new MediaStream([...audioTracks, screenVideoTrack]);
  els.localVideo.srcObject = state.localStream;
  els.localMeta.textContent = localMetaText();
  els.toggleVideoBtn.textContent = "停止画面";

  screenVideoTrack.addEventListener("ended", () => {
    stopScreenShare();
  });

  await replaceOutgoingTracks({
    videoTrack: screenVideoTrack,
    audioTrack: audioTracks[0] || null,
  });
  await renegotiateAllPeers("screen-started");

  updateShareUI();
  renderStage();
  sendSignal("screen-share-started", {
    data: {
      userId: state.localParticipant ? state.localParticipant.userId : "",
      displayName: state.localParticipant ? state.localParticipant.displayName : "",
    },
  });
  sendMuteChanged();
  log("已开始共享桌面");
  toast("屏幕共享已开始");
}

async function stopScreenShare() {
  if (!state.isScreenSharing) {
    return;
  }

  state.isScreenSharing = false;
  if (state.localParticipant && state.activeSharerId === state.localParticipant.userId) {
    state.activeSharerId = "";
  }
  stopScreenStreamOnly();

  const fallback =
    state.cameraStream && state.cameraStream.getTracks().length > 0
      ? state.cameraStream
      : new MediaStream();
  state.localStream = fallback;
  els.localVideo.srcObject = fallback.getTracks().length > 0 ? fallback : null;
  els.localMeta.textContent = localMetaText();
  els.toggleVideoBtn.textContent = "关闭摄像头";

  const nextVideo = fallback.getVideoTracks()[0] || null;
  const nextAudio = fallback.getAudioTracks()[0] || null;
  await replaceOutgoingTracks({
    videoTrack: nextVideo,
    audioTrack: nextAudio,
  });
  await renegotiateAllPeers("screen-stopped");

  updateShareUI();
  renderStage();
  sendSignal("screen-share-stopped", {
    data: {
      userId: state.localParticipant ? state.localParticipant.userId : "",
    },
  });
  sendMuteChanged();
  log("已停止共享桌面");
  toast("屏幕共享已停止");
}

function stopScreenStreamOnly() {
  if (!state.screenStream) {
    return;
  }
  for (const track of state.screenStream.getTracks()) {
    track.stop();
  }
  state.screenStream = null;
}

async function replaceOutgoingTracks({ videoTrack, audioTrack }) {
  const tasks = [];
  for (const peer of state.peers.values()) {
    ensureMediaTransceivers(peer);
    const videoSender = findSenderByKind(peer, "video");
    const audioSender = findSenderByKind(peer, "audio");

    if (videoSender) {
      tasks.push(videoSender.replaceTrack(videoTrack));
    } else if (videoTrack) {
      tasks.push(peer.addTrack(videoTrack, state.localStream));
    }

    if (audioSender) {
      tasks.push(audioSender.replaceTrack(audioTrack));
    } else if (audioTrack) {
      tasks.push(peer.addTrack(audioTrack, state.localStream));
    }
  }
  await Promise.all(tasks);
}

async function renegotiateAllPeers(reason) {
  const tasks = [];
  for (const [userId, peer] of state.peers.entries()) {
    tasks.push(renegotiatePeer(userId, peer, reason));
  }
  await Promise.all(tasks);
}

async function renegotiatePeer(userId, pc, reason) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    return;
  }
  if (pc.signalingState !== "stable") {
    log(`跳过与 ${userId} 的重新协商，当前状态 ${pc.signalingState}`);
    return;
  }
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  sendSignal("offer", {
    to: userId,
    data: pc.localDescription,
  });
  log(`已向 ${userId} 发送重新协商 offer（${reason}）`);
}

function toggleTracks(tracks) {
  if (!tracks.length) {
    return false;
  }
  const nextEnabled = !tracks[0].enabled;
  for (const track of tracks) {
    track.enabled = nextEnabled;
  }
  return nextEnabled;
}

function sendMuteChanged() {
  const payload = {
    audioMuted:
      !state.localStream || state.localStream.getAudioTracks().length === 0
        ? true
        : state.localStream.getAudioTracks().every((track) => !track.enabled),
    videoMuted:
      !state.localStream || state.localStream.getVideoTracks().length === 0
        ? true
        : state.localStream.getVideoTracks().every((track) => !track.enabled),
  };

  if (state.localParticipant) {
    const updated = { ...state.localParticipant, ...payload };
    state.localParticipant = updated;
    state.participants.set(updated.userId, updated);
    renderParticipants();
    renderStage();
  }

  sendSignal("mute-changed", { data: payload });
}

function toggleHandRaise() {
  state.handRaised = !state.handRaised;
  els.raiseHandBtn.textContent = state.handRaised ? "放下手" : "举手";
  if (state.localParticipant) {
    state.localParticipant.handRaised = state.handRaised;
    state.participants.set(state.localParticipant.userId, state.localParticipant);
    renderParticipants();
  }
  sendSignal("hand-raised", { data: { handRaised: state.handRaised } });
}

function updateShareUI() {
  els.localShareTag.classList.toggle("hidden", !state.isScreenSharing);
  els.shareScreenBtn.textContent = state.isScreenSharing ? "停止共享" : "共享屏幕";
  if (!state.roomId) {
    els.shareScreenBtn.textContent = "共享屏幕";
  }
}

function renderStage() {
  const stage = pickStageSource();
  els.stageVideo.srcObject = stage.stream || null;
  els.stageTitle.textContent = stage.title;
  els.stageMeta.textContent = stage.meta;
  els.stageModeTag.textContent = stage.mode;
  els.galleryHint.textContent = stage.hint;
  renderGallery(stage.excludeUserId || "");
}

function pickStageSource() {
  if (state.activeSharerId) {
    if (
      state.localParticipant &&
      state.activeSharerId === state.localParticipant.userId &&
      state.localStream &&
      state.localStream.getVideoTracks().length > 0
    ) {
      return {
        stream: state.localStream,
        title: "主舞台",
        meta: "当前显示共享中的桌面",
        mode: "共享屏幕",
        hint: "其他成员画面保留在画廊中",
        excludeUserId: state.localParticipant.userId,
      };
    }

    const sharedStream = state.remoteStreams.get(state.activeSharerId);
    if (sharedStream) {
      const participant = state.participants.get(state.activeSharerId);
      return {
        stream: sharedStream,
        title: participant ? `${participant.displayName} 的共享画面` : "共享屏幕",
        meta: "当前显示共享中的桌面",
        mode: "共享屏幕",
        hint: "其他成员画面保留在画廊中",
        excludeUserId: state.activeSharerId,
      };
    }

    const participant = state.participants.get(state.activeSharerId);
    return {
      stream: null,
      title: participant ? `${participant.displayName} 正在共享` : "共享屏幕",
      meta: "已收到共享通知，正在等待屏幕流到达",
      mode: "缓冲中",
      hint: "屏幕流一旦协商完成，会优先显示在主舞台",
      excludeUserId: "",
    };
  }

  const host = Array.from(state.participants.values()).find((participant) => participant.role === "host");
  if (host) {
    if (
      state.localParticipant &&
      host.userId === state.localParticipant.userId &&
      state.localStream &&
      state.localStream.getVideoTracks().length > 0
    ) {
      return {
        stream: state.localStream,
        title: "主舞台",
        meta: "当前显示房主画面",
        mode: "主持人",
        hint: "共享屏幕会自动切到主舞台",
        excludeUserId: host.userId,
      };
    }

    const hostStream = state.remoteStreams.get(host.userId);
    if (hostStream) {
      return {
        stream: hostStream,
        title: `${host.displayName} 的画面`,
        meta: "当前显示房主画面",
        mode: "主持人",
        hint: "共享屏幕会自动切到主舞台",
        excludeUserId: host.userId,
      };
    }
  }

  return {
    stream: null,
    title: "主舞台",
    meta: "等待房主开启画面或共享屏幕",
    mode: "待机",
    hint: "成员开启视频或共享屏幕后，画面会自动显示在这里",
    excludeUserId: "",
  };
}

function renderGallery(excludeUserId) {
  for (const tile of Array.from(els.videoGrid.querySelectorAll(".video-tile.remote"))) {
    const userId = tile.id.replace("remote-", "");
    tile.classList.toggle("hidden", userId === excludeUserId);
  }

  const visibleTiles = Array.from(els.videoGrid.querySelectorAll(".video-tile.remote")).filter(
    (tile) => !tile.classList.contains("hidden"),
  );

  let empty = els.videoGrid.querySelector(".empty-gallery");
  if (!visibleTiles.length) {
    if (!empty) {
      empty = document.createElement("div");
      empty.className = "empty-gallery";
      els.videoGrid.appendChild(empty);
    }
    empty.textContent = state.roomId
      ? "其他成员的画面会显示在这里。"
      : "加入会议后，这里会显示其他参会者的画面。";
    return;
  }

  if (empty) {
    empty.remove();
  }
}

function canShareScreen() {
  return !!(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === "function");
}

function localMetaText() {
  if (state.isScreenSharing) {
    return `正在共享桌面 / ${trackSummary(state.localStream)}`;
  }
  return trackSummary(state.localStream);
}

function trackSummary(stream) {
  if (!stream || (!stream.getAudioTracks().length && !stream.getVideoTracks().length)) {
    return "无可用音视频设备";
  }
  const audioOn = stream.getAudioTracks().some((track) => track.enabled);
  const videoOn = stream.getVideoTracks().some((track) => track.enabled);
  return `${audioOn ? "麦克风开启" : "麦克风关闭"} / ${videoOn ? "摄像头开启" : "摄像头关闭"}`;
}

function log(message) {
  const timestamp = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  els.logOutput.textContent += `[${timestamp}] ${message}\n`;
  els.logOutput.scrollTop = els.logOutput.scrollHeight;
}

function toast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.style.color = isError ? "var(--danger)" : "var(--accent-warm)";
}

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parsePayload(payload) {
  if (!payload) {
    return {};
  }
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload);
    } catch (_) {
      return {};
    }
  }
  return payload;
}
