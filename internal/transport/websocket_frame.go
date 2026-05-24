package transport

import (
	"bufio"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"io"
)

const wsMagicGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

func computeAcceptKey(key string) string {
	hash := sha1.Sum([]byte(key + wsMagicGUID))
	return base64.StdEncoding.EncodeToString(hash[:])
}

func readFrame(r *bufio.Reader) ([]byte, error) {
	header := make([]byte, 2)
	if _, err := io.ReadFull(r, header); err != nil {
		return nil, err
	}

	fin := header[0]&0x80 != 0
	opcode := header[0] & 0x0f
	masked := header[1]&0x80 != 0
	payloadLen := int(header[1] & 0x7f)

	if !fin {
		return nil, errors.New("fragmented frames are not supported")
	}
	if opcode == 0x8 {
		return nil, io.EOF
	}
	if opcode != 0x1 {
		return nil, errors.New("only text frames are supported")
	}

	if payloadLen == 126 {
		extended := make([]byte, 2)
		if _, err := io.ReadFull(r, extended); err != nil {
			return nil, err
		}
		payloadLen = int(binary.BigEndian.Uint16(extended))
	} else if payloadLen == 127 {
		extended := make([]byte, 8)
		if _, err := io.ReadFull(r, extended); err != nil {
			return nil, err
		}
		payloadLen = int(binary.BigEndian.Uint64(extended))
	}

	maskKey := make([]byte, 4)
	if masked {
		if _, err := io.ReadFull(r, maskKey); err != nil {
			return nil, err
		}
	}

	payload := make([]byte, payloadLen)
	if _, err := io.ReadFull(r, payload); err != nil {
		return nil, err
	}

	if masked {
		for i := range payload {
			payload[i] ^= maskKey[i%4]
		}
	}

	return payload, nil
}

func buildTextFrame(payload []byte) []byte {
	header := []byte{0x81}
	switch {
	case len(payload) < 126:
		header = append(header, byte(len(payload)))
	case len(payload) <= 65535:
		header = append(header, 126, byte(len(payload)>>8), byte(len(payload)))
	default:
		header = append(header,
			127,
			0, 0, 0, 0,
			byte(len(payload)>>24),
			byte(len(payload)>>16),
			byte(len(payload)>>8),
			byte(len(payload)),
		)
	}
	return append(header, payload...)
}
