package transport

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"
)

type Conn struct {
	net.Conn
	br *bufio.Reader
}

func Hijack(w http.ResponseWriter, r *http.Request) (*Conn, error) {
	if !headerContainsToken(r.Header, "Connection", "upgrade") ||
		!headerContainsToken(r.Header, "Upgrade", "websocket") {
		return nil, errors.New("missing websocket upgrade headers")
	}

	hj, ok := w.(http.Hijacker)
	if !ok {
		return nil, errors.New("response writer does not support hijacking")
	}

	conn, rw, err := hj.Hijack()
	if err != nil {
		return nil, err
	}

	acceptKey := r.Header.Get("Sec-WebSocket-Key")
	if acceptKey == "" {
		conn.Close()
		return nil, errors.New("missing sec-websocket-key")
	}

	resp := "HTTP/1.1 101 Switching Protocols\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Accept: " + computeAcceptKey(acceptKey) + "\r\n\r\n"

	if _, err := rw.WriteString(resp); err != nil {
		conn.Close()
		return nil, err
	}
	if err := rw.Flush(); err != nil {
		conn.Close()
		return nil, err
	}

	return &Conn{Conn: conn, br: rw.Reader}, nil
}

func (c *Conn) ReadJSON(v any) error {
	payload, err := readFrame(c.br)
	if err != nil {
		return err
	}
	return json.Unmarshal(payload, v)
}

func (c *Conn) WriteJSON(v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	frame := buildTextFrame(b)
	_, err = c.Write(frame)
	return err
}

func (c *Conn) CloseWithContext(_ context.Context) error {
	return c.Close()
}

func headerContainsToken(h http.Header, key, token string) bool {
	values := h.Values(key)
	for _, v := range values {
		parts := strings.Split(v, ",")
		for _, p := range parts {
			if strings.EqualFold(strings.TrimSpace(p), token) {
				return true
			}
		}
	}
	return false
}
