package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"lanmeeting/internal/meeting"
	"lanmeeting/internal/transport"
)

type Server struct {
	addr string
	hub  *meeting.Hub
	http *http.Server
}

func NewServer(addr string) *Server {
	s := &Server{
		addr: addr,
		hub:  meeting.NewHub(),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.handleHealth)
	mux.HandleFunc("/api/rooms", s.handleCreateRoom)
	mux.HandleFunc("/api/rooms/", s.handleGetRoom)
	mux.HandleFunc("/ws", s.handleWebSocket)
	mux.Handle("/", s.staticHandler())

	s.http = &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	return s
}

func (s *Server) ListenAndServe() error {
	return s.http.ListenAndServe()
}

func (s *Server) Shutdown(ctx context.Context) error {
	return s.http.Shutdown(ctx)
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok",
		"addr":   s.addr,
	})
}

type createRoomRequest struct {
	Title  string `json:"title"`
	HostID string `json:"hostId"`
}

func (s *Server) handleCreateRoom(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req createRoomRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}
	if req.Title == "" {
		req.Title = "LAN Meeting"
	}
	if req.HostID == "" {
		writeError(w, http.StatusBadRequest, "hostId is required")
		return
	}

	room := s.hub.CreateRoom(req.Title, req.HostID)
	summary, _ := s.hub.RoomSummary(room.ID)
	writeJSON(w, http.StatusCreated, summary)
}

func (s *Server) handleGetRoom(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	roomID := r.PathValue("roomID")
	if roomID == "" {
		roomID = lastSegment(r.URL.Path)
	}
	if roomID == "" {
		writeError(w, http.StatusBadRequest, "room id is required")
		return
	}

	summary, err := s.hub.RoomSummary(roomID)
	if err != nil {
		writeError(w, http.StatusNotFound, "room not found")
		return
	}
	writeJSON(w, http.StatusOK, summary)
}

func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	roomID := r.URL.Query().Get("roomId")
	userID := r.URL.Query().Get("userId")
	name := r.URL.Query().Get("name")
	role := r.URL.Query().Get("role")
	if role == "" {
		role = "member"
	}

	if roomID == "" || userID == "" || name == "" {
		writeError(w, http.StatusBadRequest, "roomId, userId and name are required")
		return
	}

	room, ok := s.hub.GetRoom(roomID)
	if !ok {
		writeError(w, http.StatusNotFound, "room not found")
		return
	}

	conn, err := transport.Hijack(w, r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	defer conn.Close()

	p := meeting.Participant{
		UserID:      userID,
		DisplayName: name,
		Role:        role,
		JoinedAt:    time.Now().UTC(),
	}

	sendCh := room.AddParticipant(p)
	defer func() {
		if room.RemoveParticipant(userID) {
			room.Broadcast(meeting.SignalMessage{
				Type:   meeting.EventPeerLeft,
				RoomID: roomID,
				From:   userID,
				Data: meeting.MustJSON(map[string]string{
					"userId": userID,
				}),
			}, userID)
			s.broadcastParticipants(room)
			s.hub.DeleteRoomIfEmpty(roomID)
		}
	}()

	if err := conn.WriteJSON(meeting.SignalMessage{
		Type:   meeting.EventWelcome,
		RoomID: roomID,
		From:   "server",
		Data: meeting.MustJSON(map[string]any{
			"self":         p,
			"participants": room.SnapshotParticipants(),
			"messages":     room.ChatHistory(),
		}),
	}); err != nil {
		return
	}

	room.Broadcast(meeting.SignalMessage{
		Type:   meeting.EventPeerJoined,
		RoomID: roomID,
		From:   userID,
		Data:   meeting.MustJSON(p),
	}, userID)
	s.broadcastParticipants(room)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case msg, ok := <-sendCh:
				if !ok {
					return
				}
				if err := conn.WriteJSON(msg); err != nil {
					cancel()
					return
				}
			}
		}
	}()

	for {
		var msg meeting.SignalMessage
		if err := conn.ReadJSON(&msg); err != nil {
			if !errors.Is(err, io.EOF) {
				log.Printf("read message error: %v", err)
			}
			return
		}

		msg.RoomID = roomID
		msg.From = userID
		s.handleSignalMessage(room, p, msg)
	}
}

func (s *Server) handleSignalMessage(room *meeting.Room, sender meeting.Participant, msg meeting.SignalMessage) {
	switch msg.Type {
	case meeting.EventOffer, meeting.EventAnswer, meeting.EventICECandidate:
		if msg.To == "" {
			_ = room.SendTo(sender.UserID, meeting.SignalMessage{
				Type: meeting.EventError,
				From: "server",
				Data: meeting.MustJSON(meeting.ErrorPayload{Message: "target user is required"}),
			})
			return
		}
		if err := room.SendTo(msg.To, msg); err != nil {
			_ = room.SendTo(sender.UserID, meeting.SignalMessage{
				Type: meeting.EventError,
				From: "server",
				Data: meeting.MustJSON(meeting.ErrorPayload{Message: "target user not found"}),
			})
		}
	case meeting.EventMuteChanged:
		_ = room.UpdateParticipant(sender.UserID, func(p *meeting.Participant) {
			type mutePayload struct {
				AudioMuted bool `json:"audioMuted"`
				VideoMuted bool `json:"videoMuted"`
			}
			var payload mutePayload
			_ = json.Unmarshal(msg.Data, &payload)
			p.AudioMuted = payload.AudioMuted
			p.VideoMuted = payload.VideoMuted
		})
		room.Broadcast(msg, "")
		s.broadcastParticipants(room)
	case meeting.EventHandRaised:
		_ = room.UpdateParticipant(sender.UserID, func(p *meeting.Participant) {
			type handPayload struct {
				HandRaised bool `json:"handRaised"`
			}
			var payload handPayload
			_ = json.Unmarshal(msg.Data, &payload)
			p.HandRaised = payload.HandRaised
		})
		room.Broadcast(msg, "")
		s.broadcastParticipants(room)
	case meeting.EventScreenStarted:
		_ = room.UpdateParticipant(sender.UserID, func(p *meeting.Participant) {
			p.ScreenSharing = true
		})
		room.Broadcast(msg, "")
		s.broadcastParticipants(room)
	case meeting.EventScreenStopped:
		_ = room.UpdateParticipant(sender.UserID, func(p *meeting.Participant) {
			p.ScreenSharing = false
		})
		room.Broadcast(msg, "")
		s.broadcastParticipants(room)
	case meeting.EventChatMessage:
		type chatPayload struct {
			ID   string `json:"id"`
			Text string `json:"text"`
		}
		var payload chatPayload
		_ = json.Unmarshal(msg.Data, &payload)
		payload.Text = strings.TrimSpace(payload.Text)
		if payload.Text == "" {
			_ = room.SendTo(sender.UserID, meeting.SignalMessage{
				Type: meeting.EventError,
				From: "server",
				Data: meeting.MustJSON(meeting.ErrorPayload{Message: "chat message is empty"}),
			})
			return
		}
		if payload.ID == "" {
			payload.ID = time.Now().UTC().Format("20060102150405.000000000")
		}

		chatMessage := meeting.ChatMessage{
			ID:          payload.ID,
			UserID:      sender.UserID,
			DisplayName: sender.DisplayName,
			Text:        payload.Text,
			SentAt:      time.Now().UTC(),
		}
		room.AppendChatMessage(chatMessage)
		room.Broadcast(meeting.SignalMessage{
			Type:   meeting.EventChatMessage,
			RoomID: msg.RoomID,
			From:   sender.UserID,
			Data:   meeting.MustJSON(chatMessage),
		}, "")
	default:
		_ = room.SendTo(sender.UserID, meeting.SignalMessage{
			Type: meeting.EventError,
			From: "server",
			Data: meeting.MustJSON(meeting.ErrorPayload{Message: "unsupported message type"}),
		})
	}
}

func (s *Server) broadcastParticipants(room *meeting.Room) {
	room.Broadcast(meeting.SignalMessage{
		Type: meeting.EventParticipants,
		From: "server",
		Data: meeting.MustJSON(room.SnapshotParticipants()),
	}, "")
}

func (s *Server) staticHandler() http.Handler {
	webDir := filepath.Join(".", "web")
	fs := http.FileServer(http.Dir(webDir))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
		w.Header().Set("Pragma", "no-cache")
		w.Header().Set("Expires", "0")

		if isAPIRoute(r.URL.Path) {
			http.NotFound(w, r)
			return
		}

		cleanPath := path.Clean("/" + r.URL.Path)
		target := filepath.Join(webDir, filepath.FromSlash(cleanPath[1:]))
		if info, err := os.Stat(target); err == nil && !info.IsDir() {
			fs.ServeHTTP(w, r)
			return
		}

		http.ServeFile(w, r, filepath.Join(webDir, "index.html"))
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func lastSegment(path string) string {
	for len(path) > 0 && path[len(path)-1] == '/' {
		path = path[:len(path)-1]
	}
	for i := len(path) - 1; i >= 0; i-- {
		if path[i] == '/' {
			return path[i+1:]
		}
	}
	return path
}

func isAPIRoute(path string) bool {
	return path == "/ws" || path == "/healthz" || path == "/api/rooms" || hasPrefix(path, "/api/rooms/")
}

func hasPrefix(path, prefix string) bool {
	return len(path) >= len(prefix) && path[:len(prefix)] == prefix
}
