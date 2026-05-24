package meeting

import "encoding/json"

const (
	EventWelcome       = "welcome"
	EventJoinRoom      = "join-room"
	EventLeaveRoom     = "leave-room"
	EventPeerJoined    = "peer-joined"
	EventPeerLeft      = "peer-left"
	EventParticipants  = "participants"
	EventOffer         = "offer"
	EventAnswer        = "answer"
	EventICECandidate  = "ice-candidate"
	EventMuteChanged   = "mute-changed"
	EventHandRaised    = "hand-raised"
	EventScreenStarted = "screen-share-started"
	EventScreenStopped = "screen-share-stopped"
	EventChatMessage   = "chat-message"
	EventError         = "error"
)

type SignalMessage struct {
	Type      string          `json:"type"`
	RoomID    string          `json:"roomId,omitempty"`
	From      string          `json:"from,omitempty"`
	To        string          `json:"to,omitempty"`
	RequestID string          `json:"requestId,omitempty"`
	Data      json.RawMessage `json:"data,omitempty"`
}

type ErrorPayload struct {
	Message string `json:"message"`
}
