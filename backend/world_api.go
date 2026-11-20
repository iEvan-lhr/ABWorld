package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"github.com/labstack/echo/v4"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// sharedCredentials reads only the provider entry needed by this request.
func sharedCredentials() string {
	base := os.Getenv("XDG_DATA_HOME")
	if base == "" {
		home, e := os.UserHomeDir()
		if e != nil {
			return ""
		}
		base = filepath.Join(home, ".local", "share")
	}
	data, e := os.ReadFile(filepath.Join(base, "opencode", "auth.json"))
	if e != nil {
		return ""
	}
	var entries map[string]json.RawMessage
	if json.Unmarshal(data, &entries) != nil {
		return ""
	}
	var cred struct{ Type, Key string }
	if json.Unmarshal(entries["opencode-go"], &cred) != nil || cred.Type != "api" {
		return ""
	}
	return strings.TrimSpace(cred.Key)
}
func (a *api) modelChat(c echo.Context) error {
	r := c.Request()
	u := c.Get("user").(user)
	key := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if key == "" && u.Name == "Evan" && trustedLocal(r) {
		key = sharedCredentials()
	}
	if key == "" {
		return fail(c, 401, "请连接 OpenCode Go 订阅")
	}
	var body map[string]json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return fail(c, 400, "对话请求格式无效")
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	up, err := http.NewRequestWithContext(r.Context(), "POST", "https://opencode.ai/zen/go/v1/chat/completions", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	up.Header.Set("Authorization", "Bearer "+key)
	up.Header.Set("Content-Type", "application/json")
	up.Header.Set("X-Opencode-Session", random(16))
	client := &http.Client{Timeout: 110 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	v, err := client.Do(up)
	if err != nil {
		return fail(c, 502, "Go 订阅服务暂时无法连接")
	}
	defer v.Body.Close()
	return c.Stream(v.StatusCode, "application/json", io.LimitReader(v.Body, 8<<20))
}
func (a *api) houses(c echo.Context) error {
	rows, e := a.db.Query(`SELECT no,roof,yard,resident,gate,hall,gate_style FROM citizens ORDER BY no`)
	if e != nil {
		return e
	}
	defer rows.Close()
	homes := []echo.Map{}
	for rows.Next() {
		var n, r, g, h int
		var roof, yard, gateStyle sql.NullString
		if e = rows.Scan(&n, &roof, &yard, &r, &g, &h, &gateStyle); e != nil {
			return e
		}
		toJSON := func(value sql.NullString) json.RawMessage {
			if !value.Valid {
				return nil
			}
			return json.RawMessage(value.String)
		}
		homes = append(homes, echo.Map{"id": n - 1, "roof": toJSON(roof), "yard": toJSON(yard), "gateStyle": toJSON(gateStyle), "resident": r, "gate": g != 0, "hall": h != 0})
	}
	if e = rows.Err(); e != nil {
		return e
	}
	return c.JSON(200, homes)
}
