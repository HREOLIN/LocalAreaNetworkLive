package meeting

import "time"

type Participant struct {
	UserID      string    `json:"userId"`
	DisplayName string    `json:"displayName"`
	Role        string    `json:"role"`
	AudioMuted  bool      `json:"audioMuted"`
	VideoMuted  bool      `json:"videoMuted"`
	HandRaised  bool      `json:"handRaised"`
	JoinedAt    time.Time `json:"joinedAt"`
}
