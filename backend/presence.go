package main

import (
	"errors"
	"github.com/labstack/echo/v4"
	"golang.org/x/net/websocket"
	"math"
	"net/http"
	"net/url"
	"sync"
	"time"
)

type motion struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Z      float64 `json:"z"`
	Yaw    float64 `json:"yaw"`
	Action string  `json:"action"`
}
type avatar struct {
	motion
	ID   int    `json:"id"`
	Name string `json:"name"`
}
type livePeer struct {
	ws      *websocket.Conn
	state   avatar
	visible bool
}
type liveWorld struct {
	sync.Mutex
	peers    map[int]*livePeer
	revision uint64
}

func validMotion(p motion) bool {
	return math.Abs(p.X) <= 4050 && p.Z >= -3720 && p.Z <= 4630 && p.Y >= -5 && p.Y <= 260 && math.Abs(p.Yaw) <= math.Pi+0.001 && (p.Action == "idle" || p.Action == "walk" || p.Action == "run")
}
func (world *liveWorld) serve(a *api, c echo.Context) error {
	u := c.Get("user").(user)
	r := c.Request()
	origin, err := url.Parse(r.Header.Get("Origin"))
	if err != nil || origin.Host != r.Host || (origin.Scheme != "http" && origin.Scheme != "https") {
		return fail(c, 403, "只接受同源联机连接")
	}
	var no int
	if err = a.db.QueryRow("SELECT no FROM citizens WHERE uid=?", u.ID).Scan(&no); err != nil {
		return fail(c, 403, "请先入住洛阳城")
	}
	session := token(c)
	wsServer := websocket.Server{Handler: func(ws *websocket.Conn) {
		ws.MaxPayloadBytes = 1024
		peer := &livePeer{ws: ws, state: avatar{ID: u.ID, Name: u.Name}}
		world.Lock()
		old := world.peers[u.ID]
		if old != nil {
			world.Unlock()
			websocket.JSON.Send(ws, map[string]string{"error": "此账号已在另一页面漫游"})
			return
		}
		world.peers[u.ID] = peer
		world.Unlock()
		defer func() {
			world.Lock()
			if world.peers[u.ID] == peer {
				delete(world.peers, u.ID)
				world.revision++
			}
			world.Unlock()
		}()
		done := make(chan struct{})
		defer close(done)
		go func() {
			tick := time.NewTicker(150 * time.Millisecond)
			defer tick.Stop()
			var last uint64
			verified := time.Now()
			for {
				select {
				case <-done:
					return
				case now := <-tick.C:
					if now.Sub(verified) > 30*time.Second {
						var n int
						if a.db.QueryRow("SELECT 1 FROM sessions WHERE token=? AND user_id=? AND expires>?", session, u.ID, now.UnixMilli()).Scan(&n) != nil {
							ws.Close()
							return
						}
						verified = now
					}
					world.Lock()
					revision := world.revision
					if revision == last {
						world.Unlock()
						continue
					}
					players := make([]avatar, 0, len(world.peers))
					for id, p := range world.peers {
						if p.visible && id != u.ID {
							players = append(players, p.state)
						}
					}
					world.Unlock()
					last = revision
					ws.SetWriteDeadline(now.Add(4 * time.Second))
					if websocket.JSON.Send(ws, map[string]any{"players": players}) != nil {
						ws.Close()
						return
					}
				}
			}
		}()
		var lastUpdate time.Time
		for {
			var p motion
			ws.SetReadDeadline(time.Now().Add(95 * time.Second))
			if websocket.JSON.Receive(ws, &p) != nil {
				return
			}
			if !validMotion(p) {
				return
			}
			now := time.Now()
			if now.Sub(lastUpdate) < 70*time.Millisecond {
				continue
			}
			lastUpdate = now
			world.Lock()
			if !peer.visible || p != peer.state.motion {
				peer.state.motion = p
				peer.visible = true
				world.revision++
			}
			world.Unlock()
		}
	}, Handshake: func(_ *websocket.Config, req *http.Request) error {
		if req.Method != http.MethodGet {
			return errors.New("expected GET")
		}
		return nil
	}}
	wsServer.ServeHTTP(c.Response(), r)
	return nil
}
