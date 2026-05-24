package meeting

import (
	"encoding/json"
	"errors"
	"sync"
	"time"
)

var ErrParticipantNotFound = errors.New("participant not found")

type session struct {
	participant Participant
	send        chan SignalMessage
}

type Room struct {
	ID           string
	Title        string
	HostID       string
	Locked       bool
	CreatedAt    time.Time
	mu           sync.RWMutex
	participants map[string]*session
	chatHistory  []ChatMessage
}

const chatHistoryLimit = 100

func NewRoom(id, title, hostID string) *Room {
	return &Room{
		ID:           id,
		Title:        title,
		HostID:       hostID,
		CreatedAt:    time.Now().UTC(),
		participants: make(map[string]*session),
	}
}

func (r *Room) AddParticipant(p Participant) chan SignalMessage {
	r.mu.Lock()
	defer r.mu.Unlock()

	ch := make(chan SignalMessage, 16)
	r.participants[p.UserID] = &session{
		participant: p,
		send:        ch,
	}
	return ch
}

func (r *Room) RemoveParticipant(userID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	s, ok := r.participants[userID]
	if !ok {
		return false
	}
	delete(r.participants, userID)
	close(s.send)
	return true
}

func (r *Room) Participant(userID string) (Participant, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	s, ok := r.participants[userID]
	if !ok {
		return Participant{}, false
	}
	return s.participant, true
}

func (r *Room) UpdateParticipant(userID string, update func(*Participant)) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	s, ok := r.participants[userID]
	if !ok {
		return ErrParticipantNotFound
	}
	update(&s.participant)
	return nil
}

func (r *Room) SnapshotParticipants() []Participant {
	r.mu.RLock()
	defer r.mu.RUnlock()

	out := make([]Participant, 0, len(r.participants))
	for _, s := range r.participants {
		out = append(out, s.participant)
	}
	return out
}

func (r *Room) AppendChatMessage(message ChatMessage) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.chatHistory = append(r.chatHistory, message)
	if len(r.chatHistory) > chatHistoryLimit {
		r.chatHistory = append([]ChatMessage(nil), r.chatHistory[len(r.chatHistory)-chatHistoryLimit:]...)
	}
}

func (r *Room) ChatHistory() []ChatMessage {
	r.mu.RLock()
	defer r.mu.RUnlock()

	out := make([]ChatMessage, len(r.chatHistory))
	copy(out, r.chatHistory)
	return out
}

func (r *Room) Broadcast(msg SignalMessage, excludeUserID string) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	for userID, s := range r.participants {
		if userID == excludeUserID {
			continue
		}
		select {
		case s.send <- msg:
		default:
		}
	}
}

func (r *Room) SendTo(userID string, msg SignalMessage) error {
	r.mu.RLock()
	defer r.mu.RUnlock()

	s, ok := r.participants[userID]
	if !ok {
		return ErrParticipantNotFound
	}

	select {
	case s.send <- msg:
	default:
	}
	return nil
}

func MustJSON(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		return json.RawMessage(`{}`)
	}
	return b
}
