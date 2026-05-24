package meeting

import "time"

type ChatMessage struct {
	ID          string    `json:"id"`
	UserID      string    `json:"userId"`
	DisplayName string    `json:"displayName"`
	Text        string    `json:"text"`
	SentAt      time.Time `json:"sentAt"`
}
