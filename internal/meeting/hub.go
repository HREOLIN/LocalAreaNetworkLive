package meeting

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"sync"
	"time"
)

var ErrRoomNotFound = errors.New("room not found")

type Hub struct {
	mu    sync.RWMutex
	rooms map[string]*Room
}

func NewHub() *Hub {
	return &Hub{
		rooms: make(map[string]*Room),
	}
}

func (h *Hub) CreateRoom(title, hostID string) *Room {
	h.mu.Lock()
	defer h.mu.Unlock()

	id := newID()
	room := NewRoom(id, title, hostID)
	h.rooms[id] = room
	return room
}

func (h *Hub) GetRoom(roomID string) (*Room, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	room, ok := h.rooms[roomID]
	return room, ok
}

func (h *Hub) DeleteRoomIfEmpty(roomID string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	room, ok := h.rooms[roomID]
	if !ok {
		return
	}
	if len(room.SnapshotParticipants()) == 0 {
		delete(h.rooms, roomID)
	}
}

type RoomSummary struct {
	ID           string        `json:"id"`
	Title        string        `json:"title"`
	HostID       string        `json:"hostId"`
	Locked       bool          `json:"locked"`
	CreatedAt    time.Time     `json:"createdAt"`
	Participants []Participant `json:"participants"`
}

func (h *Hub) RoomSummary(roomID string) (RoomSummary, error) {
	room, ok := h.GetRoom(roomID)
	if !ok {
		return RoomSummary{}, ErrRoomNotFound
	}
	return RoomSummary{
		ID:           room.ID,
		Title:        room.Title,
		HostID:       room.HostID,
		Locked:       room.Locked,
		CreatedAt:    room.CreatedAt,
		Participants: room.SnapshotParticipants(),
	}, nil
}

func newID() string {
	var b [6]byte
	if _, err := rand.Read(b[:]); err != nil {
		return time.Now().UTC().Format("20060102150405")
	}
	return hex.EncodeToString(b[:])
}
