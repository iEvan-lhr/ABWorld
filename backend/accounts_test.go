package main

import (
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/scrypt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestExistingAccountAndSession(t *testing.T) {
	db, e := sql.Open("sqlite", filepath.Join(t.TempDir(), "accounts.sqlite"))
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	_, e = db.Exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT UNIQUE COLLATE NOCASE,salt TEXT,hash TEXT,progress TEXT,revision INTEGER DEFAULT 0); CREATE TABLE sessions(token TEXT PRIMARY KEY,user_id INTEGER,expires INTEGER)`)
	if e != nil {
		t.Fatal(e)
	}
	salt := "27ee644afe101624666c1101216a4152"
	hash, _ := scrypt.Key([]byte("fixture-password"), []byte(salt), 16384, 8, 1, 64)
	if _, e = db.Exec("INSERT INTO users(name,salt,hash,progress,revision) VALUES(?,?,?,?,?)", "玩家", salt, hex.EncodeToString(hash), `{"version":1}`, 4); e != nil {
		t.Fatal(e)
	}
	a := &api{db: db, tries: map[string]attempt{}}
	app := echo.New()
	app.Match([]string{"GET", "POST"}, "/api/auth/:action", a.auth)
	request := func(method, action, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "/api/auth/"+action, strings.NewReader(body))
		if cookie != nil {
			req.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		app.ServeHTTP(w, req)
		return w
	}
	login := request("POST", "login", `{"name":"玩家","password":"fixture-password"}`, nil)
	if login.Code != 200 {
		t.Fatal(login.Code, login.Body.String())
	}
	cookie := login.Result().Cookies()[0]
	if !cookie.HttpOnly {
		t.Fatal("expected HttpOnly cookie")
	}
	var u user
	if e = json.Unmarshal(login.Body.Bytes(), &u); e != nil || u.Revision != 4 {
		t.Fatal(u, e)
	}
	if w := request("POST", "save", `{"revision":3,"state":{"version":1}}`, cookie); w.Code != 409 {
		t.Fatal(w.Code)
	}
	if w := request("POST", "save", `{"revision":4,"state":{"version":1,"bag":{"cake":2}}}`, cookie); w.Code != 200 {
		t.Fatal(w.Code)
	}
	if w := request("POST", "logout", "{}", cookie); w.Code != 200 {
		t.Fatal(w.Code)
	}
	if w := request("GET", "session", "", cookie); strings.TrimSpace(w.Body.String()) != "null" {
		t.Fatal(w.Body.String())
	}
}
