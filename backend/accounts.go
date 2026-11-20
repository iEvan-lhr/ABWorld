package main

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/scrypt"
	"golang.org/x/text/unicode/norm"
	"io"
	"math"
	"net"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

type walkPose struct {
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	Z     float64 `json:"z"`
	Angle float64 `json:"angle"`
	Pitch float64 `json:"pitch"`
}
type user struct {
	ID       int     `json:"id"`
	Name     string  `json:"name"`
	Progress *string `json:"progress"`
	Revision int     `json:"revision"`
}
type attempt struct {
	n     int
	until time.Time
}
type api struct {
	db    *sql.DB
	mu    sync.Mutex
	tries map[string]attempt
}

func fail(c echo.Context, code int, msg string) error {
	return c.JSON(code, map[string]string{"error": msg})
}
func random(n int) string {
	b := make([]byte, n)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return hex.EncodeToString(b)
}
func hashed(s string) string { h := sha256.Sum256([]byte(s)); return hex.EncodeToString(h[:]) }
func token(c echo.Context) string {
	v, e := c.Cookie("abworld_sid")
	if e != nil {
		return ""
	}
	return hashed(v.Value)
}
func (a *api) current(c echo.Context) (user, error) {
	var u user
	e := a.db.QueryRow(`SELECT u.id,u.name,u.progress,u.revision FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?`, token(c), time.Now().UnixMilli()).Scan(&u.ID, &u.Name, &u.Progress, &u.Revision)
	return u, e
}
func cookie(c echo.Context, s string, age int) {
	c.SetCookie(&http.Cookie{Name: "abworld_sid", Value: s, Path: "/", MaxAge: age, HttpOnly: true, Secure: c.Request().TLS != nil, SameSite: http.SameSiteStrictMode})
}
func (a *api) limited(ip string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := time.Now()
	for k, v := range a.tries {
		if now.After(v.until) {
			delete(a.tries, k)
		}
	}
	v := a.tries[ip]
	if v.n == 0 {
		v.until = now.Add(time.Minute)
	}
	v.n++
	a.tries[ip] = v
	return v.n > 25
}

var username = regexp.MustCompile(`^[\pL\pN_-]{2,24}$`)

func decode(c echo.Context, v any) error {
	return json.NewDecoder(io.LimitReader(c.Request().Body, 8193)).Decode(v)
}
func (a *api) auth(c echo.Context) error {
	route := c.Param("action")
	if route == "session" && c.Request().Method == "GET" {
		u, e := a.current(c)
		if errors.Is(e, sql.ErrNoRows) {
			return c.JSON(200, nil)
		}
		if e != nil {
			return e
		}
		return c.JSON(200, u)
	}
	if c.Request().Method != "POST" {
		return fail(c, 405, "请求方式无效")
	}
	if route == "logout" {
		if _, e := a.db.Exec(`DELETE FROM sessions WHERE token=?`, token(c)); e != nil {
			return e
		}
		cookie(c, "", -1)
		return c.JSON(200, map[string]bool{"ok": true})
	}
	if route == "save" {
		return a.save(c)
	}
	if route != "register" && route != "login" {
		return fail(c, 404, "接口不存在")
	}
	var in struct {
		Name     string
		Password string
	}
	if decode(c, &in) != nil {
		return fail(c, 400, "请求格式无效")
	}
	in.Name = norm.NFC.String(strings.TrimSpace(in.Name))
	if !username.MatchString(in.Name) || utf8.RuneCountInString(in.Password) < 8 || utf8.RuneCountInString(in.Password) > 128 {
		return fail(c, 400, "账号需 2–24 位，密码需 8–128 位")
	}
	ip, _, _ := net.SplitHostPort(c.Request().RemoteAddr)
	if a.limited(ip) {
		return fail(c, 429, "操作频繁，请稍后再试")
	}
	var u user
	var salt, old string
	err := a.db.QueryRow(`SELECT id,name,progress,revision,salt,hash FROM users WHERE name=?`, in.Name).Scan(&u.ID, &u.Name, &u.Progress, &u.Revision, &salt, &old)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if salt == "" || route == "register" {
		salt = random(16)
	}
	key, e := scrypt.Key([]byte(in.Password), []byte(salt), 16384, 8, 1, 64)
	if e != nil {
		return e
	}
	tx, e := a.db.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if route == "register" {
		r, e := tx.Exec(`INSERT OR IGNORE INTO users(name,salt,hash) VALUES(?,?,?)`, in.Name, salt, hex.EncodeToString(key))
		if e != nil {
			return e
		}
		n, _ := r.RowsAffected()
		if n == 0 {
			return fail(c, 409, "账号已被使用")
		}
		id, _ := r.LastInsertId()
		u = user{ID: int(id), Name: in.Name}
	} else if err != nil || subtle.ConstantTimeCompare([]byte(old), []byte(hex.EncodeToString(key))) != 1 {
		return fail(c, 401, "账号或密码有误")
	}
	sid := random(32)
	if _, e = tx.Exec(`DELETE FROM sessions WHERE expires<=? OR token=?`, time.Now().UnixMilli(), token(c)); e != nil {
		return e
	}
	if _, e = tx.Exec(`INSERT INTO sessions VALUES(?,?,?)`, hashed(sid), u.ID, time.Now().Add(7*24*time.Hour).UnixMilli()); e != nil {
		return e
	}
	if e = tx.Commit(); e != nil {
		return e
	}
	cookie(c, sid, 7*86400)
	return c.JSON(200, u)
}
func (a *api) save(c echo.Context) error {
	u, e := a.current(c)
	if e != nil {
		return fail(c, 401, "请重新登录")
	}
	var in struct {
		Revision *int
		State    struct {
			Version    int            `json:"version"`
			Health     float64        `json:"health"`
			Stamina    float64        `json:"stamina"`
			Hunger     float64        `json:"hunger"`
			Attributes map[string]int `json:"attributes"`
			Bag        map[string]int `json:"bag"`
			Exhausted  bool           `json:"exhausted"`
			Pose       *walkPose      `json:"pose,omitempty"`
		}
	}
	if decode(c, &in) != nil || in.Revision == nil || in.State.Version != 1 {
		return fail(c, 400, "存档格式无效")
	}
	s := &in.State
	if p := s.Pose; p != nil {
		if math.Abs(p.X) > 4050 || p.Z < -3720 || p.Z > 4630 || p.Y < -5 || p.Y > 260 || math.Abs(p.Pitch) > 1.15 {
			return fail(c, 400, "位置超出城市范围")
		}
		p.Angle = math.Atan2(math.Sin(p.Angle), math.Cos(p.Angle))
	} else if u.Progress != nil {
		var old struct {
			Pose *walkPose `json:"pose"`
		}
		if json.Unmarshal([]byte(*u.Progress), &old) == nil {
			s.Pose = old.Pose
		}
	}
	for _, n := range []*float64{&s.Health, &s.Stamina, &s.Hunger} {
		*n = math.Min(100, math.Max(0, *n))
	}
	clean := func(m map[string]int, names []string, defaults []int, low, high int) map[string]int {
		out := map[string]int{}
		for i, k := range names {
			v, ok := m[k]
			if !ok {
				v = defaults[i]
			}
			out[k] = min(high, max(low, v))
		}
		return out
	}
	s.Attributes = clean(s.Attributes, []string{"strength", "agility", "intelligence", "charisma"}, []int{10, 10, 10, 10}, 1, 99)
	s.Bag = clean(s.Bag, []string{"cake", "tea", "medicine"}, []int{3, 2, 2}, 0, 999)
	s.Exhausted = s.Stamina == 0 || (s.Exhausted && s.Stamina < 20)
	b, _ := json.Marshal(s)
	r, e := a.db.Exec(`UPDATE users SET progress=?,revision=revision+1 WHERE id=? AND revision=?`, string(b), u.ID, *in.Revision)
	if e != nil {
		return e
	}
	n, _ := r.RowsAffected()
	if n == 0 {
		return fail(c, 409, "另一页面已更新存档，请刷新")
	}
	return c.JSON(200, map[string]int{"revision": *in.Revision + 1})
}
